import { describe, expect, it } from "vitest";
import { loadSnapshot } from "../src/data/schema.js";
import { extractJs } from "../src/extract/js.js";
import { Names } from "../src/names.js";
import { scan } from "../src/scan.js";

const snapshot = loadSnapshot();
const root = process.cwd();
const FILE = "test/fixtures/project/src/app.ts";

describe("JS/TS extraction (AC-1)", () => {
  it("finds exactly 14 calls in the probe fixture app.ts", async () => {
    const result = await scan([FILE], { snapshot, root });
    const found = result.calls.map((c) => `${c.file}:${c.line} ${c.service}:${c.op} ${c.how}`);
    expect(found).toEqual([
      `${FILE}:14 dynamodb:PutItem command`, // PutItemCommand imported by name
      `${FILE}:15 dynamodb:Query command`, // QueryCommand imported under the alias Q
      `${FILE}:16 dynamodb:GetItem lib-dynamodb`, // lib-dynamodb GetCommand
      `${FILE}:17 sqs:SendMessage command`, // namespace import sqs.SendMessageCommand
      `${FILE}:19 s3:PutObject aggregated-method`, // new S3() then s3.putObject
      `${FILE}:20 s3:SelectObjectContent aggregated-method`,
      `${FILE}:21 stepfunctions:StartExecution command`, // client-sfn maps to stepfunctions
      `${FILE}:22 logs:PutLogEvents command`, // client-cloudwatch-logs maps to logs
      `${FILE}:23 s3:AbortMultipartUpload lib-storage`,
      `${FILE}:23 s3:CompleteMultipartUpload lib-storage`,
      `${FILE}:23 s3:CreateMultipartUpload lib-storage`,
      `${FILE}:23 s3:PutObject lib-storage`,
      `${FILE}:23 s3:UploadPart lib-storage`,
      `${FILE}:24 s3:ListObjectsV2 paginator`,
    ]);
    expect(result.calls).toHaveLength(14);
    expect(result.unresolved).toEqual([]);
  });

  it("marks lib-storage Upload as inferred and plain commands as certain", async () => {
    const result = await scan([FILE], { snapshot, root });
    expect(result.calls.filter((c) => c.how === "lib-storage").every((c) => c.extraction === "inferred")).toBe(true);
    expect(result.calls.filter((c) => c.how === "command").every((c) => c.extraction === "certain")).toBe(true);
  });

  it("handles CommonJS require and reports computed method names as unresolved", async () => {
    const result = await scan(["test/fixtures/project/src/extra.js"], { snapshot, root });
    expect(result.calls.map((c) => `${c.service}:${c.op}`)).toEqual(["lambda:Invoke"]);
    expect(result.unresolved).toEqual([
      { file: "test/fixtures/project/src/extra.js", line: 9, sdk: "js-v3", reason: "dynamic-method" },
    ]);
  });

  it("keeps unknown operations so the verdict can flag them", async () => {
    const result = await scan(["test/fixtures/project/src/typo.ts"], { snapshot, root });
    expect(result.calls.map((c) => `${c.service}:${c.op}`)).toEqual(["s3:WriteGetObjectResponse", "s3:PutObjekt"]);
  });

  it("does not crash on source that cannot be parsed", () => {
    const out = extractJs("import { X } from '@aws-sdk/client-s3'; const = ;;; <<<", "broken.ts", new Names(snapshot));
    expect(Array.isArray(out.calls)).toBe(true);
    expect(Array.isArray(out.unresolved)).toBe(true);
  });
});
