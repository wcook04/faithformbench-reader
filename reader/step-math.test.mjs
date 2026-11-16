// Run with: node --test reader/step-math.test.mjs

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { compare } from "./step-math-compare.mjs";
import { katexOptions, pieces, plainToTex, tokens } from "./step-math.js";

const katex = createRequire(import.meta.url)("./katex/katex.min.js");
const options = { ...katexOptions(["now", "was"]), output: "html" };

const formulas = (text) => pieces(text).filter((piece) => piece.kind === "math");
const prose = (text) => pieces(text).filter((piece) => piece.kind === "text").map((piece) => piece.raw).join("");
test("joining the tokens gives the step back unchanged", () => {
  for (const text of [
    "Use the logarithm product rule: for b>0, b≠1 and a>0,c>0,\n log_b(a)+log_b(c)=log_b(ac).",
    "The single-digit primes are {2, 3, 5, 7}.  ",
    "Solve \\(3z-3=2\\): \\(3z=5\\) so \\(z=\\frac{5}{3}\\).",
    "garbled } brace { text",
  ]) {
    const { tokens: list, tail } = tokens(text);
    assert.equal(list.map((token) => token.gap + token.raw).join("") + tail, text);
  }
});

test("a brace group and a LaTeX span stay in one token", () => {
  assert.deepEqual(tokens("primes {2, 3, 5} only").tokens.map((t) => t.raw), ["primes", "{2, 3, 5}", "only"]);
  assert.deepEqual(tokens("so \\(z = 5\\).").tokens.map((t) => t.raw), ["so", "\\(z = 5\\)."]);
  assert.deepEqual(tokens("a } b { c").tokens.map((t) => t.raw), ["a", "}", "b", "{", "c"]);
});

test("subscripts, superscripts and function names", () => {
  assert.deepEqual(plainToTex("log_b(a)+log_b(c)=log_b(ac)"), {
    tex: "\\operatorname{log}_{b}(a)+\\operatorname{log}_{b}(c)=\\operatorname{log}_{b}(ac)",
    shown: "logb(a)+logb(c)=logb(ac)",
  });
  assert.equal(plainToTex("x^3=8").tex, "x^{3}=8");
  assert.equal(plainToTex("log_10(x-2)").tex, "\\operatorname{log}_{10}(x-2)");
  assert.equal(plainToTex("2^2^2^2").tex, "2^{2^{2^{2}}}");
  assert.equal(plainToTex("(3/2)^(8/3)").tex, "(3/2)^{(8/3)}");
  assert.equal(plainToTex("x^-1").tex, "x^{-1}");
  assert.equal(plainToTex("a_{n+1}").tex, "a_{n+1}");
  assert.equal(plainToTex("x_max").tex, "x_{\\operatorname{max}}");
  assert.equal(plainToTex("S_total").tex, "S_{\\text{total}}");
  assert.equal(plainToTex("sin^2").tex, "\\operatorname{sin}^{2}");
});

test("characters that TeX would read as commands are displayed as released", () => {
  assert.equal(plainToTex("40%").tex, "40\\%");
  assert.equal(plainToTex("$2.50").tex, "\\$2.50");
  assert.equal(plainToTex("76,000").tex, "76{,}000");
  assert.equal(plainToTex("unit_price").tex, "\\text{unit}\\_\\text{price}");
  assert.equal(plainToTex("{2, 3}").tex, "\\{2, 3\\}");
  assert.equal(plainToTex("2 4").tex, "2\\ 4");
  assert.equal(plainToTex("x^").tex, "x\\text{\\textasciicircum}");
});

test("prose stays prose and a dollar sign is a price", () => {
  assert.equal(formulas("Jeff walks 30 miles per week.").map((f) => f.tex).join("|"), "30");
  assert.equal(formulas("12-egg containers at $35/hour").length, 0);
  assert.deepEqual(formulas("Average cost = $2640 ÷ 24 = $110 per pair.").map((f) => f.tex), ["=", "\\$2640 ÷ 24 = \\$110"]);
  assert.equal(formulas("Take a walk.").length, 0);
  assert.deepEqual(formulas("Let a = 3.").map((f) => f.tex), ["a = 3"]);
  assert.deepEqual(formulas("Let K be the count.").map((f) => f.tex), ["K"]);
});

