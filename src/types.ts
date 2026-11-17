/** Shared public types. */

/** Verdict grade, ordered from most to least severe (see `GRADE_ORDER`). */
export type Grade = "unknown-op" | "absent" | "stub" | "failing" | "partial" | "untested" | "passing";

/** Severity order used for sorting and for the `--fail-on` gate. */
export const GRADE_ORDER: readonly Grade[] = [
  "unknown-op",
  "absent",
  "stub",
  "failing",
  "partial",
  "untested",
  "passing",
];

export type Confidence = "high" | "low";

/** How sure the static extractor is that the call really happens. */
export type Extraction = "certain" | "inferred";

export type Sdk = "js-v3" | "boto3";

/** One AWS API call site found in source code. */
export interface Call {
  file: string;
  line: number;
  sdk: Sdk;
  /** boto3 service name (for example `logs`); the raw name when it is not a known service. */
  service: string;
  /** API operation name in PascalCase (for example `PutLogEvents`). */
  op: string;
  /** Pattern that produced the call, for example `command`, `client-method`, `paginator`. */
  how: string;
  extraction: Extraction;
}

/** One infrastructure-as-code resource found in a template. */
export interface Resource {
  file: string;
  line: number;
  kind: "cloudformation" | "terraform";
  /** Original type, for example `AWS::Logs::LogGroup` or `aws_sfn_state_machine`. */
  type: string;
  /** boto3 service name, or the empty string when the type could not be mapped. */
  service: string;
}

/** A call that could not be resolved to a concrete operation. */
export interface Unresolved {
  file: string;
  line: number;
  sdk: Sdk;
  reason: string;
}

/** A file or directory that was not analyzed, so the user can see the gap. */
export interface Skipped {
  file: string;
  reason: "too-large" | "unreadable" | "template-parse";
}

export interface ScanResult {
  calls: Call[];
  resources: Resource[];
  unresolved: Unresolved[];
  /** Number of source and template files that were read. */
  filesScanned: number;
  /** Files that were skipped (over 5 MB, unreadable, or a template that failed to parse). */
  skipped: Skipped[];
}

export interface ScanOptions {
  /** Directory names to skip in addition to the built-in list. */
  ignore?: string[];
  /** Base directory for relative paths in the result. Defaults to the current directory. */
  root?: string;
  /** Snapshot used to resolve service names. Defaults to the bundled snapshot. */
  snapshot?: Snapshot;
}

/** Test evidence attributed to one operation. */
export interface OpEvidence {
  /** Recorded HTTP steps of wire tests that call this operation. */
  wire?: { pass: number; fail: number; failedUnits: string[] };
  /** Behavioral checks that list this operation (manifest-based, not step-exact). */
  beh?: { pass: number; fail: number; skipped: number; checks: number; samples: { path: string; outcome: string }[] };
  /** Open "things that do not work" records. */
  issues?: { file: string; severity: string; kind: string }[];
  /** `crate/file.rs` of a scaffolded stub handler. */
  stub?: string;
}

export interface ServiceInfo {
  serviceId: string;
  /** JS package suffix: `@aws-sdk/client-<js>`. */
  js: string;
  /** Smithy namespace guess used by the emulator (`cloudwatchlogs`). */
  ns: string;
  endpointPrefix: string;
  /** All operations of the service according to botocore. */
  ops: string[];
  /** True when the emulator ships a crate for the service. */
  emulator: boolean;
  /** Operations that have a handler file in the emulator (implemented or stub). */
  emuOps?: string[];
  /** Service-level score: passing and failing test units. */
  fidelity?: { pass: number; fail: number; skipped: number };
}

export interface SnapshotMeta {
  release: string;
  commit: string;
  scoredAt: string;
  manifestCommit: string;
  botocore: string;
  builtAt: string;
  units: number;
  /** Issue files without any `Issue-Key` header (kept out of the index, only counted). */
  unparsedIssues: number;
  /** Issue keys whose service name could not be mapped to a boto3 service. */
  unmappedIssueKeys?: number;
}

export interface Snapshot {
  schemaVersion: 1;
  meta: SnapshotMeta;
  services: Record<string, ServiceInfo>;
  ops: Record<string, OpEvidence>;
  /** Issue records keyed by check id (`svc.check-id` form); informational, not used for grading. */
  checkIssues?: Record<string, { file: string; severity: string }[]>;
}

/** Machine-readable note codes; text is rendered per language by the report layer. */
export interface Note {
  code: string;
  params?: Record<string, string | number>;
}

export interface Evidence {
  wire?: { pass: number; fail: number; failedUnits: string[] };
  behavioral?: { pass: number; fail: number; skipped: number; checks: number };
  issues: { file: string; severity: string; kind: string }[];
  stub?: string;
  urls: string[];
}

export interface Site {
  file: string;
  line: number;
  how: string;
  extraction: Extraction;
}

export interface Finding {
  /** `service:Operation`, for example `dynamodb:PutItem`. */
  key: string;
  grade: Grade;
  confidence: Confidence;
  sites: Site[];
  evidence: Evidence;
  notes: Note[];
}

export interface ResourceFinding {
  type: string;
  service: string;
  kind: Resource["kind"];
  grade: Grade;
  confidence: Confidence;
  sites: { file: string; line: number }[];
  notes: Note[];
}

export interface Report {
  snapshot: SnapshotMeta;
  summary: {
    findings: number;
    byGrade: Record<Grade, number>;
    certain: number;
    inferred: number;
    unresolved: number;
    resources: number;
    filesScanned: number;
    skipped: number;
  };
  skipped: Skipped[];
  findings: Finding[];
  resources: ResourceFinding[];
  unresolved: Unresolved[];
}
