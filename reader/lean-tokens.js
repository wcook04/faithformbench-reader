// A small Lean tokenizer for colouring one statement.
//
// Adapted from Proof Reader (https://github.com/wcook04/proof-reader, Apache-2.0):
// web/src/lean/leanTokens.ts (tokenizeLean, markBinders) and the comment handling of
// lineTokens in web/src/lean/code.tsx, at commit e2df888. Changes: TypeScript types
// removed, the two functions joined so one call returns comments as well as code, and
// the result exported as plain ES module functions. The token kinds and the rule that
// concatenating the token texts returns the input unchanged are kept.

const KEYWORDS = new Set([
  "theorem", "lemma", "def", "abbrev", "structure", "class", "instance", "example", "axiom",
  "fun", "λ", "let", "have", "show", "from", "by", "in", "if", "then", "else", "match",
  "with", "where", "do", "Type", "Prop", "Sort", "∀", "∃", "∃!",
]);
const ARROWS = ["↔", "→", "←", "⟹", "=>", "->", "<->", "↦", "∧", "∨", "¬", ":=", "≤", "≥", "≠", "∈", "∉", "⊆", "×", "∘"];
const OPEN = new Set(["(", "{", "[", "⦃", "⟨"]);
const CLOSE = new Set([")", "}", "]", "⦄", "⟩"]);
const QUANTIFIERS = new Set(["∀", "∃", "∃!", "fun", "λ"]);
const BINDER_OPEN = new Set(["(", "{", "[", "⦃"]);
// Identifier characters: letters (including Greek and subscripts), digits, ', _, ., !, ?
const IDENT_START = /[\p{L}_]/u;
const IDENT_PART = /[\p{L}\p{N}_'.!?₀-₉ᵢ-ᵪ]/u;

/** Tokens of Lean code that holds no comment. Kinds: keyword, bracket, binder, arrow, ident, number, punct, space. */
export function tokenizeLean(source) {
  const tokens = [];
  const chars = Array.from(source);
  let i = 0;
  const push = (kind, text) => {
    const last = tokens[tokens.length - 1];
    if (last && last.kind === kind && (kind === "space" || kind === "punct")) last.text += text;
    else tokens.push({ kind, text });
  };
  while (i < chars.length) {
    const c = chars[i];
    if (/\s/.test(c)) {
      push("space", c);
      i++;
      continue;
    }
    const rest = chars.slice(i, i + 3).join("");
    const arrow = ARROWS.find((a) => rest.startsWith(a));
    if (arrow) {
      tokens.push({ kind: "arrow", text: arrow });
      i += Array.from(arrow).length;
      continue;
    }
    if (c === "∀" || c === "∃" || c === "λ") {
      const bang = chars[i + 1] === "!" ? "!" : "";
      tokens.push({ kind: "keyword", text: c + bang });
      i += 1 + bang.length;
      continue;
    }
    if (OPEN.has(c) || CLOSE.has(c)) {
      tokens.push({ kind: "bracket", text: c });
      i++;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < chars.length && /[0-9.]/.test(chars[j])) j++;
      tokens.push({ kind: "number", text: chars.slice(i, j).join("") });
      i = j;
      continue;
    }
    if (IDENT_START.test(c)) {
      let j = i + 1;
      while (j < chars.length && IDENT_PART.test(chars[j])) j++;
      // A trailing dot belongs to punctuation, not the name.
      while (j > i + 1 && chars[j - 1] === ".") j--;
      const text = chars.slice(i, j).join("");
      tokens.push({ kind: KEYWORDS.has(text) ? "keyword" : "ident", text });
      i = j;
      continue;
    }
    push("punct", c);
    i++;
  }
  markBinders(tokens);
  return tokens;
}

/** Inside a binder bracket, the identifiers before a ":" are the names it binds. */
function markBinders(tokens) {
  tokens.forEach((t, k) => {
    if (t.kind === "keyword" && QUANTIFIERS.has(t.text)) {
      for (let j = k + 1; j < tokens.length && (tokens[j].kind === "ident" || tokens[j].kind === "space"); j++)
        if (tokens[j].kind === "ident") tokens[j].kind = "binder";
      return;
    }
    if (t.kind !== "bracket" || !BINDER_OPEN.has(t.text)) return;
    const names = [];
    let j = k + 1;
    for (; j < tokens.length; j++) {
      const u = tokens[j];
      if (u.kind === "ident") names.push(u);
      else if (u.kind !== "space") break;
    }
    const next = tokens[j];
    if (names.length && next && next.kind === "punct" && next.text.startsWith(":")) names.forEach((n) => (n.kind = "binder"));
  });
}

/** Tokens of a whole statement, with `--` comments and `/- -/` comments as tokens of kind "comment". */
export function tokenizeStatement(source) {
  const out = [];
  let inBlock = false;
  const lines = source.split("\n");
  lines.forEach((line, n) => {
    let rest = line;
    while (rest) {
      if (inBlock) {
        const close = rest.indexOf("-/");
        const end = close < 0 ? rest.length : close + 2;
        out.push({ kind: "comment", text: rest.slice(0, end) });
        rest = rest.slice(end);
        if (close >= 0) inBlock = false;
        continue;
      }
      const block = rest.indexOf("/-");
      const dash = rest.indexOf("--");
      const start = block >= 0 && (dash < 0 || block < dash) ? block : dash;
      const code = start < 0 ? rest : rest.slice(0, start);
      if (code) for (const token of tokenizeLean(code)) out.push(token);
      if (start < 0) break;
      rest = rest.slice(start);
      if (start === dash && (block < 0 || dash < block)) {
        out.push({ kind: "comment", text: rest });
        break;
      }
      inBlock = true;
      out.push({ kind: "comment", text: rest.slice(0, 2) });
      rest = rest.slice(2);
    }
    if (n < lines.length - 1) out.push({ kind: "space", text: "\n" });
  });
  return out;
}
