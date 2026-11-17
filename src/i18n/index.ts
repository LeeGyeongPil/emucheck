import { en } from "./en.js";
import { ko } from "./ko.js";

export type Lang = "en" | "ko";

export const MESSAGES: Record<Lang, Record<string, string>> = { en, ko };

export interface LangSources {
  /** Value of `--lang`, if given. */
  flag?: string;
  env?: Record<string, string | undefined>;
}

/** Map a locale-like string (`ko_KR.UTF-8`, `ko`, `fr_FR`) to a supported language. */
export function langFromLocale(value: string): Lang {
  return value.trim().toLowerCase().startsWith("ko") ? "ko" : "en";
}

/**
 * Decide the output language. Order: `--lang`, then `EMUCHECK_LANG`, `LC_ALL`, `LC_MESSAGES`, `LANG`.
 * The first non-empty value wins; anything that does not start with `ko` means English.
 */
export function resolveLang(sources: LangSources = {}): Lang {
  const env = sources.env ?? process.env;
  if (sources.flag !== undefined) return langFromLocale(sources.flag);
  for (const name of ["EMUCHECK_LANG", "LC_ALL", "LC_MESSAGES", "LANG"]) {
    const value = env[name];
    if (value && value.trim() !== "") return langFromLocale(value);
  }
  return "en";
}

/** Look up a message and fill `{name}` placeholders. Missing keys fall back to English, then to the key. */
export function t(lang: Lang, key: string, params: Record<string, string | number> = {}): string {
  const template = MESSAGES[lang][key] ?? MESSAGES.en[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}
