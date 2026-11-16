// Step text with its mathematics written as TeX, for KaTeX.
//
// The release gives each reasoning step as plain text. Mathematics in it is written three
// ways: plain characters with _ and ^ ("log_b(a)", "x^3"), LaTeX between \( and \)
// ("\(z=\frac{5}{3}\)"), and bare LaTeX commands ("\frac{19}{10}"). This module splits a
// step into prose and mathematics and writes each piece of mathematics as TeX.
//
// For plain characters the conversion changes position and font only. _ and ^ become
// subscripts and superscripts, the braces that delimit them are not displayed, names such
// as log and sin are set upright, and every other character is displayed as released.
// `shown` is the string of released characters that a formula must display;
// step-math.check.mjs compares it with what KaTeX displays for every step in the release.
// LaTeX in the release is passed to KaTeX unchanged apart from escaping an unescaped %.
// A dollar sign is always a currency sign: the release uses it for prices.

const FUNCTIONS = new Set([
  "log", "ln", "lg", "exp", "sin", "cos", "tan", "cot", "sec", "csc",
  "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh",
  "lim", "max", "min", "gcd", "lcm", "mod", "det", "deg", "dim", "ker", "arg", "sgn",
  "sqrt", "cbrt", "floor", "ceil", "abs", "proj", "conj", "card",
]);
const ORDINAL = new Set(["st", "nd", "rd", "th"]);
// A plain token is mathematics when it contains a digit or one of these characters.
const STRONG = /[0-9=^_+<>≤≥≠≡≈×÷·−±√∛∑∏∫∈∉⊂⊆∪∩∧∨¬→⇒⇔↦∞°∠△∤≢⟂∘⌊⌋⌈⌉∇∂∀∃∅ℤℝℚℕͰ-Ͽ]/u;
const OPERATOR_ONLY = /^[=+\-−×÷·*/<>≤≥≠≡≈±⇒→⇔∈]+$/u;
const RELATION = /^[=<>≤≥≠≡≈⇒→⇔∈]+$/u;
// Characters next to which TeX sets its own spacing, so no explicit space is needed.
const SPACED_BY_TEX = /[=+\-−×÷·*/<>≤≥≠≡≈±⇒→⇔∈,;:|(){}\[\]]/u;
const TRAIL = /[.,;:!?…”"’]+$/u;
const LEAD = /^[“"‘]+/u;
const isLetter = (ch) => ch !== undefined && /[A-Za-z]/.test(ch);
const isDigit = (ch) => ch !== undefined && ch >= "0" && ch <= "9";

function balanced(text) {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\\") { i++; continue; }
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth < 0) return false;
  }
  return depth === 0;
}

// LaTeX commands whose argument the release sometimes writes after a space ("\sqrt b").
const TAKES_ARGUMENT = /\\(?:sqrt|bar|overline|underline|hat|widehat|vec|tilde|widetilde|dot|ddot|frac|dfrac|tfrac|binom|mathbf|mathrm|mathbb|mathcal|mathit|boldsymbol|operatorname|text)$/;

/**
 * A LaTeX span that starts at position i: \( ... \), \[ ... \], or $ ... $ when the text
 * between the dollar signs contains a LaTeX command. A dollar sign is otherwise a price.
 * Returns the position after the span and the LaTeX inside it, or null.
 */
function spanAt(text, i) {
  if (text[i] === "\\" && (text[i + 1] === "(" || text[i + 1] === "[")) {
    const close = text.indexOf(text[i + 1] === "(" ? "\\)" : "\\]", i + 2);
    return close === -1 ? null : { end: close + 2, inner: text.slice(i + 2, close) };
  }
  if (text[i] === "$" && text[i - 1] !== "\\") {
    let close = i + 1;
    while (close < text.length && (text[close] !== "$" || text[close - 1] === "\\")) close++;
    if (close >= text.length) return null;
    const inner = text.slice(i + 1, close);
    return /\\[A-Za-z]/.test(inner) && !/\n/.test(inner) ? { end: close + 1, inner } : null;
  }
  return null;
}

