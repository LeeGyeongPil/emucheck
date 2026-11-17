import { Names } from "./names.js";
import type {
  Call,
  Confidence,
  Evidence,
  Finding,
  Grade,
  Note,
  Report,
  ResourceFinding,
  ScanResult,
  Site,
  Snapshot,
} from "./types.js";
import { GRADE_ORDER } from "./types.js";

const RELEASE_URL = "https://github.com/aws/aws-emulator/releases/tag/";
const REPO_URL = "https://github.com/aws/aws-emulator/blob/";
const ISSUE_PATH = "/issues/things-that-do-not-work/";
const STUB_PATH = "/services/";
const SUITE_URL = "https://github.com/aws/aws-emulator-evaluation-suite/blob/main/";
const MAX_URLS = 5;

export interface Verdict {
  grade: Grade;
  confidence: Confidence;
  evidence: Evidence;
  notes: Note[];
}

/** Levenshtein distance, used only to suggest a corrected operation name. */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length]!;
}

function closestOp(ops: Iterable<string>, op: string): string | undefined {
  let best: string | undefined;
  let bestDistance = 3;
  for (const candidate of ops) {
    const d = distance(candidate.toLowerCase(), op.toLowerCase());
    if (d < bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }
  return best;
}

/** Grade one operation using the ordered rules (the first rule that matches wins). */
export function gradeOperation(snapshot: Snapshot, names: Names, service: string, op: string): Verdict {
  const evidence: Evidence = { issues: [], urls: [] };
  const notes: Note[] = [];

  // 1. unknown-op: not in botocore, so a typo or an extraction error
  if (!names.hasService(service)) {
    notes.push({ code: "unknown-service", params: { service } });
    return { grade: "unknown-op", confidence: "high", evidence, notes };
  }
  if (!names.hasOp(service, op)) {
    notes.push({ code: "unknown-operation", params: { service, op } });
    const suggestion = closestOp(names.opsOf(service), op);
    if (suggestion) notes.push({ code: "did-you-mean", params: { op: suggestion } });
    return { grade: "unknown-op", confidence: "high", evidence, notes };
  }

  evidence.urls.push(`${RELEASE_URL}${snapshot.meta.release}`);
  const info = snapshot.services[service]!;
  const ev = snapshot.ops[`${service}:${op}`];

  // 2. absent: botocore has it, the emulator has no handler (or no service) for it
  if (!info.emulator) {
    notes.push({ code: "service-absent", params: { service } });
    return { grade: "absent", confidence: "high", evidence, notes };
  }
  if (info.emuOps && !info.emuOps.includes(op)) {
    notes.push({ code: "op-absent", params: { service, op } });
    return { grade: "absent", confidence: "high", evidence, notes };
  }

  if (ev?.wire) evidence.wire = ev.wire;
  if (ev?.beh) evidence.behavioral = { pass: ev.beh.pass, fail: ev.beh.fail, skipped: ev.beh.skipped, checks: ev.beh.checks };
  if (ev?.issues) evidence.issues = ev.issues;
  if (ev?.stub) evidence.stub = ev.stub;
  for (const issue of (ev?.issues ?? []).slice(0, MAX_URLS)) evidence.urls.push(`${REPO_URL}${snapshot.meta.release}${ISSUE_PATH}${issue.file}`);
  for (const sample of (ev?.beh?.samples ?? []).slice(0, MAX_URLS)) evidence.urls.push(`${SUITE_URL}${sample.path}`);

  // 3. stub: the handler file is a scaffold that answers HTTP 501
  if (ev?.stub) {
    evidence.urls.push(`${REPO_URL}${snapshot.meta.release}${STUB_PATH}${ev.stub}`);
    notes.push({ code: "stub-501" });
    return { grade: "stub", confidence: "high", evidence, notes };
  }

  const wire = ev?.wire;
  const beh = ev?.beh;
  const issues = ev?.issues ?? [];
  if (issues.length > 0) notes.push({ code: "open-issues", params: { count: issues.length } });

  if (wire && wire.pass + wire.fail > 0) {
    // 4. failing: every attributed wire step failed
    if (wire.pass === 0) return { grade: "failing", confidence: "high", evidence, notes };
    // 5. partial: wire steps mixed
    if (wire.fail > 0) return { grade: "partial", confidence: "high", evidence, notes };
    // wire steps all pass
    if (beh && beh.fail > 0) notes.push({ code: "related-behavioral-failures", params: { fail: beh.fail, total: beh.pass + beh.fail } });
    // 6b. an open record next to passing steps: the record may be stale
    if (issues.length > 0) {
      notes.push({ code: "stale-possible" });
      return { grade: "partial", confidence: "low", evidence, notes };
    }
    // 7. passing on step evidence
    return { grade: "passing", confidence: "high", evidence, notes };
  }

  if (beh && beh.pass + beh.fail > 0) {
    // 6a. behavioral-only failure is a weak signal, never "failing"
    if (beh.fail > 0) {
      notes.push({ code: "behavioral-only", params: { fail: beh.fail, total: beh.pass + beh.fail } });
      return { grade: "partial", confidence: "low", evidence, notes };
    }
    if (issues.length > 0) {
      notes.push({ code: "stale-possible" });
      return { grade: "partial", confidence: "low", evidence, notes };
    }
    // 7. passing on related checks only
    return { grade: "passing", confidence: "low", evidence, notes };
  }

  // an open record is the only evidence
  if (issues.length > 0) {
    notes.push({ code: "stale-possible" });
    return { grade: "partial", confidence: "low", evidence, notes };
  }

  // 8. untested
  return { grade: "untested", confidence: "low", evidence, notes };
}

function siteOf(call: Call): Site {
  return { file: call.file, line: call.line, how: call.how, extraction: call.extraction };
}

function emptyGrades(): Record<Grade, number> {
  return Object.fromEntries(GRADE_ORDER.map((g) => [g, 0])) as Record<Grade, number>;
}

/** Join scan results with the snapshot and grade every distinct operation and IaC service. */
export function check(result: ScanResult, snapshot: Snapshot): Report {
  const names = new Names(snapshot);
  const byKey = new Map<string, Call[]>();
  for (const call of result.calls) {
    const key = `${call.service}:${call.op}`;
    const list = byKey.get(key);
    if (list) list.push(call);
    else byKey.set(key, [call]);
  }

  const findings: Finding[] = [];
  for (const [key, calls] of byKey) {
    const first = calls[0]!;
    const verdict = gradeOperation(snapshot, names, first.service, first.op);
    findings.push({ key, ...verdict, sites: calls.map(siteOf).sort(compareSites) });
  }
  findings.sort(compareFindings);

  const resourceFindings = gradeResources(result, snapshot, names);

  const byGrade = emptyGrades();
  for (const f of findings) byGrade[f.grade]++;
  return {
    snapshot: snapshot.meta,
    summary: {
      findings: findings.length,
      byGrade,
      certain: result.calls.filter((c) => c.extraction === "certain").length,
      inferred: result.calls.filter((c) => c.extraction === "inferred").length,
      unresolved: result.unresolved.length,
      resources: resourceFindings.length,
      filesScanned: result.filesScanned,
      skipped: result.skipped.length,
    },
    skipped: result.skipped,
    findings,
    resources: resourceFindings,
    unresolved: result.unresolved,
  };
}

/** IaC resources are graded per service: the emulator either ships the service or it does not. */
function gradeResources(result: ScanResult, snapshot: Snapshot, names: Names): ResourceFinding[] {
  const groups = new Map<string, ResourceFinding>();
  for (const r of result.resources) {
    if (!r.service || !names.hasService(r.service)) continue;
    const key = `${r.kind}\u0000${r.type}`;
    let group = groups.get(key);
    if (!group) {
      const info = snapshot.services[r.service]!;
      const notes: Note[] = [];
      let grade: Grade;
      if (!info.emulator) {
        grade = "absent";
        notes.push({ code: "service-absent", params: { service: r.service } });
      } else {
        grade = "untested";
        const f = info.fidelity;
        notes.push({ code: "service-level", params: { pass: f?.pass ?? 0, total: (f?.pass ?? 0) + (f?.fail ?? 0) } });
      }
      group = { type: r.type, service: r.service, kind: r.kind, grade, confidence: grade === "absent" ? "high" : "low", sites: [], notes };
      groups.set(key, group);
    }
    group.sites.push({ file: r.file, line: r.line });
  }
  const list = [...groups.values()];
  for (const g of list) g.sites.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  list.sort((a, b) => GRADE_ORDER.indexOf(a.grade) - GRADE_ORDER.indexOf(b.grade) || a.type.localeCompare(b.type));
  return list;
}

function compareSites(a: Site, b: Site): number {
  return a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line || (a.how < b.how ? -1 : a.how > b.how ? 1 : 0);
}

function compareFindings(a: Finding, b: Finding): number {
  const g = GRADE_ORDER.indexOf(a.grade) - GRADE_ORDER.indexOf(b.grade);
  if (g !== 0) return g;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/** True when the report contains a grade listed in `failOn`; this decides exit code 1. */
export function failsGate(report: Report, failOn: readonly Grade[]): boolean {
  if (failOn.length === 0) return false;
  const set = new Set(failOn);
  return report.findings.some((f) => set.has(f.grade)) || report.resources.some((r) => set.has(r.grade));
}

export interface Explanation {
  key: string;
  grade: Grade;
  confidence: Confidence;
  evidence: Evidence;
  notes: Note[];
}

/** Evidence and grade of a single `service:Operation` key. */
export function explain(key: string, snapshot: Snapshot): Explanation {
  const index = key.indexOf(":");
  if (index <= 0 || index === key.length - 1) {
    throw new TypeError(`Invalid operation key "${key}". Use the form service:Operation, for example dynamodb:PutItem.`);
  }
  const names = new Names(snapshot);
  const verdict = gradeOperation(snapshot, names, key.slice(0, index), key.slice(index + 1));
  return { key, ...verdict };
}
