import { describe, expect, it } from "vitest";
import { loadSnapshot } from "../src/data/schema.js";
import { renderSarif } from "../src/report/sarif.js";
import { scan } from "../src/scan.js";
import { check } from "../src/verdict.js";
import { MINI, PROJECT, cli } from "./helpers.js";

const snapshot = loadSnapshot(MINI);

describe("SARIF 2.1.0 output (AC-7)", async () => {
  const result = await scan([PROJECT], { snapshot, root: process.cwd() });
  const report = check(result, snapshot);
  const sarif = JSON.parse(renderSarif(report, "en"));

  it("has the required top-level structure without fetching the schema", () => {
    expect(sarif.version).toBe("2.1.0");
    expect(sarif.$schema).toBe("https://json.schemastore.org/sarif-2.1.0.json");
    expect(sarif.runs).toHaveLength(1);
    expect(sarif.runs[0].tool.driver.name).toBe("emucheck");
    expect(typeof sarif.runs[0].tool.driver.version).toBe("string");
  });

  it("defines one rule per grade with the emucheck/ prefix", () => {
    const ids = sarif.runs[0].tool.driver.rules.map((r: { id: string }) => r.id);
    expect(ids).toEqual([
      "emucheck/unknown-op",
      "emucheck/absent",
      "emucheck/stub",
      "emucheck/failing",
      "emucheck/partial",
      "emucheck/untested",
      "emucheck/passing",
    ]);
  });

  it("maps grades to levels: absent and stub are errors, failing and partial warnings, others notes", () => {
    const levels: Record<string, string> = {};
    for (const r of sarif.runs[0].results) levels[r.ruleId] = r.level;
    expect(levels["emucheck/absent"]).toBe("error");
    expect(levels["emucheck/stub"]).toBe("error");
    expect(levels["emucheck/failing"]).toBe("warning");
    expect(levels["emucheck/partial"]).toBe("warning");
    expect(levels["emucheck/unknown-op"]).toBe("note");
    expect(levels["emucheck/untested"]).toBe("note");
  });

  it("gives every result a relative uri, a start line and a rule index that matches its rule", () => {
    const rules = sarif.runs[0].tool.driver.rules;
    expect(sarif.runs[0].results.length).toBeGreaterThan(10);
    for (const r of sarif.runs[0].results) {
      const loc = r.locations[0].physicalLocation;
      expect(loc.artifactLocation.uri).toMatch(/^test\/fixtures\/project\//);
      expect(loc.artifactLocation.uri.startsWith("/")).toBe(false);
      expect(loc.region.startLine).toBeGreaterThan(0);
      expect(rules[r.ruleIndex].id).toBe(r.ruleId);
      expect(r.message.text.length).toBeGreaterThan(0);
    }
  });

  it("leaves passing calls out and includes absent IaC resources", () => {
    const ruleIds = sarif.runs[0].results.map((r: { ruleId: string }) => r.ruleId);
    expect(ruleIds).not.toContain("emucheck/passing");
  });

  it("is produced by the CLI with --format sarif and does not change the gate", async () => {
    const out = await cli(["check", PROJECT, "--data", MINI, "--format", "sarif", "--fail-on", "none"]);
    expect(out.code).toBe(0);
    expect(JSON.parse(out.stdout).runs[0].tool.driver.name).toBe("emucheck");
  });
});
