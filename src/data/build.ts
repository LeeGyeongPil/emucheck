import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { Names, compact, jsPackageName } from "../names.js";
import type { OpEvidence, ServiceInfo, Snapshot } from "../types.js";
import { SNAPSHOT_SCHEMA_VERSION } from "./schema.js";

export interface BuildOptions {
  /**
   * Directory with the already downloaded raw inputs:
   * `scores.json`, `manifest.jsonl`, `issues/*.md`, `services/<crate>/src/ops/*.rs`,
   * `botocore/<service>/<version>/service-2.json[.gz]` and `meta.json`.
   */
  rawDir: string;
  /** Build time written into the snapshot; defaults to now. Tests pass a fixed value. */
  builtAt?: string;
}

interface RawMeta {
  release: string;
  manifestCommit: string;
  botocore: string;
}

interface ScoreStep {
  operation: string;
  outcome: string;
}

interface ScoreUnit {
  kind: "wire" | "behavioral";
  outcome: string;
  unitId: string;
  services: string[];
  detail?: { steps?: ScoreStep[]; checkId?: string };
}

interface ManifestRow {
  check_id: string;
  operations: string[];
  path: string;
}

const MAX_FAILED_UNITS = 3;
const MAX_FAIL_SAMPLES = 3;
const MAX_PASS_SAMPLES = 2;

function readJsonMaybeGz(path: string): unknown {
  const raw = readFileSync(path);
  const isGzip = raw.length > 2 && raw[0] === 0x1f && raw[1] === 0x8b;
  return JSON.parse((isGzip ? gunzipSync(raw) : raw).toString("utf8"));
}

/** Parse the header block of an issue record: the `Issue-*` lines before the first blank or `#` line. */
export function parseIssueHeader(text: string): { keys: string[]; severity: string } {
  const keys: string[] = [];
  let severity = "UNKNOWN";
  for (const line of text.split("\n")) {
    if (line.trim() === "" || line.startsWith("#")) break;
    const at = line.indexOf(": ");
    if (at < 0) continue;
    const name = line.slice(0, at);
    const value = line.slice(at + 2).trim();
    if (name === "Issue-Key") keys.push(value);
    else if (name === "Issue-Severity") severity = value;
  }
  return { keys, severity };
}

/** Read the first bytes of a Rust ops file; enough for the `//! @op` and SCAFFOLDED header lines. */
function readHead(path: string): string {
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(4096);
    const n = readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.toString("utf8", 0, n);
  } finally {
    closeSync(fd);
  }
}

