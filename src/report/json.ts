import type { Report } from "../types.js";
import { VERSION } from "../version.js";

/**
 * Machine-readable report. Field names and grade IDs do not depend on the output language.
 * The output contains no timestamps of the run, so identical input gives identical bytes.
 */
export function renderJson(report: Report): string {
  return `${JSON.stringify({ tool: "emucheck", version: VERSION, ...report }, null, 2)}\n`;
}
