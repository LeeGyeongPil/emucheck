import { describe, expect, it } from "vitest";
import { MESSAGES, langFromLocale, resolveLang, t } from "../src/i18n/index.js";
import { MINI, PROJECT, cli } from "./helpers.js";

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
}

describe("message tables (AC-8)", () => {
  it("have identical key sets in English and Korean", () => {
    const en = Object.keys(MESSAGES.en).sort();
    const ko = Object.keys(MESSAGES.ko).sort();
    expect(en.filter((k) => !ko.includes(k))).toEqual([]);
    expect(ko.filter((k) => !en.includes(k))).toEqual([]);
    expect(en.length).toBeGreaterThan(80);
  });

  it("use the same placeholders in both languages", () => {
    for (const key of Object.keys(MESSAGES.en)) {
      expect(placeholders(MESSAGES.ko[key]!), key).toEqual(placeholders(MESSAGES.en[key]!));
    }
  });

  it("have no empty messages", () => {
    for (const lang of ["en", "ko"] as const) {
      for (const [key, text] of Object.entries(MESSAGES[lang])) expect(text.trim().length, `${lang}:${key}`).toBeGreaterThan(0);
    }
  });

  it("fill placeholders and fall back to the key for unknown messages", () => {
    expect(t("en", "evidence.wire", { pass: 1, fail: 2 })).toBe("wire 1 pass / 2 fail");
    expect(t("ko", "evidence.wire", { pass: 1, fail: 2 })).toBe("wire 통과 1 / 실패 2");
    expect(t("en", "no.such.key")).toBe("no.such.key");
  });
});

describe("language resolution (AC-8)", () => {
  it("maps ko locales to Korean and everything else to English", () => {
    expect(langFromLocale("ko_KR.UTF-8")).toBe("ko");
    expect(langFromLocale("ko")).toBe("ko");
    expect(langFromLocale("fr_FR.UTF-8")).toBe("en");
    expect(langFromLocale("C")).toBe("en");
  });

  it("follows the order --lang > EMUCHECK_LANG > LC_ALL > LC_MESSAGES > LANG", () => {
    expect(resolveLang({ env: {} })).toBe("en");
    expect(resolveLang({ env: { EMUCHECK_LANG: "ko" } })).toBe("ko");
    expect(resolveLang({ env: { LANG: "ko_KR.UTF-8" } })).toBe("ko");
    expect(resolveLang({ env: { LANG: "fr_FR.UTF-8" } })).toBe("en");
    expect(resolveLang({ env: { LC_MESSAGES: "ko_KR.UTF-8", LANG: "en_US.UTF-8" } })).toBe("ko");
    expect(resolveLang({ env: { LC_ALL: "en_US.UTF-8", LC_MESSAGES: "ko_KR.UTF-8" } })).toBe("en");
    expect(resolveLang({ env: { EMUCHECK_LANG: "en", LC_ALL: "ko_KR.UTF-8" } })).toBe("en");
    expect(resolveLang({ flag: "en", env: { EMUCHECK_LANG: "ko" } })).toBe("en");
    expect(resolveLang({ flag: "ko", env: { EMUCHECK_LANG: "en", LANG: "en_US.UTF-8" } })).toBe("ko");
  });

  it("skips empty variables", () => {
    expect(resolveLang({ env: { EMUCHECK_LANG: "", LANG: "ko_KR.UTF-8" } })).toBe("ko");
  });
});

describe("CLI output language (AC-8)", () => {
  const check = ["check", "test/fixtures/project/src/typo.ts", "--data", MINI, "--fail-on", "none"];

  it("prints help in the chosen language", async () => {
    expect((await cli(["--help", "--lang", "ko"])).stdout).toContain("사용법:");
    expect((await cli(["--help", "--lang", "en"])).stdout).toContain("Usage:");
  });

  it("prints table headers and summary in each language", async () => {
    const en = (await cli([...check, "--lang", "en"])).stdout;
    expect(en).toMatch(/GRADE\s+CONF\s+OPERATION/);
    expect(en).toContain("2 operations at 2 call sites");
    const ko = (await cli([...check, "--lang", "ko"])).stdout;
    expect(ko).toMatch(/등급\s+신뢰\s+작업/);
    expect(ko).toContain("작업 2개, 호출 위치 2곳");
    expect(ko).not.toContain("GRADE");
  });

  it("follows EMUCHECK_LANG and LANG", async () => {
    expect((await cli(check, { EMUCHECK_LANG: "ko" })).stdout).toContain("등급");
    expect((await cli(check, { LANG: "ko_KR.UTF-8" })).stdout).toContain("등급");
    expect((await cli(check, { LANG: "fr_FR.UTF-8" })).stdout).toContain("GRADE");
  });

  it("lets --lang beat the environment", async () => {
    expect((await cli([...check, "--lang", "en"], { EMUCHECK_LANG: "ko", LANG: "ko_KR.UTF-8" })).stdout).toContain("GRADE");
    expect((await cli([...check, "--lang", "ko"], { EMUCHECK_LANG: "en", LANG: "en_US.UTF-8" })).stdout).toContain("등급");
  });

  it("prints errors in the chosen language", async () => {
    const out = await cli(["explain", "--lang", "ko"]);
    expect(out.code).toBe(2);
    expect(out.stderr).toContain("explain 에는");
  });

  it("keeps grade IDs and the whole JSON output independent of the language", async () => {
    const args = ["check", PROJECT, "--data", MINI, "--format", "json", "--fail-on", "none"];
    const en = await cli([...args, "--lang", "en"]);
    const ko = await cli([...args, "--lang", "ko"]);
    expect(ko.stdout).toBe(en.stdout);
    const grades = new Set(JSON.parse(en.stdout).findings.map((f: { grade: string }) => f.grade));
    expect([...grades].every((g) => /^[a-z-]+$/.test(g as string))).toBe(true);
  });
});
