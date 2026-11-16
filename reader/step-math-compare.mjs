// Compare the characters KaTeX displays for a formula with the released characters.
// Used by step-math.test.mjs and step-math.check.mjs.

// KaTeX builds some signs from two glyphs and uses its own code points for others. Both the
// released characters and KaTeX's output are rewritten to the right-hand form before they
// are compared.
export const SAME_SIGN = [
  ["=", "≠"], // KaTeX: a slash glyph over =
  ["∈/", "∉"], // KaTeX: a slash over ∈
  ["−", "-"], // KaTeX sets - as a minus sign
  ["∗", "*"], // and * as a centred asterisk
  ["′", "'"], // and ' as a prime
  ["⋅", "·"], // and · as its dot operator
  ["∣", "|"], // and | as its vertical bar
  ["⊥", "⟂"], // and ⟂ as its perpendicular sign
  // Blackboard letters: KaTeX displays the letter in its blackboard font.
  ["ℤ", "Z"], ["ℝ", "R"], ["ℚ", "Q"], ["ℕ", "N"], ["ℂ", "C"],
  // Raised digits: KaTeX displays the digit, raised.
  ["⁰", "0"], ["¹", "1"], ["²", "2"], ["³", "3"], ["⁴", "4"], ["⁵", "5"], ["⁶", "6"], ["⁷", "7"], ["⁸", "8"], ["⁹", "9"],
];

/** Characters without spaces, with the signs above in one form. */
export function normal(chars) {
  let out = chars.replace(/[\s​ ]/g, "");
  for (const [from, to] of SAME_SIGN) out = out.split(from).join(to);
  return out;
}

/** The characters in KaTeX's HTML output. */
export function displayed(html) {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'");
}

/**
 * "same" when KaTeX displays the released characters in the released order; "order" when it
 * displays the same characters with a superscript before a subscript on one base
 * (x_n^2 is written x, 2, n); otherwise "differ".
 */
export function compare(tex, html, shown) {
  const made = normal(displayed(html)), released = normal(shown);
  if (made === released) return "same";
  const sorted = (chars) => Array.from(chars).sort().join("");
  if (/_\{[^{}]*\}\^\{|\^\{[^{}]*\}_\{/.test(tex) && sorted(made) === sorted(released)) return "order";
  return "differ";
}