/** Build the compact evidence snapshot from raw upstream data. Pure and offline. */
export function buildSnapshot(options: BuildOptions): Snapshot {
  const raw = options.rawDir;
  const rawMeta = JSON.parse(readFileSync(join(raw, "meta.json"), "utf8")) as RawMeta;

  // 1) botocore: service names and operation lists
  const services: Record<string, ServiceInfo> = {};
  const botocoreDir = join(raw, "botocore");
  for (const service of readdirSync(botocoreDir).sort()) {
    const versions = readdirSync(join(botocoreDir, service)).sort();
    const latest = versions[versions.length - 1];
    if (!latest) continue;
    const dir = join(botocoreDir, service, latest);
    const file = existsSync(join(dir, "service-2.json")) ? "service-2.json" : "service-2.json.gz";
    const doc = readJsonMaybeGz(join(dir, file)) as {
      metadata: { serviceId?: string; endpointPrefix?: string };
      operations: Record<string, unknown>;
    };
    const serviceId = doc.metadata.serviceId ?? service;
    services[service] = {
      serviceId,
      js: jsPackageName(serviceId),
      ns: compact(serviceId),
      endpointPrefix: doc.metadata.endpointPrefix ?? service,
      ops: Object.keys(doc.operations).sort(),
      emulator: false,
    };
  }
  const names = new Names({ services });
  const endpointToService = new Map<string, string>();
  for (const service of Object.keys(services).sort()) {
    const prefix = services[service]!.endpointPrefix;
    if (!endpointToService.has(prefix)) endpointToService.set(prefix, service);
  }
  const resolveService = (token: string): string | undefined => {
    if (names.hasService(token)) return token;
    return endpointToService.get(token) ?? names.fromSmithyNamespace(token);
  };

  // 2) emulator ops files: which handlers exist and which are scaffolded stubs
  const ops: Record<string, OpEvidence> = {};
  const ensure = (key: string): OpEvidence => (ops[key] ??= {});
  const servicesDir = join(raw, "services");
  const handlers = new Map<string, { service: string; op: string; stubFiles: string[]; implemented: number }>();
  if (existsSync(servicesDir)) {
    for (const crate of readdirSync(servicesDir).sort()) {
      const parts = crate.split("-");
      const service = parts[0] === "service" ? names.fromSmithyNamespace(parts[3] ?? "") : undefined;
      const opsDir = join(servicesDir, crate, "src", "ops");
      if (!service || !existsSync(opsDir)) continue;
      for (const file of readdirSync(opsDir).sort()) {
        if (!file.endsWith(".rs") || file === "mod.rs") continue;
        const head = readHead(join(opsDir, file));
        const op = /^\/\/! @op (\w+)/m.exec(head)?.[1];
        if (!op) continue;
        const key = `${service}:${op}`;
        const entry = handlers.get(key) ?? { service, op, stubFiles: [], implemented: 0 };
        if (/^\/\/! SCAFFOLDED, NOT IMPLEMENTED/m.test(head)) entry.stubFiles.push(`${crate}/src/ops/${file}`);
        else entry.implemented++;
        handlers.set(key, entry);
      }
    }
  }
  const emuOps = new Map<string, Set<string>>();
  for (const [key, entry] of [...handlers].sort(([a], [b]) => (a < b ? -1 : 1))) {
    services[entry.service]!.emulator = true;
    let set = emuOps.get(entry.service);
    if (!set) emuOps.set(entry.service, (set = new Set()));
    set.add(entry.op);
    if (entry.implemented === 0 && entry.stubFiles.length > 0) ensure(key).stub = entry.stubFiles[0]!;
  }
  for (const [service, set] of emuOps) services[service]!.emuOps = [...set].sort();

  // 3) test scores: wire steps are exact per operation, behavioral checks come from the manifest
  const scores = JSON.parse(readFileSync(join(raw, "scores.json"), "utf8")) as { commit: string; scoredAt: string; units: ScoreUnit[] };
  const manifest = new Map<string, ManifestRow>();
  for (const line of readFileSync(join(raw, "manifest.jsonl"), "utf8").split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as ManifestRow;
    manifest.set(row.check_id, row);
  }
  const known = (key: string): boolean => {
    const i = key.indexOf(":");
    return names.hasOp(key.slice(0, i), key.slice(i + 1));
  };
  const fidelity: Record<string, { pass: number; fail: number; skipped: number }> = {};
  const failSamples = new Map<string, { path: string; outcome: string }[]>();
  const passSamples = new Map<string, { path: string; outcome: string }[]>();
  for (const unit of scores.units) {
    const outcome = unit.outcome === "pass" || unit.outcome === "fail" ? unit.outcome : "skipped";
    const unitServices = new Set<string>();
    for (const shape of unit.services) {
      const ns = shape.split("#")[0]!.replace(/^com\.amazonaws\./, "");
      const service = names.fromSmithyNamespace(ns);
      if (service) unitServices.add(service);
    }
    for (const service of unitServices) {
      const f = (fidelity[service] ??= { pass: 0, fail: 0, skipped: 0 });
      f[outcome]++;
    }
    if (unit.kind === "wire") {
      const service = [...unitServices][0];
      if (!service) continue;
      for (const step of unit.detail?.steps ?? []) {
        const key = `${service}:${step.operation}`;
        if (!known(key)) continue;
        const wire = (ensure(key).wire ??= { pass: 0, fail: 0, failedUnits: [] });
        if (step.outcome === "pass") wire.pass++;
        else {
          wire.fail++;
          if (wire.failedUnits.length < MAX_FAILED_UNITS && !wire.failedUnits.includes(unit.unitId)) wire.failedUnits.push(unit.unitId);
        }
      }
    } else {
      const row = manifest.get(unit.unitId);
      if (!row) continue;
      for (const key of new Set(row.operations)) {
        if (!known(key)) continue;
        const beh = (ensure(key).beh ??= { pass: 0, fail: 0, skipped: 0, checks: 0, samples: [] });
        beh[outcome]++;
        beh.checks++;
        const target = outcome === "fail" ? failSamples : passSamples;
        const list = target.get(key) ?? [];
        if (list.length < (outcome === "fail" ? MAX_FAIL_SAMPLES : MAX_PASS_SAMPLES) && outcome !== "skipped") {
          list.push({ path: row.path, outcome });
          target.set(key, list);
        }
      }
    }
  }
  for (const [key, evidence] of Object.entries(ops)) {
    if (evidence.beh) evidence.beh.samples = [...(failSamples.get(key) ?? []), ...(passSamples.get(key) ?? [])];
  }
  for (const [service, f] of Object.entries(fidelity)) services[service]!.fidelity = f;

  // 4) open "things that do not work" records
  const issuesDir = join(raw, "issues");
  let unparsedIssues = 0;
  let unmappedIssueKeys = 0;
  const checkIssues: Record<string, { file: string; severity: string }[]> = {};
  if (existsSync(issuesDir)) {
    for (const file of readdirSync(issuesDir).filter((f) => f.endsWith(".md")).sort()) {
      const { keys, severity } = parseIssueHeader(readFileSync(join(issuesDir, file), "utf8"));
      if (keys.length === 0) {
        unparsedIssues++;
        continue;
      }
      for (const key of keys) {
        const bar = key.split("|");
        const first = bar[0]!;
        if (first.includes(".") && !(bar.length >= 2 && resolveService(first))) {
          // `svc.check-id|run#N|ErrorKind|...`: a failing behavioral check, not tied to one operation
          const service = resolveService(first.slice(0, first.indexOf(".")));
          if (!service) {
            unmappedIssueKeys++;
            continue;
          }
          const list = (checkIssues[first] ??= []);
          if (!list.some((entry) => entry.file === file)) list.push({ file, severity });
        } else if (bar.length >= 2) {
          // `svc|Operation|kind`, where svc is a boto3 name or an endpoint prefix
          const service = resolveService(first);
          const opKey = service ? `${service}:${bar[1]!}` : "";
          if (!service || !known(opKey)) {
            unmappedIssueKeys++;
            continue;
          }
          const list = (ensure(opKey).issues ??= []);
          // one record per file and operation, even when the file lists several failure kinds
          if (!list.some((entry) => entry.file === file)) list.push({ file, severity, kind: bar.slice(2).join("|") });
        } else {
          unmappedIssueKeys++;
        }
      }
    }
  }

  // 5) assemble with sorted keys so that the same input always gives the same bytes
  const sortedServices: Record<string, ServiceInfo> = {};
  for (const name of Object.keys(services).sort()) sortedServices[name] = services[name]!;
  const sortedOps: Record<string, OpEvidence> = {};
  for (const key of Object.keys(ops).sort()) sortedOps[key] = ops[key]!;
  const snapshot: Snapshot = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    meta: {
      release: rawMeta.release,
      commit: scores.commit,
      scoredAt: scores.scoredAt,
      manifestCommit: rawMeta.manifestCommit,
      botocore: rawMeta.botocore,
      builtAt: options.builtAt ?? new Date().toISOString(),
      units: scores.units.length,
      unparsedIssues,
      unmappedIssueKeys,
    },
    services: sortedServices,
    ops: sortedOps,
  };
  if (Object.keys(checkIssues).length > 0) {
    const sortedChecks: typeof checkIssues = {};
    for (const key of Object.keys(checkIssues).sort()) sortedChecks[key] = checkIssues[key]!;
    snapshot.checkIssues = sortedChecks;
  }
  return snapshot;
}
