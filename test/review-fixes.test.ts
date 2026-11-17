import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadSnapshot } from "../src/data/schema.js";
import { scan } from "../src/scan.js";
import { check, explain } from "../src/verdict.js";
import { cli } from "./helpers.js";

const snapshot = loadSnapshot();

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "emucheck-fix-"));
}

describe("decorators in TypeScript (Q-1)", () => {
  const nest = `import { Injectable, Inject } from "@nestjs/common";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

@Injectable()
export class Svc {
  constructor(@Inject("S3") private readonly s3: S3Client) {}

  async read(): Promise<unknown> {
    return this.s3.send(new GetObjectCommand({ Bucket: "b", Key: "k" }));
  }
}
`;

  it("extracts calls from a NestJS-style class with class and parameter decorators", async () => {
    const dir = tmp();
    writeFileSync(join(dir, "svc.ts"), nest);
    const result = await scan([dir], { snapshot, root: dir });
    expect(result.unresolved).toEqual([]);
    expect(result.calls.map((c) => `${c.service}:${c.op}`)).toEqual(["s3:GetObject"]);
  });

  it("also parses decorators in .js files", async () => {
    const dir = tmp();
    writeFileSync(join(dir, "svc.js"), nest.replace(/: S3Client|: Promise<unknown>/g, "").replace("private readonly ", ""));
    const result = await scan([dir], { snapshot, root: dir });
    expect(result.calls.map((c) => `${c.service}:${c.op}`)).toEqual(["s3:GetObject"]);
  });
});

describe("fetch-data wiring and NOTICE (Q-2, Q-3)", () => {
  const script = readFileSync("scripts/fetch-data.mjs", "utf8");

  it("keeps one raw folder per release and re-clones when the tag differs", () => {
    expect(script).toContain("emucheck-raw-${release}");
    expect(script).toContain("cloneIsAt(clone, release)");
  });

  it("prints the --data command that uses the new snapshot", () => {
    expect(script).toContain("emucheck check . --data ${out}");
  });

  it("ships a NOTICE that names every source, pinned version and license", () => {
    expect(existsSync("data/NOTICE")).toBe(true);
    const notice = readFileSync("data/NOTICE", "utf8");
    expect(notice).toContain(snapshot.meta.commit);
    expect(notice).toContain(snapshot.meta.manifestCommit);
    expect(notice).toContain(`botocore ${snapshot.meta.botocore}`);
    expect(notice).toContain("CC0-1.0");
    expect(notice).toContain("Apache-2.0");
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { files: string[] };
    expect(pkg.files).toContain("data");
  });
});

describe("skipped files are reported (Q-9)", () => {
  it("counts a file over 5 MB and a broken CloudFormation template", async () => {
    const dir = tmp();
    writeFileSync(join(dir, "big.py"), `import boto3\n# ${"x".repeat(5 * 1024 * 1024 + 10)}\n`);
    writeFileSync(join(dir, "bad.yaml"), "AWSTemplateFormatVersion: '2010-09-09'\nResources:\n  A:\n    Type: AWS::S3::Bucket\n  B: [unclosed\n");
    const result = await scan([dir], { snapshot, root: dir });
    expect(result.skipped).toEqual([
      { file: "bad.yaml", reason: "template-parse" },
      { file: "big.py", reason: "too-large" },
    ]);
    const en = await cli(["check", dir, "--fail-on", "none", "--lang", "en"]);
    expect(en.stdout).toContain("Skipped 2 file(s)");
    expect(en.stdout).toContain("big.py  over 5 MB");
    const ko = await cli(["check", dir, "--fail-on", "none", "--lang", "ko"]);
    expect(ko.stdout).toContain("건너뛴 파일 2개");
    expect(ko.stdout).toContain("5 MB 초과");
    const json = JSON.parse((await cli(["check", dir, "--format", "json", "--fail-on", "none"])).stdout) as {
      summary: { skipped: number };
      skipped: unknown[];
    };
    expect(json.summary.skipped).toBe(2);
    expect(json.skipped).toHaveLength(2);
  });

  it("prints nothing extra when no file is skipped", async () => {
    const out = await cli(["check", "test/fixtures/project/src/typo.ts", "--fail-on", "none", "--lang", "en"]);
    expect(out.stdout).not.toContain("Skipped");
  });
});

describe("explain list and links (Q-10)", () => {
  const key = Object.entries(snapshot.ops).find(([, ev]) => (ev.issues?.length ?? 0) > 5)?.[0];

  it("says how many open records are not listed", async () => {
    expect(key).toBeDefined();
    const total = snapshot.ops[key!]!.issues!.length;
    const out = await cli(["explain", key!, "--lang", "en"]);
    expect(out.stdout).toContain(`Open records: ${total}`);
    expect(out.stdout).toContain(`... and ${total - 5} more`);
    const ko = await cli(["explain", key!, "--lang", "ko"]);
    expect(ko.stdout).toContain(`외 ${total - 5}건`);
  });

  it("builds evidence links against the pinned release tag", () => {
    const result = explain(key!, snapshot);
    const issueLinks = result.evidence.urls.filter((u) => u.includes("things-that-do-not-work"));
    expect(issueLinks.length).toBeGreaterThan(0);
    for (const url of issueLinks) expect(url).toContain(`/blob/${snapshot.meta.release}/issues/`);
    expect(result.evidence.urls.some((u) => u.includes("/blob/main/issues/"))).toBe(false);
  });

  it("uses the release tag for stub links too", async () => {
    const result = await scan(["test/fixtures/project"], { snapshot, root: process.cwd() });
    const report = check(result, snapshot);
    const urls = report.findings.flatMap((f) => f.evidence.urls);
    expect(urls.some((u) => u.includes("/blob/main/services/"))).toBe(false);
  });
});

describe("summary wording and package metadata (Q-11)", () => {
  it("uses singular words for a count of one", async () => {
    const dir = tmp();
    writeFileSync(
      join(dir, "one.py"),
      'import boto3\nboto3.client("s3").select_object_content(Bucket="b", Key="k", Expression="x", ExpressionType="SQL", InputSerialization={}, OutputSerialization={})\n',
    );
    const out = await cli(["check", dir, "--fail-on", "none", "--lang", "en"]);
    expect(out.stdout).toContain("1 operation at 1 call site ");
    expect(out.stdout).not.toContain("1 operations");
  });

  it("has repository metadata, a prepack build and a changelog entry for the version", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      version: string;
      repository: { url: string };
      bugs: { url: string };
      homepage: string;
      scripts: Record<string, string>;
    };
    expect(pkg.repository.url).toContain("emucheck");
    expect(pkg.bugs.url).toContain("emucheck");
    expect(pkg.homepage).toContain("emucheck");
    expect(pkg.scripts["prepack"]).toBe("npm run build");
    expect(readFileSync("CHANGELOG.md", "utf8")).toContain(`## [${pkg.version}]`);
  });
});
