import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadSnapshot } from "../src/data/schema.js";
import { extractCloudFormation, extractTerraform } from "../src/extract/iac.js";
import { Names } from "../src/names.js";

const names = new Names(loadSnapshot());
const read = (file: string): string => readFileSync("test/fixtures/project/" + file, "utf8");

describe("IaC extraction (AC-3)", () => {
  it("reads a cdk.out JSON template and skips Custom:: resources", () => {
    const out = extractCloudFormation(read("cdk.out/Stack.template.json"), "cdk.out/Stack.template.json", names);
    expect(out.parseErrors).toBe(0);
    expect(out.resources.map((r) => `${r.line} ${r.type} ${r.service}`)).toEqual([
      "3 AWS::DynamoDB::Table dynamodb",
      "4 AWS::Lambda::Function lambda",
      "5 AWS::Logs::LogGroup logs",
    ]);
  });

  it("reads CloudFormation YAML with short tags without parse errors", () => {
    const out = extractCloudFormation(read("template.yaml"), "template.yaml", names);
    expect(out.parseErrors).toBe(0);
    expect(out.resources.map((r) => `${r.type} ${r.service}`)).toEqual([
      "AWS::SQS::Queue sqs",
      "AWS::Serverless::Function lambda",
      "AWS::Logs::LogGroup logs",
    ]);
  });

  it("reads Terraform resource and data blocks and ignores comments", () => {
    const out = extractTerraform(read("infra/main.tf"), "infra/main.tf", names);
    expect(out.map((r) => `${r.line} ${r.kind} ${r.type} ${r.service}`)).toEqual([
      "1 terraform aws_dynamodb_table dynamodb",
      "6 terraform aws_sqs_queue sqs",
      "10 terraform aws_sfn_state_machine stepfunctions",
      "14 terraform aws_caller_identity sts",
      "18 terraform aws_cloudwatch_log_group logs",
    ]);
  });

  it("returns a parse error count for a broken template instead of throwing", () => {
    const out = extractCloudFormation("Resources:\n  A: [unclosed\n  Type: AWS::SQS::Queue\n", "bad.yaml", names);
    expect(out.parseErrors).toBeGreaterThan(0);
  });
});