/**
 * Split a step into tokens at whitespace. A brace group and a LaTeX span stay in one token
 * although they may contain spaces. Joining `gap + raw` over the tokens and appending
 * `tail` gives the text back unchanged.
 */
export function tokens(text) {
  const out = [];
  const useBraces = balanced(text);
  let gap = "", raw = "", depth = 0, i = 0;
  const push = () => { if (raw) { out.push({ gap, raw }); gap = ""; raw = ""; } };
  while (i < text.length) {
    const ch = text[i];
    const span = spanAt(text, i);
    if (span) { raw += text.slice(i, span.end); i = span.end; continue; }
    if (ch === "\\" && i + 1 < text.length && !/\s/.test(text[i + 1])) { raw += ch + text[i + 1]; i += 2; continue; }
    if (useBraces && ch === "{") depth++;
    if (useBraces && ch === "}") depth--;
    if (/\s/.test(ch) && depth === 0 && !TAKES_ARGUMENT.test(raw)) { push(); gap += ch; i++; continue; }
    raw += ch;
    i++;
  }
  push();
  return { tokens: out, tail: gap };
}

function matching(s, at, open, close) {
  let depth = 0;
  for (let i = at; i < s.length; i++) {
    if (s[i] === "\\") { i++; continue; }
    if (s[i] === open) depth++;
    else if (s[i] === close && --depth === 0) return i;
  }
  return -1;
}

