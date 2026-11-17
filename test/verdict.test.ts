import { describe, expect, it } from "vitest";
import { loadSnapshot } from "../src/data/schema.js";
import { Names } from "../src/names.js";
import { scan } from "../src/scan.js";
import type { Confidence, Grade } from "../src/types.js";
import { check, explain, failsGate, gradeOperation } from "../src/verdict.js";

const snapshot = loadSnapshot("test/fixtures/snapshot/mini.json");
const names = new Names(snapshot);

function grade(key: string) {
  const i = key.indexOf(":");
  return gradeOperation(snapshot, names, key.slice(0, i), key.slice(i + 1));
}

describe("ordered verdict rules (AC-4)", () => {
  const cases: [string, string, Grade, Confidence][] = [
    ["typo in the operation name", "s3:PutObjekt", "unknown-op", "high"],
    ["operation without a handler file", "s3:SelectObjectContent", "absent", "high"],
    ["scaffolded stub", "s3:WriteGetObjectResponse", "stub", "high"],
    ["every wire step fails", "sqs:SendMessage", "failing", "high"],
    ["wire steps mixed", "dynamodb:PutItem", "partial", "high"],
    ["behavioral-only failure", "stepfunctions:StartExecution", "partial", "low"],
    ["issue record only, wire passing", "ecr:GetAccountSetting", "partial", "low"],
    ["no evidence", "logs:PutLogEvents", "untested", "low"],
  ];

  it.each(cases)("%s: %s is %s (%s)", (_label, key, expectedGrade, expectedConfidence) => {
    const v = grade(key);
    expect(v.grade).toBe(expectedGrade);
    expect(v.confidence).toBe(expectedConfidence);
  });

  it("uses the wire step numbers as evidence for dynamodb:PutItem, not the behavioral aggregate", () => {
    const v = grade("dynamodb:PutItem");
    expect(v.evidence.wire).toMatchObject({ pass: 484, fail: 19 });
    expect(v.evidence.behavioral).toMatchObject({ pass: 837, fail: 210 });
    expect(v.grade).not.toBe("failing");
  });

  it("never turns a behavioral-only failure into failing", () => {
    const v = grade("stepfunctions:StartExecution");
    expect(v.grade).toBe("partial");
    expect(v.notes.map((n) => n.code)).toContain("behavioral-only");
  });

  it("marks an open record next to passing wire steps as possibly stale", () => {
    expect(grade("ecr:GetAccountSetting").notes.map((n) => n.code)).toContain("stale-possible");
  });

  it("grades passing wire evidence high and behavioral-only passes low", () => {
    expect(grade("dynamodb:GetItem")).toMatchObject({ grade: "passing", confidence: "high" });
    expect(grade("dynamodb:Query")).toMatchObject({ grade: "passing", confidence: "low" });
  });

  it("reports a whole missing service as absent", () => {
    const v = grade("ses:SendEmail");
    expect(v.grade).toBe("absent");
    expect(v.notes[0]?.code).toBe("service-absent");
  });

  it("flags an unknown service and suggests the nearest operation name", () => {
    expect(grade("nosuch:Thing").grade).toBe("unknown-op");
    const typo = grade("s3:PutObjekt");
    expect(typo.notes).toContainEqual({ code: "did-you-mean", params: { op: "PutObject" } });
  });

  it("attaches evidence links only where evidence exists", () => {
    expect(grade("s3:PutObjekt").evidence.urls).toEqual([]);
    const urls = grade("dynamodb:PutItem").evidence.urls;
    expect(urls[0]).toBe("https://github.com/aws/aws-emulator/releases/tag/v1.0.489");
    expect(urls).toContain("https://github.com/aws/aws-emulator-evaluation-suite/blob/main/behavioral/dynamodb/check_put_item_conditions.py");
    expect(grade("s3:WriteGetObjectResponse").evidence.urls.at(-1)).toContain("write_get_object_response.rs");
  });
});

describe("check report", () => {
  it("groups call sites by operation and orders findings by severity", async () => {
    const result = await scan(["test/fixtures/project"], { snapshot, root: process.cwd() });
    const report = check(result, snapshot);
    const order = report.findings.map((f) => f.grade);
    const rank = ["unknown-op", "absent", "stub", "failing", "partial", "untested", "passing"];
    expect(order).toEqual([...order].sort((a, b) => rank.indexOf(a) - rank.indexOf(b)));
    const put = report.findings.find((f) => f.key === "s3:PutObject");
    expect(put?.sites.length).toBeGreaterThan(1);
    expect(report.summary.findings).toBe(report.findings.length);
    expect(report.summary.certain + report.summary.inferred).toBe(result.calls.length);
  });

  it("grades IaC resources by service and skips unmapped ones", async () => {
    const result = await scan(["test/fixtures/project"], { snapshot, root: process.cwd() });
    const report = check(result, snapshot);
    const types = report.resources.map((r) => `${r.type}:${r.grade}`);
    expect(types).toContain("aws_dynamodb_table:untested");
    expect(report.resources.every((r) => r.service !== "")).toBe(true);
    // the mini snapshot has no ec2 service at all: resources of unknown services are not reported
    expect(report.resources.some((r) => r.service === "ec2")).toBe(false);
  });

  it("failsGate only reacts to the listed grades", async () => {
    const result = await scan(["test/fixtures/project/py/handler.py"], { snapshot, root: process.cwd() });
    const report = check(result, snapshot);
    expect(failsGate(report, ["absent"])).toBe(true); // ses is not in the emulator
    expect(failsGate(report, ["failing"])).toBe(false);
    expect(failsGate(report, [])).toBe(false);
  });
});

describe("explain", () => {
  it("returns the same grade as the verdict", () => {
    expect(explain("dynamodb:PutItem", snapshot)).toMatchObject({ key: "dynamodb:PutItem", grade: "partial", confidence: "high" });
  });

  it("rejects a key that is not service:Operation", () => {
    expect(() => explain("dynamodb", snapshot)).toThrow(/service:Operation/);
    expect(() => explain(":PutItem", snapshot)).toThrow(TypeError);
  });
});
