import { t, type Lang } from "../i18n/index.js";
import type { Evidence, Grade, Note, Report, Skipped } from "../types.js";
import { GRADE_ORDER } from "../types.js";

/** Snapshots older than this many days get a warning (exit code is not affected). */
export const STALE_DAYS = 14;

/** Display width: Hangul and CJK characters take two terminal columns. */
export function displayWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    const wide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xff00 && code <= 0xff60);
    width += wide ? 2 : 1;
  }
  return width;
}

function pad(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - displayWidth(text)));
}

function renderRows(rows: string[][]): string[] {
  const widths: number[] = [];
  for (const row of rows) row.forEach((cell, i) => (widths[i] = Math.max(widths[i] ?? 0, displayWidth(cell))));
  return rows.map((row) =>
    row
      .map((cell, i) => (i === row.length - 1 ? cell : pad(cell, widths[i]!)))
      .join("  ")
      .trimEnd(),
  );
}

/** Render one machine note (code plus parameters) as text in the chosen language. */
export function renderNote(lang: Lang, note: Note): string {
  return t(lang, `note.${note.code}`, note.params ?? {});
}

function evidenceText(lang: Lang, evidence: Evidence): string {
  const parts: string[] = [];
  if (evidence.stub) parts.push(t(lang, "evidence.stub"));
  if (evidence.wire) parts.push(t(lang, "evidence.wire", { pass: evidence.wire.pass, fail: evidence.wire.fail }));
  else if (evidence.behavioral && evidence.behavioral.pass + evidence.behavioral.fail > 0) {
    parts.push(t(lang, "evidence.behavioral", { pass: evidence.behavioral.pass, fail: evidence.behavioral.fail }));
  }
  return parts.length > 0 ? parts.join(", ") : t(lang, "evidence.none");
}

export interface TableOptions {
  lang: Lang;
  showUnresolved: boolean;
  /** Current time, injectable for tests. */
  now?: Date;
}

/** Days between the snapshot scoring time and `now`, rounded down. */
export function snapshotAgeDays(scoredAt: string, now: Date): number {
  const scored = Date.parse(scoredAt);
  if (Number.isNaN(scored)) return 0;
  return Math.max(0, Math.floor((now.getTime() - scored) / 86_400_000));
}

export function snapshotLine(lang: Lang, meta: Report["snapshot"]): string {
  return t(lang, "table.snapshot", {
    release: meta.release,
    commit: meta.commit.slice(0, 7),
    scoredAt: meta.scoredAt,
    botocore: meta.botocore,
  });
}

/** Human-readable report. */
/** Lines that tell the user which files were not analyzed (empty when nothing was skipped). */
export function skippedLines(lang: Lang, skipped: Skipped[]): string[] {
  if (skipped.length === 0) return [];
  const lines = [t(lang, "skipped.title", { count: skipped.length })];
  for (const s of skipped.slice(0, 10)) lines.push(`  ${s.file}  ${t(lang, `skipped.reason.${s.reason}`)}`);
  if (skipped.length > 10) lines.push(t(lang, "skipped.more", { count: skipped.length - 10 }));
  return lines;
}

export function renderTable(report: Report, options: TableOptions): string {
  const { lang } = options;
  const lines: string[] = [snapshotLine(lang, report.snapshot)];
  const days = snapshotAgeDays(report.snapshot.scoredAt, options.now ?? new Date());
  if (days > STALE_DAYS) lines.push(t(lang, "warn.stale", { days, scoredAt: report.snapshot.scoredAt }));
  lines.push("");

  if (report.findings.length === 0 && report.resources.length === 0) {
    lines.push(t(lang, "table.none", { files: report.summary.filesScanned }));
  }

  if (report.findings.length > 0) {
    const rows: string[][] = [
      [
        t(lang, "table.col.grade"),
        t(lang, "table.col.conf"),
        t(lang, "table.col.operation"),
        t(lang, "table.col.where"),
        t(lang, "table.col.evidence"),
        t(lang, "table.col.note"),
      ],
    ];
    for (const finding of report.findings) {
      const evidence = evidenceText(lang, finding.evidence);
      const note = finding.notes.map((n) => renderNote(lang, n)).join("; ");
      for (const site of finding.sites) {
        rows.push([
          finding.grade,
          t(lang, `table.conf.${finding.confidence}`),
          finding.key,
          `${site.file}:${site.line}${site.extraction === "inferred" ? " ~" : ""}`,
          evidence,
          note,
        ]);
      }
    }
    lines.push(...renderRows(rows), "");
  }

  if (report.resources.length > 0) {
    lines.push(t(lang, "table.resources"));
    const rows: string[][] = [
      [t(lang, "table.col.grade"), t(lang, "table.col.type"), t(lang, "table.col.service"), t(lang, "table.col.where"), t(lang, "table.col.note")],
    ];
    for (const resource of report.resources) {
      const note = resource.notes.map((n) => renderNote(lang, n)).join("; ");
      for (const site of resource.sites) {
        rows.push([resource.grade, resource.type, resource.service, `${site.file}:${site.line}`, note]);
      }
    }
    lines.push(...renderRows(rows), "");
  }

  if (options.showUnresolved && report.unresolved.length > 0) {
    lines.push(t(lang, "table.unresolved"));
    for (const u of report.unresolved) {
      lines.push(`  ${u.file}:${u.line}  ${t(lang, `unresolved.reason.${u.reason}`)}`);
    }
    lines.push("");
  }

  const sites = report.findings.reduce((n, f) => n + f.sites.length, 0);
  lines.push(
    t(lang, "summary.line", {
      findings: report.summary.findings,
      opWord: t(lang, report.summary.findings === 1 ? "word.operation.one" : "word.operation.other"),
      siteWord: t(lang, sites === 1 ? "word.site.one" : "word.site.other"),
      sites,
      certain: report.summary.certain,
      inferred: report.summary.inferred,
      unresolved: report.summary.unresolved,
      files: report.summary.filesScanned,
    }),
  );
  const gradeList = GRADE_ORDER.filter((g) => report.summary.byGrade[g] > 0)
    .map((g: Grade) => `${g} ${report.summary.byGrade[g]}`)
    .join(" - ");
  if (gradeList) lines.push(t(lang, "summary.grades", { list: gradeList }));
  if (!options.showUnresolved && report.summary.unresolved > 0) lines.push(t(lang, "summary.hint.unresolved"));
  lines.push(...skippedLines(lang, report.skipped));
  return `${lines.join("\n")}\n`;
}
