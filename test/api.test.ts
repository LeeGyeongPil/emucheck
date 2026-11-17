import { describe, expect, it } from "vitest";
import {
  GRADE_ORDER,
  SnapshotFormatError,
  UsageError,
  check,
  explain,
  loadSnapshot,
  renderJson,
  renderSarif,
  renderTable,
  scan,
  xformName,
} from "../src/index.js";
import { cli } from "./helpers.js";

describe("public API", () => {
  it("scan, check and render work together with the bundled snapshot", async () => {
    const snapshot = loadSnapshot();
    const result = await scan(["examples/sample-app"], { snapshot });
    const report = check(result, snapshot);
    expect(report.findings.length).toBeGreaterThan(5);
    expect(renderJson(report)).toContain('"tool": "emucheck"');
    expect(renderSarif(report, "en")).toContain('"version": "2.1.0"');
    expect(renderTable(report, { lang: "en", showUnresolved: false })).toContain("GRADE");
    expect(GRADE_ORDER[0]).toBe("unknown-op");
    expect(explain("s3:SelectObjectContent", snapshot).grade).toBe("absent");
    expect(xformName("GetItem")).toBe("get_item");
  });

  it("throws SnapshotFormatError with a fixing hint for a missing snapshot file", () => {
    expect(() => loadSnapshot("no/such/file.json.gz")).toThrow(SnapshotFormatError);
    expect(() => loadSnapshot("no/such/file.json.gz")).toThrow(/--data or EMUCHECK_DATA/);
  });

  it("throws UsageError for a path that does not exist", async () => {
    await expect(scan(["no/such/dir"])).rejects.toBeInstanceOf(UsageError);
    await expect(scan(["no/such/dir"])).rejects.toThrow(/Pass an existing file or directory/);
  });
});

describe("bundled snapshot and example run (AC-9)", () => {
  it("shows the pinned release and finds absent and partial rows in examples/sample-app", async () => {
    const out = await cli(["check", "examples/sample-app", "--fail-on", "none"]);
    expect(out.code).toBe(0);
    expect(out.stdout).toContain("aws-emulator v1.0.489");
    expect(out.stdout).toContain("commit b30808c");
    expect(out.stdout).toMatch(/absent\s+high\s+s3:SelectObjectContent/);
    expect(out.stdout).toMatch(/partial\s+high\s+dynamodb:PutItem/);
  });

  it("carries the real numbers from the release: dynamodb:PutItem wire steps 484 pass / 19 fail", () => {
    const snapshot = loadSnapshot();
    expect(snapshot.meta).toMatchObject({ release: "v1.0.489", botocore: "1.44.4" });
    expect(snapshot.meta.commit.startsWith("b30808c")).toBe(true);
    expect(snapshot.ops["dynamodb:PutItem"]?.wire).toMatchObject({ pass: 484, fail: 19 });
    expect(snapshot.services["s3"]?.emuOps).not.toContain("SelectObjectContent");
    expect(Object.keys(snapshot.services).length).toBe(439);
  });
});
