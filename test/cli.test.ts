import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MINI, PROJECT, cli } from "./helpers.js";

// The check path must never touch the network: any fetch call makes the test fail.
let fetchCalls = 0;
beforeEach(() => {
  fetchCalls = 0;
  vi.stubGlobal("fetch", () => {
    fetchCalls++;
    throw new Error("network access is not allowed on the check path");
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("check end to end (AC-6)", () => {
  it("exits 1 with --fail-on absent,stub and prints snapshot metadata and evidence links", async () => {
    const out = await cli(["check", PROJECT, "--data", MINI, "--format", "json", "--fail-on", "absent,stub"]);
    expect(out.code).toBe(1);
    const report = JSON.parse(out.stdout);
    expect(report.tool).toBe("emucheck");
    expect(report.snapshot).toMatchObject({
      release: "v1.0.489",
      commit: "b30808c9e1b2a6d025e5a0a9af64946404ff0905",
      scoredAt: "2026-11-17T09:17:02+00:00",
    });
    for (const finding of report.findings) {
      expect(finding.sites.length).toBeGreaterThan(0);
      for (const site of finding.sites) {
        expect(typeof site.file).toBe("string");
        expect(site.line).toBeGreaterThan(0);
      }
      expect(Array.isArray(finding.evidence.urls)).toBe(true);
    }
    const put = report.findings.find((f: { key: string }) => f.key === "dynamodb:PutItem");
    expect(put.evidence.urls.some((u: string) => u.startsWith("https://github.com/aws/aws-emulator"))).toBe(true);
    expect(out.stderr).toContain("Gate failed");
    expect(fetchCalls).toBe(0);
  });

  it("gives byte-identical output on two runs", async () => {
    const args = ["check", PROJECT, "--data", MINI, "--format", "json", "--fail-on", "absent,stub"];
    const a = await cli(args);
    const b = await cli(args);
    expect(a.stdout).toBe(b.stdout);
    expect(a.stdout.length).toBeGreaterThan(1000);
  });

  it("exits 0 when --fail-on lists a grade that is not present", async () => {
    const handler = ["check", "test/fixtures/project/py/handler.py", "--data", MINI, "--format", "json"];
    expect((await cli([...handler, "--fail-on", "failing"])).code).toBe(0);
    expect((await cli([...handler, "--fail-on", "absent"])).code).toBe(1);
    expect((await cli([...handler, "--fail-on", "none"])).code).toBe(0);
  });

  it("uses absent,stub as the default gate", async () => {
    const out = await cli(["check", PROJECT, "--data", MINI, "--format", "json"]);
    expect(out.code).toBe(1);
  });

  it("prints a readable table by default", async () => {
    const out = await cli(["check", "test/fixtures/project/src/typo.ts", "--data", MINI]);
    expect(out.stdout).toContain("Snapshot: aws-emulator v1.0.489 - commit b30808c");
    expect(out.stdout).toMatch(/GRADE\s+CONF\s+OPERATION\s+WHERE\s+EVIDENCE\s+NOTE/);
    expect(out.stdout).toMatch(/unknown-op\s+high\s+s3:PutObjekt\s+test\/fixtures\/project\/src\/typo\.ts:7/);
    expect(out.stdout).toContain("did you mean PutObject?");
    expect(out.stdout).toMatch(/stub\s+high\s+s3:WriteGetObjectResponse/);
  });

  it("shows unresolved calls only with --show-unresolved", async () => {
    const plain = await cli(["check", "test/fixtures/project/py/extra.py", "--data", MINI, "--fail-on", "none"]);
    expect(plain.stdout).toContain("--show-unresolved");
    expect(plain.stdout).not.toContain("getattr with a computed name");
    const shown = await cli(["check", "test/fixtures/project/py/extra.py", "--data", MINI, "--fail-on", "none", "--show-unresolved"]);
    expect(shown.stdout).toContain("getattr with a computed name");
  });

  it("warns when the snapshot is older than 14 days but keeps the exit code", async () => {
    const snapshot = JSON.parse(readFileSync(MINI, "utf8"));
    snapshot.meta.scoredAt = "2020-01-01T00:00:00+00:00";
    const file = join(mkdtempSync(join(tmpdir(), "emucheck-")), "old.json");
    writeFileSync(file, JSON.stringify(snapshot));
    const out = await cli(["check", "test/fixtures/project/py/handler.py", "--data", file, "--fail-on", "failing"]);
    expect(out.stdout).toContain("Warning: the data snapshot is");
    expect(out.code).toBe(0);
    const fresh = await cli(["check", "test/fixtures/project/py/handler.py", "--data", MINI, "--fail-on", "failing"]);
    expect(fresh.stdout).not.toContain("Warning: the data snapshot is");
  });

  it("supports --ignore for directories", async () => {
    const all = JSON.parse((await cli(["check", PROJECT, "--data", MINI, "--format", "json", "--fail-on", "none"])).stdout);
    const ignored = JSON.parse(
      (await cli(["check", PROJECT, "--data", MINI, "--format", "json", "--fail-on", "none", "--ignore", "py"])).stdout,
    );
    expect(ignored.summary.filesScanned).toBeLessThan(all.summary.filesScanned);
  });
});

describe("scan, explain and data-info", () => {
  it("scan lists calls and resources as JSON", async () => {
    const out = await cli(["scan", PROJECT, "--data", MINI, "--format", "json"]);
    expect(out.code).toBe(0);
    const result = JSON.parse(out.stdout);
    expect(result.calls.length).toBeGreaterThan(20);
    expect(result.resources.length).toBeGreaterThan(5);
    expect(result.unresolved).toHaveLength(2);
  });

  it("scan rejects the sarif format", async () => {
    const out = await cli(["scan", PROJECT, "--format", "sarif"]);
    expect(out.code).toBe(2);
    expect(out.stderr).toContain("scan supports --format table or json");
  });

  it("explain shows wire and behavioral numbers and links", async () => {
    const out = await cli(["explain", "dynamodb:PutItem", "--data", MINI]);
    expect(out.code).toBe(0);
    expect(out.stdout).toContain("dynamodb:PutItem - partial (high confidence)");
    expect(out.stdout).toContain("Wire steps: 484 pass, 19 not passing");
    expect(out.stdout).toContain("837 pass, 210 fail");
    expect(out.stdout).toContain("https://github.com/aws/aws-emulator/releases/tag/v1.0.489");
  });

  it("explain can print JSON", async () => {
    const out = await cli(["explain", "s3:SelectObjectContent", "--data", MINI, "--format", "json"]);
    expect(JSON.parse(out.stdout)).toMatchObject({ key: "s3:SelectObjectContent", grade: "absent" });
  });

  it("data-info prints the bundled snapshot metadata", async () => {
    const out = await cli(["data-info"]);
    expect(out.code).toBe(0);
    expect(out.stdout).toContain("aws-emulator release: v1.0.489");
    expect(out.stdout).toContain("b30808c9e1b2a6d025e5a0a9af64946404ff0905");
    expect(out.stdout).toContain("botocore: 1.44.4");
  });
});

describe("errors and exit code 2", () => {
  it.each([
    [["check", "no/such/path", "--data", MINI], "Path not found: no/such/path"],
    [["check", PROJECT, "--format", "xml"], 'Unknown format "xml"'],
    [["check", PROJECT, "--fail-on", "bogus", "--data", MINI], 'Unknown grade "bogus"'],
    [["explain"], "explain needs an operation"],
    [["explain", "dynamodb"], "service:Operation"],
    [["frobnicate"], 'Unknown command "frobnicate"'],
    [["check", "--nope"], "Invalid option"],
    [["check", PROJECT, "--data", "no/such/snapshot.json"], "Cannot read snapshot"],
    [["--lang", "fr", "check"], 'Unsupported language "fr"'],
  ])("%j exits 2 with a fixing hint", async (args, message) => {
    const out = await cli(args as string[]);
    expect(out.code).toBe(2);
    expect(out.stderr).toContain(message);
  });

  it("rejects a snapshot with an unsupported schema version", async () => {
    const dir = mkdtempSync(join(tmpdir(), "emucheck-"));
    const file = join(dir, "bad.json");
    writeFileSync(file, JSON.stringify({ schemaVersion: 99, meta: {}, services: {}, ops: {} }));
    const out = await cli(["check", PROJECT, "--data", file]);
    expect(out.code).toBe(2);
    expect(out.stderr).toContain("unsupported schemaVersion 99");
  });

  it("rejects a snapshot that is not JSON", async () => {
    const dir = mkdtempSync(join(tmpdir(), "emucheck-"));
    const file = join(dir, "text.json");
    writeFileSync(file, "not json");
    const out = await cli(["data-info", "--data", file]);
    expect(out.code).toBe(2);
    expect(out.stderr).toContain("not valid JSON");
  });

  it("honours EMUCHECK_DATA when --data is absent", async () => {
    const out = await cli(["data-info"], { EMUCHECK_DATA: MINI });
    expect(out.stdout).toContain("services: 11 (10 in the emulator)");
  });

  it("prints help and the version", async () => {
    const help = await cli(["--help"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("Usage:");
    const version = await cli(["--version"]);
    expect(version.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    const none = await cli([]);
    expect(none.code).toBe(2);
  });
});
