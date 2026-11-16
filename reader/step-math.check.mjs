// Check the typesetting of every step text in a built site.
//
// Run with: node reader/step-math.check.mjs site [--out results/step_math_check.json] [--examples N]
//
// For each distinct step text under <site>/data/chains/, this script converts the text with
// step-math.js, gives every formula to KaTeX, and reports:
//   - how many formulas KaTeX accepted, and how many it rejected (the reader then displays
//     the released text of that formula unchanged);
//   - for every accepted formula converted from plain characters, whether the characters
//     KaTeX displays equal the released characters, ignoring spaces and the _ and ^ signs
//     and their braces, which are displayed as position.
// The script exits with status 1 if any accepted plain formula displays other characters.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { compare, displayed, normal } from "./step-math-compare.mjs";
import { katexOptions, pieces } from "./step-math.js";

const katex = createRequire(import.meta.url)("./katex/katex.min.js");
const options = { ...katexOptions(["now", "was"]), output: "html" };
const argument = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null);

const site = process.argv[2];
if (!site || site.startsWith("--")) {
  console.error("usage: node reader/step-math.check.mjs <built site folder> [--out file.json] [--examples N]");
  process.exit(2);
}
const wanted = Number(argument("--examples") ?? 5);

const texts = new Set();
const folder = join(site, "data", "chains");
for (const name of readdirSync(folder).sort()) {
  const chain = JSON.parse(readFileSync(join(folder, name), "utf8"));
  for (const step of chain.steps) {
    for (const text of Object.values(step.text)) texts.add(text);
    for (const versions of Object.values(step.formalisers))
      for (const cell of Object.values(versions)) if (cell.step) texts.add(cell.step);
  }
}

const reason = (message) => {
  if (/Unexpected character/.test(message)) return "a character KaTeX does not accept";
  if (/Double (subscript|superscript)/.test(message)) return "two subscripts or two superscripts on one base";
  return "another LaTeX error";
};
const result = {
  katex: katex.version,
  step_texts: texts.size,
  step_texts_with_a_formula: 0,
  formulas: 0,
  from_plain_characters: 0,
  from_released_latex: 0,
  rejected_by_katex: 0,
  rejected_reasons: {},
  same_characters_superscript_written_before_subscript: 0,
  different_characters: 0,
};
const rejected = [], differ = [];
const pairs = new Map(); // "released -> displayed" for formulas of equal length that differ
const code = (ch) => `${ch} U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`;
for (const text of texts) {
  const made = pieces(text).filter((piece) => piece.kind === "math");
  if (made.length) result.step_texts_with_a_formula++;
  for (const piece of made) {
    result.formulas++;
    const plain = piece.shown !== null;
    if (plain) result.from_plain_characters++;
    else result.from_released_latex++;
    let html;
    try {
      html = katex.renderToString(piece.tex, options);
    } catch (error) {
      result.rejected_by_katex++;
      const why = reason(String(error.message));
      result.rejected_reasons[why] = (result.rejected_reasons[why] || 0) + 1;
      if (rejected.length < wanted) rejected.push({ tex: piece.tex, why: String(error.message).slice(0, 110), text: text.slice(0, 140) });
      continue;
    }
    const verdict = plain ? compare(piece.tex, html, piece.shown) : "same";
    if (verdict === "order") result.same_characters_superscript_written_before_subscript++;
    if (verdict === "differ") {
      result.different_characters++;
      const a = Array.from(normal(piece.shown)), b = Array.from(normal(displayed(html)));
      if (a.length === b.length) {
        a.forEach((ch, k) => { if (ch !== b[k]) { const key = `${code(ch)} -> ${code(b[k])}`; pairs.set(key, (pairs.get(key) || 0) + 1); } });
      }
      if (differ.length < wanted) differ.push({ tex: piece.tex, displays: b.join(""), released: a.join("") });
    }
  }
}

console.log(JSON.stringify(result, null, 1));
const out = argument("--out");
if (out) writeFileSync(out, JSON.stringify(result, null, 1) + "\n");
if (rejected.length) console.log("rejected by KaTeX (released text is displayed instead):", JSON.stringify(rejected, null, 1));
if (pairs.size) console.log("DISPLAYS ANOTHER CHARACTER (released -> displayed, occurrences):", [...pairs].sort((x, y) => y[1] - x[1]).map(([key, n]) => `\n  ${key}: ${n}`).join(""));
if (differ.length) console.log("FORMULAS THAT DISPLAY OTHER CHARACTERS:", JSON.stringify(differ, null, 1));
process.exit(result.different_characters ? 1 : 0);
