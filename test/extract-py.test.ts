import { describe, expect, it } from "vitest";
import { loadSnapshot } from "../src/data/schema.js";
import { extractPython } from "../src/extract/python.js";
import { tokenizePython } from "../src/extract/pytokens.js";
import { Names, xformName } from "../src/names.js";
import { scan } from "../src/scan.js";

const snapshot = loadSnapshot();
const names = new Names(snapshot);
const root = process.cwd();

function keys(source: string): string[] {
  return extractPython(source, "x.py", names).calls.map((c) => `${c.line} ${c.service}:${c.op} ${c.how}`);
}

describe("Python extraction (AC-2)", () => {
  it("finds the 8 probe fixture calls", async () => {
    const file = "test/fixtures/project/py/handler.py";
    const result = await scan([file], { snapshot, root });
    expect(result.calls.map((c) => `${c.file}:${c.line} ${c.service}:${c.op} ${c.how}`)).toEqual([
      `${file}:12 dynamodb:PutItem client-method`, // bound client
      `${file}:13 dynamodb:TransactWriteItems client-method`,
      `${file}:14 logs:PutLogEvents client-method`, // service_name= keyword
      `${file}:15 stepfunctions:StartExecution client-method`, // Session().client
      `${file}:16 dynamodb:Query resource-action`, // resource Table().query
      `${file}:17 s3:PutObject resource-action`, // resource Bucket().upload_file
      `${file}:19 dynamodb:Scan paginator`,
      `${file}:21 ses:SendEmail client-method`, // inline client
    ]);
    expect(result.unresolved).toEqual([]);
  });

  it("handles extra cases with no false positives and one unresolved call", async () => {
    const file = "test/fixtures/project/py/extra.py";
    const result = await scan([file], { snapshot, root });
    expect(result.calls.map((c) => `${c.file}:${c.line} ${c.service}:${c.op}`)).toEqual([
      `${file}:18 sqs:SendMessage`, // self.queue bound through Session(...).client("sqs")
      `${file}:22 rds:DescribeDBInstances`, // multi-line call, reverse mapped
      `${file}:25 s3:WriteGetObjectResponse`,
      `${file}:27 s3:PutObjekt`, // the typo is kept so the verdict reports unknown-op
    ]);
    // comment, docstring, plain string and triple-quoted string contents never produce calls
    expect(result.calls.some((c) => c.service === "sts" || c.service === "lambda")).toBe(false);
    expect(result.unresolved).toEqual([{ file, line: 26, sdk: "boto3", reason: "dynamic-getattr" }]);
  });

  it("maps snake_case back to the real operation name with the ported xform_name", () => {
    expect(xformName("DescribeDBInstances")).toBe("describe_db_instances");
    expect(xformName("ListObjectsV2")).toBe("list_objects_v2");
    expect(xformName("PutItem")).toBe("put_item");
    expect(names.opFromSnake("rds", "describe_db_instances")).toBe("DescribeDBInstances");
    expect(keys('import boto3\nrds = boto3.client("rds")\nrds.describe_db_instances()\n')).toEqual([
      "3 rds:DescribeDBInstances client-method",
    ]);
  });

  it("ignores a client factory with an unknown service name", () => {
    expect(keys('import boto3\nc = boto3.client("not-a-service")\nc.put_item()\n')).toEqual([]);
  });

  it("does not report non-API client attributes", () => {
    const source =
      'import boto3\nc = boto3.client("s3")\nc.get_paginator("list_objects_v2")\nc.generate_presigned_url("get_object")\nc.close()\n';
    expect(keys(source)).toEqual([]);
  });

  it("maps client helpers such as upload_file to the operation they use", () => {
    expect(keys('import boto3\ns3 = boto3.client("s3")\ns3.upload_file("a", "b", "c")\n')).toEqual(["3 s3:PutObject client-helper"]);
  });

  it("resolves getattr with a literal name and flags a computed one", () => {
    const source = 'import boto3\nc = boto3.client("dynamodb")\ngetattr(c, "put_item")()\ngetattr(c, name)()\n';
    const out = extractPython(source, "x.py", names);
    expect(out.calls.map((c) => c.op)).toEqual(["PutItem"]);
    expect(out.unresolved).toHaveLength(1);
  });

  it("follows annotated assignments and boto3.session.Session", () => {
    const source = 'import boto3\nddb: "Any" = boto3.session.Session().client("dynamodb")\nddb.scan()\n';
    expect(keys(source)).toEqual(["3 dynamodb:Scan client-method"]);
  });
});

describe("Python tokenizer", () => {
  it("drops comments and keeps string contents out of the name tokens", () => {
    const tokens = tokenizePython('x = "boto3.client" # boto3.client(\ny = \'\'\'a\nboto3\'\'\'\n');
    expect(tokens.filter((t) => t.kind === "name").map((t) => t.value)).toEqual(["x", "y"]);
  });

  it("joins backslash continuations and brackets across lines into one logical line", () => {
    const tokens = tokenizePython("a = foo(1,\n  2)\nb = 1 + \\\n 2\n");
    expect(tokens.filter((t) => t.kind === "newline")).toHaveLength(2);
  });

  it("marks f-strings and byte strings as not plain", () => {
    const tokens = tokenizePython('a = f"x{1}"\nb = b"x"\nc = "x"\n');
    expect(tokens.filter((t) => t.kind === "string").map((t) => t.plain)).toEqual([false, false, true]);
  });

  it("stops an unterminated string at the end of the line", () => {
    const tokens = tokenizePython('a = "oops\nb = 1\n');
    expect(tokens.some((t) => t.kind === "name" && t.value === "b")).toBe(true);
  });
});
