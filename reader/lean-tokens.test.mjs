// Run with: node --test reader/lean-tokens.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import { tokenizeLean, tokenizeStatement } from "./lean-tokens.js";

const SAMPLES = [
  "theorem my_favorite_theorem : 3 * 2 = 6",
  "theorem t (x : ℝ) (h : 3^x = 5) :\n  3^(x + 2) = 45",
  "theorem t :\n  let p : ℚ := 3/5  -- 60% (interpreting 1.6 as 3/5)\n  p = 3/5",
  "theorem t : ∀ n : ℕ, (3 ∣ n ∧ 4 ∣ n) ↔ (Nat.lcm 3 4 ∣ n)",
  "theorem t /- a block\n comment -/ (a b : ℕ) : a + b = b + a",
];

test("joining the tokens gives the statement back unchanged", () => {
  for (const sample of SAMPLES) {
    assert.equal(tokenizeStatement(sample).map((t) => t.text).join(""), sample);
    assert.equal(tokenizeLean(sample).map((t) => t.text).join(""), sample);
  }
});

test("keywords, binders, numbers and arrows are told apart", () => {
  const kinds = (source) => tokenizeLean(source).filter((t) => t.kind !== "space").map((t) => [t.kind, t.text]);
  assert.deepEqual(kinds("theorem t (x : ℝ) : x ≤ 2"), [
    ["keyword", "theorem"],
    ["ident", "t"],
    ["bracket", "("],
    ["binder", "x"],
    ["punct", ":"],
    ["ident", "ℝ"],
    ["bracket", ")"],
    ["punct", ":"],
    ["ident", "x"],
    ["arrow", "≤"],
    ["number", "2"],
  ]);
});

test("comments are one token each and never read as code", () => {
  const tokens = tokenizeStatement("let p := 3/5  -- 60% as 3/5\np = 1");
  const comments = tokens.filter((t) => t.kind === "comment");
  assert.deepEqual(comments.map((t) => t.text), ["-- 60% as 3/5"]);
  assert.ok(!tokens.some((t) => t.kind === "number" && t.text === "60"));
});
