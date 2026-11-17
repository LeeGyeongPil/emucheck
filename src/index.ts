/** Public API of emucheck. Everything not exported here is internal. */
export { scan } from "./scan.js";
export { check, explain, failsGate, gradeOperation } from "./verdict.js";
export type { Explanation, Verdict } from "./verdict.js";
export { loadSnapshot, SnapshotFormatError, validateSnapshot } from "./data/schema.js";
export { buildSnapshot } from "./data/build.js";
export type { BuildOptions } from "./data/build.js";
export { Names, xformName } from "./names.js";
export { renderJson } from "./report/json.js";
export { renderSarif } from "./report/sarif.js";
export { renderTable } from "./report/table.js";
export { resolveLang, t } from "./i18n/index.js";
export type { Lang } from "./i18n/index.js";
export { GRADE_ORDER } from "./types.js";
export type {
  Call,
  Confidence,
  Evidence,
  Extraction,
  Finding,
  Grade,
  Note,
  OpEvidence,
  Report,
  Resource,
  ResourceFinding,
  ScanOptions,
  ScanResult,
  ServiceInfo,
  Site,
  Snapshot,
  SnapshotMeta,
  Unresolved,
} from "./types.js";
export { UsageError } from "./files.js";
