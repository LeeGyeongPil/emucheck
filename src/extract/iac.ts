import { LineCounter, isMap, isScalar, parseDocument } from "yaml";
import type { Names } from "../names.js";
import type { Resource } from "../types.js";

export interface IacExtraction {
  resources: Resource[];
  /** Number of YAML or JSON syntax errors; 0 for a template that parsed cleanly. */
  parseErrors: number;
}

/** Quick check so that large unrelated JSON/YAML files are never parsed as templates. */
export function looksLikeCloudFormation(text: string): boolean {
  return text.includes("AWS::") && text.includes("Resources");
}

/**
 * Extract resource types from a CloudFormation template (JSON, YAML with short tags such as `!Ref`,
 * or a CDK `cdk.out/*.template.json`). `Custom::*` resources are skipped because they have no AWS API.
 */
export function extractCloudFormation(text: string, file: string, names: Names): IacExtraction {
  const lineCounter = new LineCounter();
  // YAML 1.2 is a superset of JSON, so one parser covers both; unknown short tags only warn.
  const doc = parseDocument(text, { lineCounter, strict: false, uniqueKeys: false, logLevel: "silent" });
  const resources: Resource[] = [];
  const root = doc.contents;
  if (!isMap(root)) return { resources, parseErrors: doc.errors.length };
  const section = root.get("Resources", true);
  if (!isMap(section)) return { resources, parseErrors: doc.errors.length };
  for (const pair of section.items) {
    if (!isMap(pair.value)) continue;
    const typeNode = pair.value.get("Type", true);
    if (!isScalar(typeNode) || typeof typeNode.value !== "string") continue;
    const type = typeNode.value;
    if (!type.startsWith("AWS::")) continue; // Custom::*, Alexa::* and anything else are not AWS API users
    if (type === "AWS::CDK::Metadata") continue;
    const offset = typeNode.range?.[0] ?? 0;
    const service = names.fromCloudFormation(type) ?? "";
    resources.push({ file, line: lineCounter.linePos(offset).line, kind: "cloudformation", type, service });
  }
  return { resources, parseErrors: doc.errors.length };
}

const TERRAFORM_BLOCK = /^\s*(resource|data)\s+"(aws_[A-Za-z0-9_]+)"\s+"[^"]*"/;

/** Extract `resource "aws_*"` and `data "aws_*"` blocks from a Terraform file. */
export function extractTerraform(text: string, file: string, names: Names): Resource[] {
  const resources: Resource[] = [];
  const lines = text.split(/\r?\n/);
  let inBlockComment = false;
  lines.forEach((line, index) => {
    if (inBlockComment) {
      if (line.includes("*/")) inBlockComment = false;
      return;
    }
    const trimmed = line.trimStart();
    if (trimmed.startsWith("/*")) {
      if (!trimmed.includes("*/")) inBlockComment = true;
      return;
    }
    if (trimmed.startsWith("#") || trimmed.startsWith("//")) return;
    const m = TERRAFORM_BLOCK.exec(line);
    if (!m) return;
    const type = m[2]!;
    resources.push({ file, line: index + 1, kind: "terraform", type, service: names.fromTerraform(type) ?? "" });
  });
  return resources;
}
