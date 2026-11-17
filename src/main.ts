import { parseArgs } from "node:util";
import { SnapshotFormatError, loadSnapshot } from "./data/schema.js";
import { UsageError } from "./files.js";
import { resolveLang, t, type Lang } from "./i18n/index.js";
import { renderJson } from "./report/json.js";
import { renderSarif } from "./report/sarif.js";
import { renderNote, renderTable, skippedLines, snapshotAgeDays, snapshotLine, STALE_DAYS } from "./report/table.js";
import { scan } from "./scan.js";
import type { Grade, ScanResult } from "./types.js";
import { GRADE_ORDER } from "./types.js";
import { check, explain, failsGate } from "./verdict.js";
import { VERSION } from "./version.js";

export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  env: Record<string, string | undefined>;
  /** Working directory used for relative paths in the output. */
  cwd: string;
}

const DEFAULT_FAIL_ON: Grade[] = ["absent", "stub"];

/** Exit codes: 0 ok, 1 gate failed, 2 usage or input error, 3 unexpected internal error. */
export async function run(argv: string[], io: Io): Promise<number> {
  let lang: Lang = resolveLang({ env: io.env });
  try {
    const parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        format: { type: "string" },
        "fail-on": { type: "string" },
        "show-unresolved": { type: "boolean", default: false },
        ignore: { type: "string", multiple: true },
        data: { type: "string" },
        lang: { type: "string" },
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
      },
    });
    const values = parsed.values;

    if (values.lang !== undefined) {
      if (values.lang !== "en" && values.lang !== "ko") throw new UsageError(`Unsupported language "${values.lang}".`, "bad-lang", { value: values.lang });
      lang = resolveLang({ flag: values.lang, env: io.env });
    }
    if (values.version) {
      io.stdout(`${VERSION}\n`);
      return 0;
    }
    const [command, ...rest] = parsed.positionals;
    if (values.help) {
      io.stdout(`${t(lang, "help.text", { version: VERSION })}\n`);
      return 0;
    }
    if (!command) {
      io.stderr(`${t(lang, "help.text", { version: VERSION })}\n`);
      return 2;
    }

    const dataPath = values.data ?? io.env["EMUCHECK_DATA"];
    const format = values.format ?? "table";
    if (!["table", "json", "sarif"].includes(format)) throw new UsageError(`Unknown format "${format}".`, "bad-format", { value: format });

    switch (command) {
      case "check":
        return await runCheck(rest, { lang, format, dataPath, io, values });
      case "scan":
        return await runScan(rest, { lang, format, dataPath, io, values });
      case "explain":
        return runExplain(rest, { lang, format, dataPath, io });
      case "data-info":
        return runDataInfo({ lang, dataPath, io });
      default:
        throw new UsageError(`Unknown command "${command}".`, "unknown-command", { name: command });
    }
  } catch (error) {
    return reportError(error, lang, io);
  }
}

interface Values {
  "fail-on"?: string;
  "show-unresolved"?: boolean;
  ignore?: string[];
}

interface Common {
  lang: Lang;
  format: string;
  dataPath: string | undefined;
  io: Io;
}

function parseFailOn(value: string | undefined): Grade[] {
  if (value === undefined) return DEFAULT_FAIL_ON;
  if (value.trim() === "none") return [];
  const grades: Grade[] = [];
  for (const raw of value.split(",")) {
    const name = raw.trim();
    if (!(GRADE_ORDER as readonly string[]).includes(name)) {
      throw new UsageError(`Unknown grade "${name}" in --fail-on.`, "bad-grade", { value: name, grades: GRADE_ORDER.join(", ") });
    }
    grades.push(name as Grade);
  }
  return grades;
}

async function runCheck(paths: string[], c: Common & { values: Values }): Promise<number> {
  const failOn = parseFailOn(c.values["fail-on"]);
  const snapshot = loadSnapshot(c.dataPath);
  const result = await scan(paths.length > 0 ? paths : ["."], { ignore: c.values.ignore ?? [], root: c.io.cwd, snapshot });
  const report = check(result, snapshot);

  if (c.format === "json") c.io.stdout(renderJson(report));
  else if (c.format === "sarif") c.io.stdout(renderSarif(report, c.lang));
  else c.io.stdout(renderTable(report, { lang: c.lang, showUnresolved: c.values["show-unresolved"] === true }));

  const failed = failsGate(report, failOn);
  if (failOn.length === 0) c.io.stderr(`${t(c.lang, "summary.gate.none")}\n`);
  else if (failed) {
    const found = failOn.filter((g) => report.summary.byGrade[g] > 0 || report.resources.some((r) => r.grade === g));
    c.io.stderr(`${t(c.lang, "summary.gate.fail", { grades: found.join(", "), failOn: failOn.join(",") })}\n`);
  } else c.io.stderr(`${t(c.lang, "summary.gate.pass", { failOn: failOn.join(",") })}\n`);
  return failed ? 1 : 0;
}

async function runScan(paths: string[], c: Common & { values: Values }): Promise<number> {
  if (c.format === "sarif") throw new UsageError("scan supports --format table or json.", "scan-format");
  const snapshot = loadSnapshot(c.dataPath);
  const result = await scan(paths.length > 0 ? paths : ["."], { ignore: c.values.ignore ?? [], root: c.io.cwd, snapshot });
  if (c.format === "json") {
    c.io.stdout(`${JSON.stringify({ tool: "emucheck", version: VERSION, ...result }, null, 2)}\n`);
    return 0;
  }
  c.io.stdout(renderScan(result, c.lang, c.values["show-unresolved"] === true));
  return 0;
}

