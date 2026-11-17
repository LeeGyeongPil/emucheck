/**
 * Minimal Python tokenizer. It only needs to be exact about what is *not* code
 * (comments, strings, docstrings, line continuations) so that `boto3.client(...)` inside
 * them is never mistaken for a real call.
 */

export type TokenKind = "name" | "string" | "number" | "op" | "newline";

export interface Token {
  kind: TokenKind;
  /** Name text, operator text, or the decoded content of a plain string literal. */
  value: string;
  line: number;
  /** For strings: true when the literal is a plain `str` (no f-string, bytes or format markers). */
  plain?: boolean;
}

const TWO_CHAR_OPS = new Set(["==", "!=", "<=", ">=", ":=", "->", "**", "//", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "@=", "<<", ">>"]);
const OPEN = new Set(["(", "[", "{"]);
const CLOSE = new Set([")", "]", "}"]);

function isNameStart(ch: string): boolean {
  return /[A-Za-z_]/.test(ch) || ch > "\u007f";
}
function isNameChar(ch: string): boolean {
  return /[A-Za-z0-9_]/.test(ch) || ch > "\u007f";
}

const STRING_PREFIX = /^(?:[rRbBuUfF]|[rR][bBfF]|[bBfF][rR])$/;

/** Tokenize Python source. Logical line ends become `newline` tokens; blank lines are dropped. */
export function tokenizePython(source: string): Token[] {
  const tokens: Token[] = [];
  const text = source.replace(/\r\n?/g, "\n");
  let i = 0;
  let line = 1;
  let depth = 0;

  const pushNewline = (): void => {
    const last = tokens[tokens.length - 1];
    if (last && last.kind !== "newline") tokens.push({ kind: "newline", value: "\n", line });
  };

  while (i < text.length) {
    const ch = text[i]!;
    if (ch === "\n") {
      if (depth === 0) pushNewline();
      line++;
      i++;
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "\f") {
      i++;
      continue;
    }
    if (ch === "\\" && text[i + 1] === "\n") {
      i += 2;
      line++;
      continue;
    }
    if (ch === "#") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }

    // string literal, possibly with a prefix such as r, b, f, rb
    let prefixLen = 0;
    if (isNameStart(ch)) {
      let j = i;
      while (j < text.length && isNameChar(text[j]!)) j++;
      const word = text.slice(i, j);
      if (j < text.length && (text[j] === '"' || text[j] === "'") && STRING_PREFIX.test(word)) prefixLen = word.length;
    }
    if (prefixLen > 0 || ch === '"' || ch === "'") {
      const prefix = text.slice(i, i + prefixLen).toLowerCase();
      const quoteAt = i + prefixLen;
      const quote = text[quoteAt]!;
      const triple = text.slice(quoteAt, quoteAt + 3) === quote.repeat(3);
      const startLine = line;
      let j = quoteAt + (triple ? 3 : 1);
      let content = "";
      const raw = prefix.includes("r");
      for (;;) {
        if (j >= text.length) break;
        const c = text[j]!;
        if (c === "\\" && j + 1 < text.length) {
          const next = text[j + 1]!;
          if (next === "\n") line++;
          content += raw ? c + next : decodeEscape(next);
          j += 2;
          continue;
        }
        if (triple) {
          if (text.slice(j, j + 3) === quote.repeat(3)) {
            j += 3;
            break;
          }
        } else if (c === quote) {
          j++;
          break;
        } else if (c === "\n") {
          break; // unterminated string: stop at the end of the line instead of swallowing the file
        }
        if (c === "\n") line++;
        content += c;
        j++;
      }
      const plain = !prefix.includes("f") && !prefix.includes("b");
      tokens.push({ kind: "string", value: content, line: startLine, plain });
      i = j;
      continue;
    }

    if (isNameStart(ch)) {
      let j = i;
      while (j < text.length && isNameChar(text[j]!)) j++;
      tokens.push({ kind: "name", value: text.slice(i, j), line });
      i = j;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(text[i + 1] ?? ""))) {
      let j = i;
      while (j < text.length && /[0-9A-Za-z_.]/.test(text[j]!)) j++;
      tokens.push({ kind: "number", value: text.slice(i, j), line });
      i = j;
      continue;
    }

    const two = text.slice(i, i + 2);
    if (TWO_CHAR_OPS.has(two)) {
      tokens.push({ kind: "op", value: two, line });
      i += 2;
      continue;
    }
    if (OPEN.has(ch)) depth++;
    else if (CLOSE.has(ch) && depth > 0) depth--;
    if (ch === ";") {
      pushNewline();
    } else {
      tokens.push({ kind: "op", value: ch, line });
    }
    i++;
  }
  pushNewline();
  return tokens;
}

function decodeEscape(next: string): string {
  switch (next) {
    case "n":
      return "\n";
    case "t":
      return "\t";
    case "\\":
      return "\\";
    case "'":
      return "'";
    case '"':
      return '"';
    case "\n":
      return "";
    default:
      return `\\${next}`;
  }
}
