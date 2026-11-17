import { readFileSync } from "node:fs";
import { loadSnapshot } from "./data/schema.js";
import { extractCloudFormation, extractTerraform, looksLikeCloudFormation } from "./extract/iac.js";
import { extractJs } from "./extract/js.js";
import { extractPython } from "./extract/python.js";
import { collectFiles } from "./files.js";
import { Names } from "./names.js";
import type { Call, Resource, ScanOptions, ScanResult, Skipped, Unresolved } from "./types.js";

function compareCalls(a: Call, b: Call): number {
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  if (a.line !== b.line) return a.line - b.line;
  const ka = `${a.service}:${a.op}:${a.how}`;
  const kb = `${b.service}:${b.op}:${b.how}`;
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

/**
 * Statically extract AWS API calls and infrastructure resources from files and directories.
 * Nothing is executed and no network is used.
 */
export async function scan(paths: string[], options: ScanOptions = {}): Promise<ScanResult> {
  const snapshot = options.snapshot ?? loadSnapshot();
  const names = new Names(snapshot);
  const root = options.root ?? process.cwd();
  const skipped: Skipped[] = [];
  const files = collectFiles(paths, root, options.ignore ?? [], skipped);

  const calls: Call[] = [];
  const resources: Resource[] = [];
  const unresolved: Unresolved[] = [];

  for (const file of files) {
    let text: string;
    try {
      text = readFileSync(file.abs, "utf8");
    } catch {
      skipped.push({ file: file.rel, reason: "unreadable" });
      continue;
    }
    if (file.kind === "js") {
      if (!text.includes("@aws-sdk/")) continue;
      const found = extractJs(text, file.rel, names);
      calls.push(...found.calls);
      unresolved.push(...found.unresolved);
    } else if (file.kind === "python") {
      if (!/boto3|botocore/.test(text)) continue;
      const found = extractPython(text, file.rel, names);
      calls.push(...found.calls);
      unresolved.push(...found.unresolved);
    } else if (file.kind === "terraform") {
      resources.push(...extractTerraform(text, file.rel, names));
    } else if (looksLikeCloudFormation(text)) {
      const cfn = extractCloudFormation(text, file.rel, names);
      resources.push(...cfn.resources);
      if (cfn.parseErrors > 0) skipped.push({ file: file.rel, reason: "template-parse" });
    }
  }

  skipped.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  calls.sort(compareCalls);
  return { calls: dedupe(calls), resources, unresolved, filesScanned: files.length, skipped };
}

function dedupe(calls: Call[]): Call[] {
  const out: Call[] = [];
  for (const call of calls) {
    const last = out[out.length - 1];
    if (last && compareCalls(last, call) === 0 && last.extraction === call.extraction) continue;
    out.push(call);
  }
  return out;
}