function renderScan(result: ScanResult, lang: Lang, showUnresolved: boolean): string {
  const lines: string[] = [];
  for (const call of result.calls) {
    lines.push(`${call.file}:${call.line}  ${call.service}:${call.op}  ${call.how}  ${t(lang, `table.extraction.${call.extraction}`)}`);
  }
  for (const r of result.resources) lines.push(`${r.file}:${r.line}  ${r.type}  ${r.service || "?"}`);
  if (showUnresolved) {
    for (const u of result.unresolved) lines.push(`${u.file}:${u.line}  ${t(lang, `unresolved.reason.${u.reason}`)}`);
  }
  lines.push(
    t(lang, "scan.summary", {
      calls: result.calls.length,
      resources: result.resources.length,
      unresolved: result.unresolved.length,
      files: result.filesScanned,
    }),
  );
  if (!showUnresolved && result.unresolved.length > 0) lines.push(t(lang, "summary.hint.unresolved"));
  lines.push(...skippedLines(lang, result.skipped));
  return `${lines.join("\n")}\n`;
}

function runExplain(args: string[], c: Common): number {
  const key = args[0];
  if (!key) throw new UsageError("explain needs an operation such as dynamodb:PutItem.", "missing-key");
  if (!/^[^:\s]+:[^:\s]+$/.test(key)) throw new UsageError(`"${key}" is not in the form service:Operation.`, "bad-key", { key });
  const snapshot = loadSnapshot(c.dataPath);
  const result = explain(key, snapshot);

  if (c.format === "json") {
    c.io.stdout(`${JSON.stringify({ tool: "emucheck", version: VERSION, snapshot: snapshot.meta, ...result }, null, 2)}\n`);
    return 0;
  }
  const { lang } = c;
  const lines = [
    snapshotLine(lang, snapshot.meta),
    "",
    t(lang, "explain.title", { key, grade: result.grade, confidence: t(lang, `table.conf.${result.confidence}`) }),
    t(lang, "explain.grade", { text: t(lang, `grade.desc.${result.grade}`) }),
  ];
  const ev = result.evidence;
  if (ev.wire) {
    lines.push(t(lang, "explain.wire", { pass: ev.wire.pass, fail: ev.wire.fail }));
    if (ev.wire.failedUnits.length > 0) lines.push(t(lang, "explain.failed-units", { units: ev.wire.failedUnits.join(", ") }));
  }
  if (ev.behavioral) {
    lines.push(
      t(lang, "explain.behavioral", {
        pass: ev.behavioral.pass,
        fail: ev.behavioral.fail,
        skipped: ev.behavioral.skipped,
        checks: ev.behavioral.checks,
      }),
    );
  }
  if (ev.issues.length > 0) {
    lines.push(t(lang, "explain.issues", { count: ev.issues.length }));
    for (const issue of ev.issues.slice(0, 5)) lines.push(`  ${issue.severity}  ${issue.kind}  ${issue.file}`);
    if (ev.issues.length > 5) lines.push(t(lang, "explain.issues-more", { count: ev.issues.length - 5 }));
  }
  if (ev.stub) lines.push(t(lang, "explain.stub", { path: ev.stub }));
  if (result.notes.length > 0) {
    lines.push(t(lang, "explain.notes"));
    for (const note of result.notes) lines.push(`  - ${renderNote(lang, note)}`);
  }
  if (ev.urls.length > 0) {
    lines.push(t(lang, "explain.links"));
    for (const url of ev.urls) lines.push(`  ${url}`);
  }
  c.io.stdout(`${lines.join("\n")}\n`);
  return 0;
}

function runDataInfo(c: { lang: Lang; dataPath: string | undefined; io: Io }): number {
  const snapshot = loadSnapshot(c.dataPath);
  const { lang } = c;
  const m = snapshot.meta;
  const services = Object.values(snapshot.services);
  const stubs = Object.values(snapshot.ops).filter((o) => o.stub).length;
  const days = snapshotAgeDays(m.scoredAt, new Date());
  const lines = [
    t(lang, "info.title"),
    t(lang, "info.release", { value: m.release }),
    t(lang, "info.commit", { value: m.commit }),
    t(lang, "info.scoredAt", { value: m.scoredAt }),
    t(lang, "info.manifest", { value: m.manifestCommit }),
    t(lang, "info.botocore", { value: m.botocore }),
    t(lang, "info.builtAt", { value: m.builtAt }),
    t(lang, "info.counts", {
      services: services.length,
      emulated: services.filter((s) => s.emulator).length,
      ops: Object.keys(snapshot.ops).length,
      stubs,
    }),
    t(lang, "info.units", { units: m.units, unparsed: m.unparsedIssues }),
    t(lang, "info.age", { days }),
  ];
  if (days > STALE_DAYS) lines.push(t(lang, "warn.stale", { days, scoredAt: m.scoredAt }));
  c.io.stdout(`${lines.join("\n")}\n`);
  return 0;
}

function reportError(error: unknown, lang: Lang, io: Io): number {
  if (error instanceof UsageError) {
    const key = `error.${error.code}`;
    const text = error.code === "usage" ? error.message : t(lang, key, error.params);
    io.stderr(`emucheck: ${text}\n`);
    return 2;
  }
  if (error instanceof SnapshotFormatError) {
    io.stderr(`emucheck: ${t(lang, "error.snapshot", { detail: error.message })}\n`);
    return 2;
  }
  if (error instanceof TypeError && (error as NodeJS.ErrnoException).code?.startsWith("ERR_PARSE_ARGS")) {
    io.stderr(`emucheck: ${t(lang, "error.bad-option", { detail: error.message })}\n`);
    return 2;
  }
  io.stderr(`emucheck: unexpected error: ${(error as Error).message}\n`);
  return 3;
}