/** Plain mathematics as TeX. Returns the TeX and the released characters it must display. */
export function plainToTex(s) {
  let tex = "", shown = "";
  let i = 0;
  let lastRun = ""; // the letter run that ends just before position i, if any
  const emit = (t, chars) => { tex += t; shown += chars; };

  // The text after _ or ^, as one group. Returns null when nothing can be attached.
  const attached = (signed) => {
    const ch = s[i];
    if (ch === "{") {
      const end = matching(s, i, "{", "}");
      if (end === -1) return null;
      const inner = plainToTex(s.slice(i + 1, end));
      i = end + 1;
      return inner;
    }
    if (ch === "(") {
      const end = matching(s, i, "(", ")");
      if (end === -1) return null;
      const inner = plainToTex(s.slice(i + 1, end));
      i = end + 1;
      return { tex: `(${inner.tex})`, shown: `(${inner.shown})` };
    }
    let sign = "";
    if (signed && (ch === "-" || ch === "−" || ch === "+") && (isDigit(s[i + 1]) || isLetter(s[i + 1]))) {
      sign = ch;
      i++;
    }
    if (isDigit(s[i])) {
      let j = i;
      while (isDigit(s[j])) j++;
      if (s[j] === "." && isDigit(s[j + 1])) { j++; while (isDigit(s[j])) j++; }
      const digits = s.slice(i, j);
      i = j;
      return { tex: sign + digits, shown: sign + digits };
    }
    if (isLetter(s[i])) {
      let j = i;
      while (isLetter(s[j])) j++;
      const run = s.slice(i, j);
      // A word of three or more letters after _ is one label (x_max, S_total).
      if (!signed && run.length >= 3) {
        i = j;
        return FUNCTIONS.has(run) ? { tex: `\\operatorname{${run}}`, shown: run } : { tex: `\\text{${run}}`, shown: run };
      }
      const letter = s[i];
      i++;
      return { tex: sign + letter, shown: sign + letter };
    }
    if (s[i] !== undefined && !/[\s_^{}\\%$#&~"]/.test(s[i])) {
      const [symbol] = Array.from(s.slice(i));
      i += symbol.length;
      return { tex: sign + symbol, shown: sign + symbol };
    }
    if (sign) i--;
    return null;
  };

  while (i < s.length) {
    const ch = s[i];
    if (isLetter(ch)) {
      let j = i;
      while (isLetter(s[j])) j++;
      const run = s.slice(i, j);
      const afterDigit = isDigit(s[i - 1]);
      if (FUNCTIONS.has(run)) emit(`\\operatorname{${run}}`, run);
      else if (afterDigit && ORDINAL.has(run)) emit(`\\text{${run}}`, run);
      // Four or more letters with a lower-case letter are a word; capitals name points (ABCD).
      else if (run.length >= 4 && /[a-z]/.test(run)) emit(`\\text{${run}}`, run);
      else emit(run, run);
      lastRun = run;
      i = j;
      continue;
    }
    if (ch === "_") {
      const base = lastRun;
      const next = s[i + 1];
      let j = i + 1;
      while (isLetter(s[j])) j++;
      const nextRun = s.slice(i + 1, j);
      // snake_case between two words is a literal underscore.
      const snake = base.length >= 2 && !FUNCTIONS.has(base) && nextRun.length >= 2;
      if (next === undefined || snake) { emit("\\_", "_"); i++; lastRun = ""; continue; }
      i++;
      const sub = attached(false);
      if (sub === null) { emit("\\_", "_"); lastRun = ""; continue; }
      emit(`_{${sub.tex}}`, sub.shown);
      lastRun = "";
      continue;
    }
    if (ch === "^") {
      // a^b^c is a^(b^c).
      const chain = [];
      let stray = false;
      while (s[i] === "^") {
        i++;
        const part = attached(true);
        if (part === null) { stray = true; break; }
        chain.push(part);
      }
      if (chain.length) {
        let nested = "";
        for (let k = chain.length - 1; k >= 0; k--) nested = `^{${chain[k].tex}${nested}}`;
        emit(nested, chain.map((part) => part.shown).join(""));
      }
      if (stray) emit("\\text{\\textasciicircum}", "^");
      lastRun = "";
      continue;
    }
    lastRun = "";
    if (ch === "{") {
      const end = matching(s, i, "{", "}");
      if (end === -1) { emit("\\{", "{"); i++; continue; }
      const inner = plainToTex(s.slice(i + 1, end));
      emit(`\\{${inner.tex}\\}`, `{${inner.shown}}`);
      i = end + 1;
      continue;
    }
    if (ch === "}") { emit("\\}", "}"); i++; continue; }
    if (ch === "," && isDigit(s[i - 1]) && isDigit(s[i + 1])) { emit("{,}", ","); i++; continue; }
    // KaTeX reads · as punctuation; \cdot is the same dot as a binary operator.
    if (ch === "·") { emit("\\cdot ", "·"); i++; continue; }
    if (ch === "%" || ch === "$" || ch === "#" || ch === "&") { emit(`\\${ch}`, ch); i++; continue; }
    if (ch === "~") { emit("\\text{\\textasciitilde}", "~"); i++; continue; }
    if (ch === '"') { emit('\\text{"}', '"'); i++; continue; }
    if (ch === "\\") { emit("\\backslash ", "\\"); i++; continue; }
    if (/\s/.test(ch)) {
      let j = i;
      while (j < s.length && /\s/.test(s[j])) j++;
      const before = s[i - 1], after = s[j];
      const own = before === undefined || after === undefined || SPACED_BY_TEX.test(before) || SPACED_BY_TEX.test(after);
      tex += own ? " " : "\\ ";
      i = j;
      continue;
    }
    const [symbol] = Array.from(s.slice(i));
    emit(symbol, symbol);
    i += symbol.length;
  }
  return { tex, shown };
}

const escapePercent = (latex) => latex.replace(/(^|[^\\])%/g, "$1\\%");

function hasSpan(raw) {
  for (let i = 0; i < raw.length; i++) if (spanAt(raw, i)) return true;
  return false;
}

// A token as punctuation before, the token itself, and punctuation after.
function trimmed(raw) {
  const lead = (raw.match(LEAD) || [""])[0];
  let trail = (raw.slice(lead.length).match(TRAIL) || [""])[0];
  // "\;" and "\," are LaTeX spaces, not a backslash followed by punctuation.
  if (trail && raw[raw.length - trail.length - 1] === "\\") trail = trail.slice(1);
  return { lead, core: raw.slice(lead.length, raw.length - trail.length), trail };
}

// One token as a list of parts: prose, or mathematics with its TeX.
function parts(raw, state) {
  // A LaTeX span is mathematics; the text around it in the same token is prose.
  if (hasSpan(raw)) {
    const out = [];
    let text = "";
    for (let i = 0; i < raw.length; ) {
      const span = spanAt(raw, i);
      if (!span) { text += raw[i++]; continue; }
      if (text) out.push({ kind: "text", raw: text });
      text = "";
      out.push({ kind: "math", raw: raw.slice(i, span.end), tex: escapePercent(span.inner), shown: null });
      i = span.end;
    }
    if (text) out.push({ kind: "text", raw: text });
    return out;
  }
  const { lead, core, trail } = trimmed(raw);
  if (!core || !state.math) return [{ kind: "text", raw }];
  const out = [];
  if (lead) out.push({ kind: "text", raw: lead });
  if (/\\[A-Za-z]/.test(core)) out.push({ kind: "math", raw: core, tex: escapePercent(core.replace(/\\[()[\]]/g, "")), shown: null });
  else out.push({ kind: "math", raw: core, ...plainToTex(core), operator: OPERATOR_ONLY.test(core) });
  if (trail) out.push({ kind: "text", raw: trail });
  return out;
}

// Operators that are mathematics wherever they stand. A lone - / * < or > can be a dash or
// a bracket in prose, so those need mathematics beside them.
const ALWAYS_OPERATOR = /^[=+×÷·−±≤≥≠≡≈⇒→⇔∈]+$/u;
// One or two letters, or up to four capitals, with brackets: a name such as ab, (a, b) or ABC.
const SHORT_NAME = /^[([{|]*(?:[A-Za-z]{1,2}|[A-Z]{3,4})[)\]}|]*$/;
// Two-letter English words, which are not names of a product of two variables.
const SHORT_WORDS = new Set(["am", "an", "as", "at", "be", "by", "do", "go", "he", "if", "in", "is", "it", "me", "my", "no", "of", "on", "or", "so", "to", "up", "us", "we"]);
// Single letters separated by commas, with or without brackets: a,b,c or (x,y).
const LETTER_LIST = /^[([{]?[A-Za-z](?:,[A-Za-z])+[)\]}]?$/;

// Whether each token is mathematics. Tokens that are mathematics on their own come first;
// then operators and short names beside mathematics, repeated until nothing changes.
function classify(list) {
  const cores = list.map((token) => trimmed(token.raw).core);
  const math = cores.map((c, k) => {
    if (hasSpan(list[k].raw)) return true;
    if (!c) return false;
    if (OPERATOR_ONLY.test(c)) return ALWAYS_OPERATOR.test(c);
    if (/\\[A-Za-z]/.test(c)) return true;
    // A single letter, with or without brackets, is a variable: x, (x, y). "a", "A" and "I" need an operator beside them.
    if (/^[([{|]*[A-Za-z][)\]}|]*$/.test(c)) return !/[aAI]/.test(c);
    if (/^[A-Za-z]\([^()\s]*\)$/.test(c) || LETTER_LIST.test(c)) return true;
    if (!STRONG.test(c)) return false;
    if (/[_^=]/.test(c)) return true;
    // A token with a word in it and no _ ^ = is prose with a number ("12-egg", "$35/hour").
    const runs = c.match(/[A-Za-z]+/g) || [];
    return !runs.some((run) => run.length >= 3 && /[a-z]/.test(run) && !FUNCTIONS.has(run));
  });
  const beside = (k, test) => (k > 0 && test(k - 1)) || (k + 1 < list.length && test(k + 1));
  const operator = (k) => math[k] && OPERATOR_ONLY.test(cores[k]);
  const name = (k) => SHORT_NAME.test(cores[k]) && !SHORT_WORDS.has(cores[k].replace(/[^A-Za-z]/g, ""));
  // A lone - / * < > is mathematics when it stands between two operands, at least one of
  // which is already mathematics ("5 - 3", "(a - b)"). "8 - done" keeps its dash.
  const operand = (k) => k >= 0 && k < list.length && (math[k] || name(k));
  const between = (k) => operand(k - 1) && operand(k + 1) && (math[k - 1] || math[k + 1]);
  for (let pass = 0, changed = true; changed && pass < 6; pass++) {
    changed = false;
    cores.forEach((c, k) => {
      if (math[k] || !c) return;
      // A short name beside an operator ("a = 3", "(a + b)").
      if ((name(k) && beside(k, operator)) || (OPERATOR_ONLY.test(c) && between(k))) {
        math[k] = true;
        changed = true;
      }
    });
  }
  return math;
}

/**
 * A step as pieces to display. `changed[k]` marks token k as different from the other
 * version of the step; `cls` is the class given to a changed piece.
 * A text piece is `{ kind: "text", raw, changed }`. A formula piece is
 * `{ kind: "math", tex, shown, fallback }`, where `fallback` lists text pieces to display if
 * KaTeX rejects the TeX.
 */
export function pieces(text, changed = null, cls = "") {
  const { tokens: list, tail } = tokens(text);
  const math = classify(list);
  const out = [];
  let run = null; // the formula being built from consecutive mathematics
  const close = () => {
    if (!run) return;
    // An operator at either end of a formula has its operand in the prose beside it.
    // It is set on its own so that the spaces around it in the text are kept.
    const items = run;
    run = null;
    let from = 0, to = items.length;
    const solo = (item) => out.push(formula([item], cls));
    while (to - from > 1 && items[from].operator) { solo(items[from]); out.push({ kind: "text", raw: " ", changed: false }); from++; }
    const after = [];
    while (to - from > 1 && items[to - 1].operator) { after.unshift(items[to - 1]); to--; }
    out.push(formula(items.slice(from, to), cls));
    for (const item of after) { out.push({ kind: "text", raw: " ", changed: false }); solo(item); }
  };
  list.forEach((token, k) => {
    const flag = Boolean(changed && changed[k]);
    const made = parts(token.raw, { math: math[k] });
    const at = made.findIndex((part) => part.kind === "math");
    // A plain token is punctuation, one formula, punctuation. A token with a LaTeX span is not.
    const plain = at !== -1 && !hasSpan(token.raw);
    if (plain) {
      const lead = made[at - 1], trail = made[at + 1];
      // Consecutive formulas separated by one space join into one formula.
      if (!lead && run && token.gap === " ") run.push({ ...made[at], changed: flag });
      else {
        close();
        if (token.gap) out.push({ kind: "text", raw: token.gap, changed: false });
        if (lead) out.push({ kind: "text", raw: lead.raw, changed: flag });
        run = [{ ...made[at], changed: flag }];
      }
      if (trail) {
        close();
        out.push({ kind: "text", raw: trail.raw, changed: flag });
      }
      return;
    }
    close();
    if (token.gap) out.push({ kind: "text", raw: token.gap, changed: false });
    for (const part of made) {
      if (part.kind === "text") out.push({ kind: "text", raw: part.raw, changed: flag });
      else out.push(formula([{ ...part, changed: flag }], cls));
    }
  });
  close();
  if (tail) out.push({ kind: "text", raw: tail, changed: false });
  return out;
}

function formula(items, cls) {
  let tex = "";
  items.forEach((item, k) => {
    if (k) {
      const before = items[k - 1].raw.slice(-1), after = item.raw[0];
      tex += SPACED_BY_TEX.test(before) || SPACED_BY_TEX.test(after) ? " " : "\\ ";
    }
    let own = item.tex;
    if (item.changed && cls) {
      own = `\\htmlClass{${cls}}{${own}}`;
      // A marked operator keeps the spacing of its class.
      if (item.operator) own = `${RELATION.test(item.raw) ? "\\mathrel" : "\\mathbin"}{${own}}`;
    }
    tex += own;
  });
  const fallback = [];
  items.forEach((item, k) => {
    if (k) fallback.push({ kind: "text", raw: " ", changed: false });
    fallback.push({ kind: "text", raw: item.raw, changed: item.changed });
  });
  const checked = items.every((item) => item.shown !== null);
  return { kind: "math", tex, shown: checked ? items.map((item) => item.shown).join("") : null, fallback };
}

/** KaTeX options. Only this module's \htmlClass marks are trusted. */
export function katexOptions(classes) {
  return {
    output: "htmlAndMathml",
    strict: "ignore",
    throwOnError: true,
    trust: (context) => context.command === "\\htmlClass" && classes.includes(context.class),
  };
}