test("short names and lists of letters beside mathematics are mathematics", () => {
  assert.deepEqual(formulas("Use the identity a^3 + b^3 = (a + b)(a^2 - ab + b^2).").map((f) => f.tex), [
    "a^{3} + b^{3} = (a + b)(a^{2} - ab + b^{2})",
  ]);
  assert.deepEqual(formulas("Test (a,b) = (1,1): compute 7^1 − 3^1 = 4.").map((f) => f.tex), ["(a,b) = (1{,}1)", "7^{1} − 3^{1} = 4"]);
  assert.deepEqual(formulas("choose values for a,b,c and then solve for d;").map((f) => f.tex), ["a,b,c", "d"]);
  assert.deepEqual(formulas("distance = speed × time").map((f) => f.tex), ["=", "×"]);
  assert.deepEqual(formulas("the value of x is = to 5 or so").map((f) => f.tex), ["x", "=", "5"]);
  assert.deepEqual(formulas("Compute 2·4=8 - done").map((f) => f.tex), ["2\\cdot 4=8"]);
});

test("an operator between prose and a number is set on its own with its spaces", () => {
  const made = pieces("3 miles (to work) + 3 miles (back) = 6 miles");
  assert.deepEqual(made.filter((p) => p.kind === "math").map((p) => p.tex), ["3", "+", "3", "=", "6"]);
  assert.equal(made.map((p) => (p.kind === "math" ? p.fallback.map((f) => f.raw).join("") : p.raw)).join(""), "3 miles (to work) + 3 miles (back) = 6 miles");
});

test("released LaTeX is passed on, with a bare percent sign escaped", () => {
  const made = formulas("Solve \\(3z-3=2\\): so \\(z=\\frac{5}{3}\\).");
  assert.deepEqual(made.map((f) => f.tex), ["3z-3=2", "z=\\frac{5}{3}"]);
  assert.equal(made[0].shown, null);
  assert.equal(prose("Solve \\(3z-3=2\\): so \\(z=\\frac{5}{3}\\)."), "Solve : so .");
  assert.deepEqual(formulas("Then \\frac{19}{10} = 1\\frac{9}{10}.").map((f) => f.tex), ["\\frac{19}{10} = 1\\frac{9}{10}"]);
  assert.deepEqual(formulas("\\(50% of x\\)").map((f) => f.tex), ["50\\% of x"]);
});

test("a changed token is marked inside its formula", () => {
  const made = pieces("6 × 5 = 31.", [false, false, false, false, true], "now").filter((p) => p.kind === "math");
  assert.equal(made[0].tex, "6 × 5 = \\htmlClass{now}{31}");
  assert.match(katex.renderToString(made[0].tex, options), /class="enclosing now"|class="[^"]*\bnow\b[^"]*"/);
  const operator = pieces("6 + 5", [false, true, false], "now").filter((p) => p.kind === "math");
  assert.equal(operator[0].tex, "6 \\mathbin{\\htmlClass{now}{+}} 5");
});

test("KaTeX displays exactly the released characters of a plain formula", () => {
  for (const text of [
    "log_b(a)+log_b(c)=log_b(ac).",
    "Check validity: x=2 satisfies base constraints (2>0 and 2≠1) and the equation: log_2(2)+log_2(4)=1+2=3.",
    "Add the two equations: (sin^2 x + cos^2 x) + (cos^2 y + sin^2 y) = (3/2)a + (1/2)a^2.",
    "Rewrite ∛2/∛3 = (2/3)^(1/3).",
    "30% of $76,000 equals 0.3 × 76,000.",
    "ceil(sqrt(1300)) = ceil(36.0555...) = 37.",
    "The primes are {2, 3, 5, 7} and 2^2^2^2 = 65536.",
    "log_{log_2 256}(64) = log_8(64).",
    "x*2 = *1 and (-1)+{n+0}n",
  ]) {
    for (const piece of formulas(text)) {
      assert.notEqual(piece.shown, null, text);
      assert.equal(compare(piece.tex, katex.renderToString(piece.tex, options), piece.shown), "same", `${text} :: ${piece.tex}`);
    }
  }
});
