import { t, type Lang } from "../i18n/index.js";
import type { Grade, Report } from "../types.js";
import { GRADE_ORDER } from "../types.js";
import { VERSION } from "../version.js";
import { renderNote } from "./table.js";

const LEVELS: Record<Grade, "error" | "warning" | "note"> = {
  "unknown-op": "note",
  absent: "error",
  stub: "error",
  failing: "warning",
  partial: "warning",
  untested: "note",
  passing: "note",
};

/** Build a SARIF 2.1.0 log. `passing` calls are left out so code scanning only shows what needs attention. */
export function renderSarif(report: Report, lang: Lang): string {
  const rules = GRADE_ORDER.map((grade) => ({
    id: `emucheck/${grade}`,
    name: grade,
    shortDescription: { text: t(lang, `grade.desc.${grade}`) },
    defaultConfiguration: { level: LEVELS[grade] },
  }));

  const results: unknown[] = [];
  for (const finding of report.findings) {
    if (finding.grade === "passing") continue;
    const notes = finding.notes.map((n) => renderNote(lang, n)).join("; ");
    const text = `${finding.key}: ${finding.grade} (${notes || t(lang, `grade.desc.${finding.grade}`)})`;
    for (const site of finding.sites) {
      results.push({
        ruleId: `emucheck/${finding.grade}`,
        ruleIndex: GRADE_ORDER.indexOf(finding.grade),
        level: LEVELS[finding.grade],
        message: { text },
        locations: [
          { physicalLocation: { artifactLocation: { uri: site.file }, region: { startLine: site.line } } },
        ],
        partialFingerprints: { "emucheck/key": `${finding.key}@${site.file}` },
      });
    }
  }
  for (const resource of report.resources) {
    if (resource.grade !== "absent") continue;
    const notes = resource.notes.map((n) => renderNote(lang, n)).join("; ");
    for (const site of resource.sites) {
      results.push({
        ruleId: `emucheck/${resource.grade}`,
        ruleIndex: GRADE_ORDER.indexOf(resource.grade),
        level: LEVELS[resource.grade],
        message: { text: `${resource.type}: ${resource.grade} (${notes})` },
        locations: [
          { physicalLocation: { artifactLocation: { uri: site.file }, region: { startLine: site.line } } },
        ],
        partialFingerprints: { "emucheck/key": `${resource.type}@${site.file}` },
      });
    }
  }

  const log = {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: { driver: { name: "emucheck", version: VERSION, rules } },
        properties: { snapshot: report.snapshot },
        results,
      },
    ],
  };
  return `${JSON.stringify(log, null, 2)}\n`;
}
