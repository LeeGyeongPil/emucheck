import { describe, expect, it } from "vitest";
import { loadSnapshot } from "../src/data/schema.js";
import { Names, compact, jsPackageName } from "../src/names.js";

const names = new Names(loadSnapshot());

describe("name normalization (AC-3)", () => {
  it.each([
    ["cloudwatch-logs", "logs"],
    ["sfn", "stepfunctions"],
    ["dynamodb", "dynamodb"],
    ["cognito-identity-provider", "cognito-idp"],
  ])("maps JS package suffix %s to boto3 %s", (suffix, expected) => {
    expect(names.fromJsPackage(suffix)).toBe(expected);
  });

  it.each([
    ["cloudwatchlogs", "logs"],
    ["cloudwatchevents", "events"],
    ["sfn", "stepfunctions"],
    ["dynamodb", "dynamodb"],
  ])("maps smithy namespace %s to boto3 %s", (ns, expected) => {
    expect(names.fromSmithyNamespace(ns)).toBe(expected);
  });

  it.each([
    ["AWS::Logs::LogGroup", "logs"],
    ["AWS::DynamoDB::Table", "dynamodb"],
    ["AWS::StepFunctions::StateMachine", "stepfunctions"],
    ["AWS::Lambda::Function", "lambda"],
    ["AWS::Serverless::Function", "lambda"],
    ["AWS::Events::Rule", "events"],
    ["AWS::SecretsManager::Secret", "secretsmanager"],
  ])("maps CloudFormation type %s to %s", (type, expected) => {
    expect(names.fromCloudFormation(type)).toBe(expected);
  });

  it("does not map Custom:: types", () => {
    expect(names.fromCloudFormation("Custom::Thing")).toBeUndefined();
  });

  it.each([
    ["aws_sfn_state_machine", "stepfunctions"],
    ["aws_caller_identity", "sts"],
    ["aws_cloudwatch_log_group", "logs"],
    ["aws_cloudwatch_event_rule", "events"],
    ["aws_cloudwatch_metric_alarm", "cloudwatch"],
    ["aws_dynamodb_table", "dynamodb"],
    ["aws_lambda_function", "lambda"],
    ["aws_s3_bucket", "s3"],
    ["aws_security_group", "ec2"],
    ["aws_route53_zone", "route53"],
    ["aws_db_instance", "rds"],
  ])("maps Terraform type %s to %s", (type, expected) => {
    expect(names.fromTerraform(type)).toBe(expected);
  });

  it("returns undefined for names it does not know", () => {
    expect(names.fromTerraform("aws_region")).toBeUndefined();
    expect(names.fromTerraform("google_storage_bucket")).toBeUndefined();
    expect(names.fromJsPackage("no-such-package")).toBeUndefined();
  });

  it("derives the JS package and namespace rules from the service id", () => {
    expect(jsPackageName("CloudWatch Logs")).toBe("cloudwatch-logs");
    expect(compact("CloudWatch Logs")).toBe("cloudwatchlogs");
  });
});
