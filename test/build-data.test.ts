import { describe, expect, it } from "vitest";
import { buildSnapshot, parseIssueHeader } from "../src/data/build.js";
import { validateSnapshot } from "../src/data/schema.js";

const snapshot = buildSnapshot({ rawDir: "test/fixtures/raw", builtAt: "2026-01-02T00:00:00.000Z" });

describe("snapshot builder (AC-5)", () => {
  it("writes the release metadata", () => {
    expect(snapshot.meta).toEqual({
      release: "v0.0.1-fixture",
      commit: "c0ffee0000000000000000000000000000000000",
      scoredAt: "2026-01-01T00:00:00+00:00",
      manifestCommit: "abc1234",
      botocore: "1.0.0",
      builtAt: "2026-01-02T00:00:00.000Z",
      units: 8,
      unparsedIssues: 2,
      unmappedIssueKeys: 1,
    });
  });

  it("counts issue files without any Issue-Key as unparsed", () => {
    // two fixture files have no key: one starts with a title, one has only other headers
    expect(snapshot.meta.unparsedIssues).toBe(2);
  });

  it("aggregates wire steps per operation, not per test unit", () => {
    expect(snapshot.ops["s3:PutObject"]?.wire).toEqual({ pass: 3, fail: 1, failedUnits: ["s3-put-fail"] });
    expect(snapshot.ops["dynamodb:PutItem"]?.wire).toEqual({ pass: 1, fail: 0, failedUnits: [] });
  });

  it("indexes behavioral checks by operation through the manifest and skips unlisted units", () => {
    expect(snapshot.ops["s3:PutObject"]?.beh).toEqual({
      pass: 0,
      fail: 1,
      skipped: 0,
      checks: 1,
      samples: [{ path: "behavioral/s3/check_upload.py", outcome: "fail" }],
    });
    expect(snapshot.ops["s3:GetObject"]?.beh).toEqual({
      pass: 1,
      fail: 1,
      skipped: 0,
      checks: 2,
      samples: [
        { path: "behavioral/s3/check_upload.py", outcome: "fail" },
        { path: "behavioral/s3/check_get.py", outcome: "pass" },
      ],
    });
    expect(snapshot.ops["ecr:GetAccountSetting"]?.beh).toEqual({ pass: 0, fail: 0, skipped: 1, checks: 1, samples: [] });
  });

  it("parses the three Issue-Key formats", () => {
    // svc|Op|kind
    expect(snapshot.ops["ecr:GetAccountSetting"]?.issues).toEqual([
      { file: "20260101T000000Z-ecr-getaccountsetting-stub.md", severity: "HIGH", kind: "NotImplemented" },
    ]);
    // endpoint-prefix style (api.ecr is the botocore endpointPrefix of ecr); one record per file and operation
    expect(snapshot.ops["ecr:DescribeRepositories"]?.issues).toEqual([
      { file: "20260102T000000Z-endpoint-prefix.md", severity: "MEDIUM", kind: "4xx->2xx|status" },
    ]);
    // svc.check-id style is kept as a check-level record
    expect(snapshot.checkIssues).toEqual({
      "s3.upload-check": [{ file: "20260103T000000Z-check-id.md", severity: "LOW" }],
    });
  });

  it("marks SCAFFOLDED handler files as stubs and keeps implemented ones out", () => {
    expect(snapshot.ops["s3:WriteGetObjectResponse"]?.stub).toBe(
      "service-com-amazonaws-s3-amazons3/src/ops/write_get_object_response.rs",
    );
    expect(snapshot.ops["s3:PutObject"]?.stub).toBeUndefined();
    expect(snapshot.ops["ecr:GetAccountSetting"]?.stub).toBeUndefined();
  });

  it("lists handler files so that a missing one can be detected as absent", () => {
    expect(snapshot.services["s3"]?.emuOps).toEqual(["GetObject", "PutObject", "WriteGetObjectResponse"]);
    expect(snapshot.services["s3"]?.ops).toContain("SelectObjectContent");
    expect(snapshot.services["s3"]?.emuOps).not.toContain("SelectObjectContent");
    expect(snapshot.services["ecr"]?.emulator).toBe(true);
  });

  it("reads gzip-compressed botocore files and keeps service-level fidelity", () => {
    expect(snapshot.services["ecr"]).toMatchObject({ serviceId: "ECR", endpointPrefix: "api.ecr", js: "ecr" });
    expect(snapshot.services["s3"]?.fidelity).toEqual({ pass: 3, fail: 2, skipped: 0 });
  });

  it("ignores crates and issues for services that botocore does not know", () => {
    expect(Object.keys(snapshot.services)).toEqual(["dynamodb", "ecr", "s3"]);
    expect(Object.keys(snapshot.ops).some((k) => k.startsWith("nosuch"))).toBe(false);
  });

  it("produces a snapshot that passes validation and the same bytes on a second run", () => {
    expect(() => validateSnapshot(snapshot)).not.toThrow();
    const again = buildSnapshot({ rawDir: "test/fixtures/raw", builtAt: "2026-01-02T00:00:00.000Z" });
    expect(JSON.stringify(again)).toBe(JSON.stringify(snapshot));
  });
});

describe("issue header parser", () => {
  it("stops at the first blank or heading line", () => {
    const parsed = parseIssueHeader("Issue-Severity: HIGH\nIssue-Key: a|B|c\n\nIssue-Key: ignored|X|y\n");
    expect(parsed).toEqual({ keys: ["a|B|c"], severity: "HIGH" });
  });

  it("returns no keys for a file that starts with a heading", () => {
    expect(parseIssueHeader("# Title\nIssue-Key: a|B|c\n").keys).toEqual([]);
  });
});
