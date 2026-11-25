// The reader: a reasoning chain on the left page and, on the right, the Lean statement
// each autoformaliser produced for the selected step. All data is static JSON written by
// `python -m faithformbench_reader site`; this script only lays it out.

import { tokenizeStatement } from "./lean-tokens.js";
import { katexOptions, pieces, tokens as stepTokens } from "./step-math.js";

const FORMALISERS = [
  ["goedel", "Goedel"],
  ["herald", "Herald"],
  ["kimina", "Kimina"],
  ["stepfun", "StepFun"],
];
const VERSIONS = [
  ["unperturbed", "Unperturbed"],
  ["llm", "LLM-perturbed"],
  ["regex", "Regex-perturbed"],
];
const VERSION_NAME = Object.fromEntries(VERSIONS);
// The release's five verdicts, spelled out.
const VERDICT_WORD = {
  Proved: "Proved",
  Refuted: "Refuted",
  Unknown: "Unknown",
  "TC-Fail": "Type-check failure",
  "AF-Fail": "Extraction failure",
};
// Labels assigned by a language model: the relation of the formal statement to the step.
const RELATION_WORD = {
  same: "Equivalent to the step",
  more: "Stronger than the step",
  less: "Weaker than the step",
  different: "A different proposition from the step",
  cannot_tell: "Not comparable with the step",
};
// Labels assigned by a language model: why the formal statement of a perturbed step is provable.
const MECHANISM_WORD = {
  right_value: "Unperturbed value in place of the perturbed value",
  claim_dropped: "Perturbed part omitted",
  premises_cannot_hold: "Unsatisfiable hypotheses",
  assumed: "Perturbed claim taken as a hypothesis",
  tautology: "Trivially true conclusion",
  number_system: "Truncating natural-number arithmetic",
  weakened: "Weakened conclusion",
  other_statement: "Unrelated proposition",
  step_still_true: "Perturbed step still valid",
  unclear: "Not determined",
};
const PAGE = 40;
const THEME_KEY = "faithformbench-reader-theme";
// The viewer's choice between typeset step text and the text exactly as released.
const STEP_TEXT_KEY = "faithformbench-reader-step-text";
const KATEX_OPTIONS = katexOptions(["now", "was"]);
const REPOSITORY = "https://github.com/wcook04/faithformbench-reader";
const root = document.getElementById("root");
const narrow = window.matchMedia("(max-width: 900px)");

let index = null;
let overview = null;
let fullIndex = null;
const chains = new Map();
const numberFormat = new Intl.NumberFormat("en-GB");
const compareChainIds = new Intl.Collator("en", { numeric: true }).compare;
const list = { source: "all", order: "most", shown: PAGE };

// ---------------------------------------------------------------- small helpers

const esc = (value) =>
  String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const count = (n) => numberFormat.format(n);
const plural = (n, one, many) => `${count(n)} ${n === 1 ? one : many}`;
const join = (items) =>
  items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
const lowerFirst = (words) => words.charAt(0).toLowerCase() + words.slice(1);

async function getJson(path, allowMissing = false) {
  const response = await fetch(path);
  if (allowMissing && response.status === 404) return null;
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.json();
}

function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  return { chain: parts[0] || null, step: parts[1] || null, version: VERSION_NAME[parts[2]] ? parts[2] : "llm" };
}

const href = (chain, step, version) =>
  `#/${[chain, step, step && version].filter(Boolean).map(encodeURIComponent).join("/")}`;

const sourceName = (source) => index.sources[source] || source;
const chainTitle = (entry) => `${sourceName(entry.source)} ${entry.number}`;

// Longest common subsequence over two token arrays; returns which tokens of each are kept.
function common(a, b) {
  const n = a.length, m = b.length;
  const keepA = new Array(n).fill(false), keepB = new Array(m).fill(false);
  if (n * m > 250000) return { keepA, keepB };
  const table = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { keepA[i] = keepB[j] = true; i++; j++; }
    else if (table[i + 1][j] >= table[i][j + 1]) i++;
    else j++;
  }
  return { keepA, keepB };
}

/** A step's text exactly as released, with the words that differ from `other` marked. */
function markedText(text, other, cls) {
  const words = text.split(/(\s+)/), others = other.split(/(\s+)/);
  const { keepA } = common(words, others);
  return words.map((word, i) => (keepA[i] || !word.trim() ? esc(word) : `<mark class="${cls}">${esc(word)}</mark>`)).join("");
}

let released = false; // true: display step text exactly as released, with no typesetting
try {
  released = localStorage.getItem(STEP_TEXT_KEY) === "released";
} catch (error) {
  released = false;
}
const rendered = new Map(); // TeX -> KaTeX's HTML, or null when KaTeX rejected the TeX

function formulaHtml(tex) {
  if (!rendered.has(tex)) {
    let html = null;
    try {
      html = window.katex ? window.katex.renderToString(tex, KATEX_OPTIONS) : null;
    } catch (error) {
      html = null;
    }
    rendered.set(tex, html);
  }
  return rendered.get(tex);
}

/**
 * A step's text as HTML. Mathematics in it is typeset by KaTeX (step-math.js); a formula that
 * KaTeX rejects is displayed as released. When `other` is given, the tokens that differ from
 * it are marked with class `cls`.
 */
function stepHtml(text, other = null, cls = "") {
  if (released || !window.katex) return other === null ? esc(text) : markedText(text, other, cls);
  let changed = null;
  if (other !== null) {
    const mine = stepTokens(text).tokens.map((token) => token.raw);
    const theirs = stepTokens(other).tokens.map((token) => token.raw);
    changed = common(mine, theirs).keepA.map((kept) => !kept);
  }
  const mark = (piece) => (piece.changed ? `<mark class="${cls}">${esc(piece.raw)}</mark>` : esc(piece.raw));
  const made = pieces(text, changed, cls);
  let html = "";
  for (let k = 0; k < made.length; k++) {
    const piece = made[k];
    if (piece.kind === "text") { html += mark(piece); continue; }
    const formula = formulaHtml(piece.tex);
    if (formula === null) { html += piece.fallback.map(mark).join(""); continue; }
    // Punctuation written directly after a formula stays on the formula's line ("d;").
    const next = made[k + 1];
    const attached = next && next.kind === "text" ? next.raw.match(/^\S+/) : null;
    if (!attached) { html += formula; continue; }
    html += `<span class="glue">${formula}${mark({ ...next, raw: attached[0] })}</span>`;
    made[k + 1] = { ...next, raw: next.raw.slice(attached[0].length) };
  }
  return html;
}

/** A Lean statement as highlighted HTML; tokens absent from `base` are marked as changed. */
function leanHtml(statement, base) {
  const tokens = tokenizeStatement(statement);
  let changed = null;
  if (base) {
    const strip = (items) => items.filter((t, k) => t.kind !== "space" && !isName(items, k));
    const mine = strip(tokens), theirs = strip(tokenizeStatement(base));
    const { keepA } = common(mine.map((t) => t.text), theirs.map((t) => t.text));
    changed = new Set(mine.filter((_, k) => !keepA[k]));
    // When more than half of the tokens differ, marking them all adds nothing: mark none.
    if (changed.size > mine.length / 2) changed = null;
  }
  return tokens
    .map((t) => {
      if (t.kind === "space") return esc(t.text);
      const typed = t.kind === "ident" && /^[A-Z]/.test(t.text);
      const kind = typed ? "type" : t.kind;
      const flag = changed && changed.has(t) ? " is-changed" : "";
      if (t.kind === "punct" && !flag) return esc(t.text);
      return `<span class="lk lk--${kind}${flag}">${esc(t.text)}</span>`;
    })
    .join("");
}

// A theorem's name is arbitrary and is left out of the comparison of two statements.
function isName(tokens, k) {
  for (let j = k - 1; j >= 0; j--) {
    if (tokens[j].kind === "space") continue;
    return tokens[j].kind === "keyword" && (tokens[j].text === "theorem" || tokens[j].text === "lemma");
  }
  return false;
}

// ---------------------------------------------------------------- the notes on a formal statement

function numberNote(cell) {
  const absent = cell.absent || [], present = cell.present || [];
  if (!absent.length && !present.length) return null;
  const noun = (items) => (items.length === 1 ? "The number" : "The numbers");
  if (absent.length && !present.length)
    return { flag: true, text: `${noun(absent)} ${join(absent)}, introduced by the perturbation, ${absent.length === 1 ? "does" : "do"} not occur in the formal statement.` };
  if (present.length && !absent.length)
    return { flag: false, text: `${noun(present)} ${join(present)}, introduced by the perturbation, ${present.length === 1 ? "occurs" : "occur"} in the formal statement.` };
  return { flag: true, text: `Of the numbers introduced by the perturbation, ${join(present)} ${present.length === 1 ? "occurs" : "occur"} in the formal statement and ${join(absent)} ${absent.length === 1 ? "does" : "do"} not.` };
}

function notes(cell, version) {
  const perturbed = version !== "unperturbed";
  const out = [];
  const add = (text, flag = false) => out.push({ text, flag });
  switch (cell.verdict) {
    case "Proved":
      add(perturbed ? "The prover proved this formal statement of a perturbed step. The benchmark counts it as a false positive." : "The prover proved this formal statement.", perturbed);
      break;
    case "Refuted":
      add(perturbed ? "The prover proved the negation of this formal statement, the expected result for a perturbed step." : "The prover proved the negation of this formal statement of an unperturbed step. The benchmark counts it as a false negative.", !perturbed);
      break;
    case "Unknown":
      add("The prover found neither a proof nor a refutation of this formal statement.");
      break;
    case "TC-Fail":
      add("Lean rejected this formal statement at type-checking, so no proof was attempted.");
      break;
    default:
      add("The benchmark extracted no Lean statement from the autoformaliser’s output for this step.");
  }
  if (perturbed && cell.statement) {
    const numbers = numberNote(cell);
    if (numbers) add(numbers.text, numbers.flag && cell.verdict === "Proved");
    if (cell.same) add("The formal statement is identical to this autoformaliser’s statement for the unperturbed step.", cell.verdict === "Proved");
  }
  if (cell.through_false) add("The proof text contains a derivation of False (ex falso).", true);
  if (cell.lean === "premises_cannot_hold")
    add("Lean also proves this statement with its conclusion replaced by False, so its hypotheses are unsatisfiable.", true);
  return out;
}

const falsePositivesIn = (step) =>
  FORMALISERS.reduce((total, [id]) => total + ["llm", "regex"].filter((v) => step.formalisers[id]?.[v]?.verdict === "Proved").length, 0);

// ---------------------------------------------------------------- shared chrome

function lockup() {
  return `<span class="fam-lockup">
    <a class="fam-lockup__home" href="https://wcook04.github.io/" rel="author" title="All of Will Cook's projects and videos">
      <img src="plectis.svg" alt="" width="26" height="26">
      <span class="fam-lockup__owner" translate="no">Will Cook</span>
    </a>
    <span class="fam-lockup__rule" aria-hidden="true"></span>
    <a class="fam-lockup__site" href="#/"><span class="fam-lockup__name" translate="no">FaithformBench Reader</span></a>
  </span>`;
}

function themeButton() {
  const dark = currentTheme() === "dark";
  return `<button type="button" class="bar__theme" data-action="theme" aria-label="Switch to the ${dark ? "day" : "night"} colours">${dark ? "Day" : "Night"}</button>`;
}

function currentTheme() {
  const set = document.documentElement.getAttribute("data-theme");
  if (set) return set;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function toggleTheme() {
  const next = currentTheme() === "dark" ? "light" : "dark";
  const system = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  document.documentElement.classList.add("no-transitions");
  try {
    if (next === system) {
      document.documentElement.removeAttribute("data-theme");
      localStorage.removeItem(THEME_KEY);
    } else {
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem(THEME_KEY, next);
    }
  } catch (error) {
    document.documentElement.setAttribute("data-theme", next);
  }
  requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.remove("no-transitions")));
  const button = root.querySelector('[data-action="theme"]');
  if (button) button.outerHTML = themeButton();
}

// The button that switches step text between typeset mathematics and the released characters.
function stepTextButton() {
  return `<button type="button" class="bar__theme" data-action="step-text">${released ? "Show typeset text" : "Show released text"}</button>`;
}

function toggleStepText() {
  released = !released;
  try {
    if (released) localStorage.setItem(STEP_TEXT_KEY, "released");
    else localStorage.removeItem(STEP_TEXT_KEY);
  } catch (error) {
    // The choice then lasts until the page is reloaded.
  }
  drawn = { chain: null };
  draw();
}

// The work this site displays, and where its authors published it.
const PAPER = "https://arxiv.org/abs/2608.10916";
const AUTHORS_CODE = "https://github.com/Ighina/FaithformBench";
const AUTHORS = "Rob Cornish, Iacopo Ghinassi, Po-Hung Yeh, Shuqi Liu, Qiyuan Xu, Haoxuan Yin, Dominik Wagner, Wenda Li, Yee Whye Teh and Luke Ong";
const datasetUrl = (id = index.dataset.id) => `https://huggingface.co/datasets/${esc(id)}`;

function footer() {
  return `<footer class="foot">
    <p>The reasoning steps, Lean statements, proofs and verdicts are the work of the authors of <a href="${PAPER}">FaithformBench</a> (Cornish, Ghinassi and coauthors, 2026), from <a href="${datasetUrl()}">their released data</a> under <a href="LICENSE-FaithformBench.txt">the MIT licence</a>. Their code is at <a href="${AUTHORS_CODE}">github.com/Ighina/FaithformBench</a>. This site is an independent reader by Will Cook. Its counts, notes and labels are described in <a href="#/about">About and method</a>.</p>
    <nav class="fam-sites" aria-label="Will Cook's websites">
      <p class="fam-sites__title">More from Will Cook</p>
      <ul class="fam-sites__list">
        <li><a href="https://wcook04.github.io/quartic-query-lean/">Quartic Reader</a></li>
        <li><a href="https://wcook04.github.io/proof-reader/">General Reader</a></li>
        <li><a href="https://wcook04.github.io/lean-exposition-site/">SK Reader</a></li>
        <li><a href="https://wcook04.github.io/plectis-atlas/">Plectis Atlas</a></li>
        <li><a href="https://wcook04.github.io/">All projects and videos</a></li>
      </ul>
    </nav>
  </footer>`;
}

const topNav = (links) =>
  `<header class="top"><div class="wrap top__in">${lockup()}<nav class="top__nav" aria-label="This site">${links}${themeButton()}</nav></div></header>`;

// ---------------------------------------------------------------- the front page

function frontHtml() {
  const proved = index.introduced_number.false_positive;
  const refuted = index.introduced_number.refuted_perturbed;
  const share = (cell) => Math.round((100 * cell.count) / cell.of);
  const featured = index.featured;
  const start = featured ? href(featured.chain, featured.step, featured.version) : href(index.chains[0].id);
  return `<a class="skip-link" href="#main">Skip to the reasoning chains</a>
  ${topNav('<a href="#/about">About and method</a>')}
  <main id="main" class="wrap front" tabindex="-1">
    <section class="hero">
      <h1>Reasoning steps beside their Lean formalisations</h1>
      <p class="hero__lede">An independent reader for the public results of <a href="${PAPER}">FaithformBench</a>, a benchmark of autoformalisation faithfulness by Rob Cornish, Iacopo Ghinassi and coauthors.</p>
      <p class="hero__credit">The benchmark, the reasoning steps, the Lean statements, the proofs and the verdicts are the authors’ work, shown as they released them (<a href="${PAPER}">paper</a>, <a href="${AUTHORS_CODE}">code</a>, <a href="${datasetUrl()}">data</a>). Will Cook made this site to read that release: each of the ${count(12784)} reasoning steps is shown with the Lean 4 statement that each of four autoformalisers produced for it. The counts, notes and labels on these pages were added here and are not part of the benchmark.</p>
      <p class="hero__go"><a class="control control--primary" data-primary-cta href="${start}">Open an example</a> ${index.ai ? '<a class="hero__more" href="#/labels">False positives by label</a> ' : ""}<a class="hero__more" href="${REPOSITORY}">Method and code</a></p>
      <p class="hero__finding"><span class="hero__added">A count added here, from the released text.</span> A false positive is a formal statement of a perturbed step that the prover proved. Among the false positives where the perturbation introduced a number, that number is absent from the formal statement in <strong>${count(proved.count)} of ${count(proved.of)}</strong> (${share(proved)}%). Among the formal statements of perturbed steps that the prover refuted, it is absent in ${count(refuted.count)} of ${count(refuted.of)} (${share(refuted)}%).</p>
    </section>
    <section class="solutions" aria-labelledby="solutions-title">
      <h2 id="solutions-title">Reasoning chains</h2>
      <p class="solutions__note">${count(index.chains.length)} chains from four problem sets. Each perturbed step has up to four formal statements, one from each autoformaliser, so a chain can have more false positives than steps.</p>
      <div class="filters" id="filters"></div>
      <p class="sols__key">The full width of a bar is the number of formal statements of perturbed steps in one chain. <span class="key key--absent" aria-hidden="true"></span>False positives where the introduced number is absent from the formal statement. <span class="key key--other" aria-hidden="true"></span>Other false positives.</p>
      <div class="sols__head" aria-hidden="true">
        <span class="sols__h sols__h--title">Chain</span>
        <span class="sols__h sols__h--opening">First step</span>
        <span class="sols__h sols__h--steps">Steps</span>
        <span class="sols__h sols__h--fp">False positives</span>
        <span class="sols__h sols__h--absent">Introduced number absent</span>
        <span class="sols__h sols__h--bar"></span>
      </div>
      <ul class="sols" id="sols"></ul>
      <p class="more" id="more"></p>
    </section>
  </main>
  <div class="wrap">${footer()}</div>`;
}

function renderList(previouslyShown = 0) {
  const rows = index.chains.filter((entry) => list.source === "all" || entry.source === list.source);
  if (list.order === "most") rows.sort((a, b) => b.false_positives - a.false_positives || compareChainIds(a.id, b.id));
  if (!previouslyShown) {
    const sources = [["all", "All"], ...Object.entries(index.sources)];
    document.getElementById("filters").innerHTML = `
      <div class="filters__group" role="group" aria-label="Problem set">
        ${sources.map(([id, name]) => `<button type="button" class="switch__item" data-source="${esc(id)}" aria-pressed="${list.source === id}">${esc(name)}</button>`).join("")}
      </div>
      <div class="filters__group" role="group" aria-label="Order">
        <button type="button" class="switch__item" data-order="most" aria-pressed="${list.order === "most"}">Most false positives first</button>
        <button type="button" class="switch__item" data-order="number" aria-pressed="${list.order === "number"}">By number</button>
      </div>`;
  }
  const html = rows
    .slice(previouslyShown, list.shown)
    .map((entry) => {
      // The bar's full width is the chain's formal statements of perturbed steps.
      const share = (n) => (entry.perturbed ? (100 * n) / entry.perturbed : 0).toFixed(2);
      const number = (cls, label, n) => `<span class="sol__n sol__n--${cls}${n ? "" : " is-zero"}"><span class="sr-only">${label}: </span>${count(n)}</span>`;
      return `<li class="sol">
        <a class="sol__title" href="${href(entry.id)}">${esc(chainTitle(entry))}</a>
        <p class="sol__opening">${stepHtml(entry.opening)}</p>
        ${number("steps", "Steps", entry.steps)}
        ${number("fp", "False positives", entry.false_positives)}
        ${number("absent", "False positives where the introduced number is absent from the formal statement", entry.missing)}
        <span class="sol__bar" aria-hidden="true"><span class="sol__bar-absent" style="width:${share(entry.missing)}%"></span><span class="sol__bar-other" style="width:${share(entry.false_positives - entry.missing)}%"></span></span>
      </li>`;
    })
    .join("");
  const listElement = document.getElementById("sols");
  if (previouslyShown) listElement.insertAdjacentHTML("beforeend", html);
  else listElement.innerHTML = html;
  const left = rows.length - Math.min(list.shown, rows.length);
  document.getElementById("more").innerHTML = left
    ? `<button type="button" class="control" data-action="more">Show ${count(Math.min(PAGE, left))} more</button> <span class="more__count">${count(Math.min(list.shown, rows.length))} of ${count(rows.length)} shown</span>`
    : `<span class="more__count">All ${count(rows.length)} shown</span>`;
}

// ---------------------------------------------------------------- about and method

function aboutHtml() {
  const ai = index.ai;
  // Steps whose regex-perturbed text is not the same in all four autoformalisers' rows.
  const differs = index.step_text_differs?.regex_perturbed;
  const onlyStepFun = differs && Object.keys(differs.groups || {}).join() === "goedel+herald+kimina | stepfun";
  return `<a class="skip-link" href="#main">Skip to the text</a>
  ${topNav('<a href="#/">Reasoning chains</a>')}
  <main id="main" class="wrap prose" tabindex="-1">
    <h1>About and method</h1>
    <p>This site is an independent reader for the public results of <a href="${PAPER}">FaithformBench</a>. Will Cook made it. The authors of FaithformBench have not reviewed or endorsed it.</p>
    <h2>The benchmark and its authors</h2>
    <p><em>FaithformBench: Benchmarking Faithfulness of Mathematical Chain-of-Thought Autoformalisation</em> is by ${AUTHORS}, of Nanyang Technological University, the University of Oxford and the University of Edinburgh (<a href="${PAPER}">arXiv:2608.10916</a>). The authors published <a href="${AUTHORS_CODE}">their code</a> and <a href="${datasetUrl()}">their data</a>, and the data is under <a href="LICENSE-FaithformBench.txt">the MIT licence</a>. The reasoning chains in the benchmark come from ProcessBench (Zheng and coauthors, ACL 2025).</p>
    <h2>What is the authors’ work and what this site adds</h2>
    <ul>
      <li><strong>The authors’ work.</strong> The design of the benchmark, the perturbed version of each step, every Lean statement and every proof and verdict. The four autoformalisers and the prover produced these in the authors’ experiments. This site displays them as released, at revision <code>${esc(index.dataset.revision.slice(0, 7))}</code> of the data.</li>
      <li><strong>Added by this site.</strong> The pages, the typesetting of step text, the marks on changed words, the counts, the notes under each formal statement, a Lean test on a sample of statements and labels assigned by a language model on a sample. No autoformaliser and no prover was run again.</li>
    </ul>
    <h2>Terms</h2>
    <dl class="terms">
      <dt>Reasoning chain and step</dt><dd>A reasoning chain is a worked solution to one problem from GSM8K, MATH, OlympiadBench or Omni-MATH, taken from the error-free subset of ProcessBench. A step is one line of the chain. The release contains only the steps the authors classed as verifiable and omits declarative steps, so step numbers are not consecutive.</dd>
      <dt>Unperturbed and perturbed</dt><dd>Each step appears in three versions: unperturbed, perturbed by a language model, and perturbed by a regular expression. A perturbation changes the step with the aim of making it invalid.${differs && differs.count ? ` The release repeats the step text in each autoformaliser’s row. For ${count(differs.count)} of the ${count(differs.of)} regex-perturbed steps, ${onlyStepFun ? "the text in the row for StepFun differs from the text in the rows for the other three autoformalisers" : "the text is not the same in all four rows"}. For those steps this site prints the differing text above the formal statement of the autoformaliser whose row contains it, and every note compares a formal statement with the text in its own row.` : ""}</dd>
      <dt>Autoformaliser</dt><dd>A model that translates a step into a statement in Lean 4, a proof assistant. The release covers four fine-tuned autoformalisers: Goedel-Formalizer-V2, Herald, Kimina-Autoformalizer and StepFun-Formalizer.</dd>
      <dt>Verdict</dt><dd>DeepSeek-Prover-V2 attempted each formal statement. <em>Proved</em>: it found a proof. <em>Refuted</em>: it found a proof of the negation. <em>Unknown</em>: it found neither (Inconclusive in the paper’s tables). <em>Type-check failure</em>: Lean rejected the statement at type-checking, before any proof attempt. <em>Extraction failure</em> (AF-Fail in the release): the benchmark extracted no Lean statement from the autoformaliser’s output, or the prompt exceeded the benchmark’s length limit and was not sent. The paper’s tables count type-check failures and extraction failures together as AF-Fail.</dd>
      <dt>False positive</dt><dd>A formal statement of a perturbed step that the prover proved. The benchmark’s false positive rate counts these. The paper’s name for the failure that a false positive indicates is silent correction.</dd>
    </dl>
    <h2>Notes computed by a program</h2>
    <p>Each note under a formal statement is the output of a fixed program run on the released text. No model and no person produced these notes.</p>
    <ul>
      <li><strong>An introduced number does not occur.</strong> The program collects the numbers in the perturbed step that are absent from the unperturbed step, then searches for each in the formal statement as text. A number written in another form in Lean, such as 60% as <code>3/5</code>, is reported as not occurring.</li>
      <li><strong>Identical formal statement.</strong> The autoformaliser’s statement for the perturbed step equals its statement for the unperturbed step after comments, the theorem name and whitespace are removed.</li>
      <li><strong>Derivation of False.</strong> The prover’s proof text contains <code>exfalso</code>, <code>False.elim</code>, <code>absurd</code> or a step of type <code>False</code>. A proof by ex falso derives a contradiction from the hypotheses, after which any conclusion follows.</li>
      <li><strong>Unsatisfiable hypotheses.</strong> For a sample of 720 proved statements, Lean was given the statement with its conclusion replaced by <code>False</code> and a fixed list of tactics. Where Lean accepted a proof, the hypotheses cannot all hold. Only sampled statements have this note.</li>
    </ul>
    <p>In a perturbed step, the marked words are those that differ from the unperturbed step. In a formal statement, the marked tokens are those that differ from the same autoformaliser’s statement for the unperturbed step; when more than half differ, none are marked.</p>
    <h2>Typeset step text</h2>
    <p>The release gives each step as plain characters, for example <code>log_b(a)</code> and <code>x^3</code>, and some steps contain LaTeX. This site displays the mathematics in a step with <a href="https://katex.org/">KaTeX</a>. For mathematics written in plain characters, only position and font change: <code>_</code> and <code>^</code> become subscripts and superscripts, names such as log and sin are upright, and no character is added, removed or replaced. A program in <a href="${REPOSITORY}">the repository</a> compares, for every step text in the release, the characters that KaTeX displays with the released characters; the README states its result. KaTeX rejects a small number of formulas, and the site displays those as released. LaTeX in the release is given to KaTeX as written. On the page of a reasoning chain, the button “Show released text” displays every step as its released characters.</p>
    ${ai ? `<h2>Labels assigned by a language model</h2>
    <p>${count(ai.items)} proved formal statements, sampled with a fixed seed, each have a block headed “Labelled by a language model”. ${esc(ai.models.first)} was given the step, the formal statement and <a href="${REPOSITORY}/blob/main/docs/label_rubric.md">a written rubric</a>, and returned two labels: the relation of the formal statement to the step, and, for a perturbed step, why the statement is provable. ${esc(ai.models.second)} labelled ${count(ai.agreement.items)} of the same statements without access to the first labels. The two sets of labels agree on the relation for ${count(ai.agreement.relation.count)} of ${count(ai.agreement.relation.of)} statements and on the reason for provability for ${count(ai.agreement.mechanism.count)} of ${count(ai.agreement.mechanism.of)} perturbed steps. Lean did not verify the labels and no person has reviewed them. <a href="#/labels">The labelled statements are listed by label.</a></p>` : ""}
    <h2>How this site was made</h2>
    <p>Will Cook wrote the programs that build these pages and compute the counts and notes, with an AI coding assistant. No one else has reviewed the programs or their output. The code, the counts and their limits are in <a href="${REPOSITORY}">the repository</a>.</p>
  </main>
  <div class="wrap">${footer()}</div>`;
}

// ---------------------------------------------------------------- the reader

const readerTitle = (chain) => `${chain.navigation.source_name} ${chain.number}`;

function readerHtml(chain, step, version) {
  const { previous, next, dataset_id: datasetId } = chain.navigation;
  const stepper = (other, word) =>
    other ? `<a class="bar__link" href="${href(other)}">${word} chain</a>` : `<span class="bar__link is-off">${word} chain</span>`;
  return `<a class="skip-link" href="#panel">Skip to the formal statements</a>
  <div class="page">
    <header class="bar">
      <div class="bar__left">${lockup()}</div>
      <div class="bar__column"><p class="bar__paper">${esc(readerTitle(chain))}</p>
        <nav class="stepper" aria-label="Other reasoning chains">${stepper(previous, "Previous")}${stepper(next, "Next")}<a class="bar__link" href="#/">All chains</a></nav></div>
      <div class="bar__right"><a class="bar__link" href="#/about">About and method</a>${stepTextButton()}${themeButton()}</div>
    </header>
    <div class="spread">
      <main id="main" class="left" aria-label="The reasoning chain">
        <div class="sheet">
          <h1 class="sheet__title">${esc(readerTitle(chain))}</h1>
          <p class="sheet__note">Reasoning chain <code>${esc(chain.id)}</code>, unperturbed, from the <a href="${PAPER}">FaithformBench</a> release by Cornish, Ghinassi and coauthors. Select a step to show the four formal statements produced for it. The release omits declarative steps, so step numbers are not consecutive.</p>
          <ol class="steps">
            ${chain.steps.map((s) => stepItem(chain, s, s.id === step.id, version)).join("")}
          </ol>
          <p class="sheet__credit">The steps, Lean statements, proofs and verdicts are the work of the FaithformBench authors (<a href="${PAPER}">paper</a>, <a href="${AUTHORS_CODE}">code</a>, <a href="${datasetUrl(datasetId)}">data</a>, <a href="LICENSE-FaithformBench.txt">MIT licence</a>). The notes and labels under each statement were added by this site, as <a href="#/about">About and method</a> describes.</p>
        </div>
      </main>
      <section class="right" id="panel" aria-label="The formal statements" tabindex="-1">${panelHtml(chain, step, version)}</section>
    </div>
  </div>`;
}

function stepItem(chain, step, selected, version) {
  const found = falsePositivesIn(step);
  return `<li class="step${selected ? " is-on" : ""}" data-step="${esc(step.id)}">
    <a class="step__link" href="${href(chain.id, step.id, version)}"${selected ? ' aria-current="true"' : ""}>
      <span class="step__no">${step.n}</span>
      <span class="step__text">${stepHtml(step.text.unperturbed || "")}</span>
      ${found ? `<span class="step__count">${plural(found, "false positive", "false positives")}</span>` : ""}
    </a>
  </li>`;
}

function panelHtml(chain, step, version) {
  const original = step.text.unperturbed || "";
  const perturbed = version === "unperturbed" ? null : step.text[version];
  const switcher = VERSIONS.map(([id, name]) => {
    const has = id === "unperturbed" || step.text[id];
    return has
      ? `<a class="switch__item" href="${href(chain.id, step.id, id)}"${id === version ? ' aria-current="true"' : ""}>${esc(name)}</a>`
      : "";
  }).join("");
  const parents = step.parents.map((id) => id.replace(/^step_/, ""));
  // The release repeats the step text in every autoformaliser's row. Where one row has a
  // different text, that text is printed above that autoformaliser's statement (declHtml)
  // and the label here names the rows that share the text printed at the top.
  const sharing = FORMALISERS.filter(([id]) => step.formalisers[id]?.[version] && !step.formalisers[id][version].step).map(([, name]) => name);
  const perturbedLabel = sharing.length < FORMALISERS.length
    ? `${VERSION_NAME[version]} step in the rows for ${join(sharing)}`
    : `${VERSION_NAME[version]} step`;
  const texts = perturbed
    ? `<div class="vtext"><p class="vtext__label">Unperturbed step</p><p class="vtext__body">${stepHtml(original, perturbed, "was")}</p></div>
       <div class="vtext vtext--wrong"><p class="vtext__label">${esc(perturbedLabel)}</p><p class="vtext__body">${stepHtml(perturbed, original, "now")}</p></div>`
    : `<div class="vtext"><p class="vtext__label">Unperturbed step</p><p class="vtext__body">${stepHtml(original)}</p></div>`;
  const cells = FORMALISERS.map(([id, name]) => [name, step.formalisers[id]?.[version], step.formalisers[id]?.unperturbed]);
  // For a perturbed step, the proved statements (the false positives) come first.
  if (version !== "unperturbed") cells.sort((x, y) => (y[1]?.verdict === "Proved") - (x[1]?.verdict === "Proved"));
  const proved = cells.filter(([, cell]) => cell?.verdict === "Proved").length;
  const summary =
    version === "unperturbed"
      ? `${proved} of the 4 formal statements for the unperturbed step ${proved === 1 ? "was" : "were"} proved.`
      : proved
        ? `${proved} of the 4 formal statements for the perturbed step ${proved === 1 ? "was" : "were"} proved: ${plural(proved, "false positive", "false positives")}.`
        : "None of the 4 formal statements for the perturbed step was proved.";
  return `<div class="panel">
    <header class="panel__head">
      <h2 class="panel__title">Step ${step.n}</h2>
      ${parents.length ? `<p class="panel__from">Depends on ${parents.length === 1 ? "step" : "steps"} ${join(parents)}.</p>` : ""}
      <nav class="switch" aria-label="Version of the step">${switcher}</nav>
    </header>
    ${texts}
    <p class="panel__sum">${summary}</p>
    ${cells.map(([name, cell, base]) => declHtml(name, cell, version, base, original)).join("")}
  </div>`;
}

function declHtml(name, cell, version, base, original) {
  if (!cell) return `<article class="decl"><header class="decl__head"><h3 class="decl__name">${name}</h3><span class="verdict">Not in the release</span></header></article>`;
  const perturbed = version !== "unperturbed";
  const falsePositive = perturbed && cell.verdict === "Proved";
  const compare = perturbed && !cell.same && base?.statement ? base.statement : null;
  const lines = notes(cell, version);
  const ownStep = cell.step
    ? `<div class="vtext vtext--wrong decl__step"><p class="vtext__label">${esc(VERSION_NAME[version])} step in the row for ${name}. The notes below compare the formal statement with this text.</p><p class="vtext__body">${perturbed ? stepHtml(cell.step, original, "now") : stepHtml(cell.step)}</p></div>`
    : "";
  return `<article class="decl${falsePositive ? " decl--fp" : ""}">
    <header class="decl__head">
      <h3 class="decl__name">${name}</h3>
      <span class="verdict verdict--${esc(cell.verdict.toLowerCase())}${falsePositive ? " verdict--fp" : ""}">${esc(VERDICT_WORD[cell.verdict] || cell.verdict)}</span>
      ${falsePositive ? '<span class="decl__tag">False positive</span>' : ""}
    </header>
    ${ownStep}
    <ul class="decl__notes">${lines.map((line) => `<li${line.flag ? ' data-flagged="true"' : ""}>${esc(line.text)}</li>`).join("")}</ul>
    ${cell.ai ? labelHtml(cell.ai) : ""}
    ${cell.statement ? `<div class="decl__code" tabindex="0" role="group" aria-label="Formal statement produced by ${name}"><code class="lean-code">${leanHtml(cell.statement, compare)}</code></div>` : ""}
  </article>`;
}

// The labels a language model assigned to one statement, laid out as Proof Reader lays out
// its comparisons (.fid).
function labelHtml(ai) {
  const why = ai.mechanism && ai.mechanism !== "n/a" ? `<p class="fid__why">Reason for provability: ${esc(lowerFirst(MECHANISM_WORD[ai.mechanism]))}.</p>` : "";
  let second = "";
  if (ai.second) {
    const same = ai.second.relation === ai.relation && ai.second.mechanism === ai.mechanism;
    second = same
      ? "Second labelling pass: the same labels."
      : `Second labelling pass: ${esc(lowerFirst(RELATION_WORD[ai.second.relation] || ""))}${
          ai.second.mechanism !== "n/a" ? `; ${esc(lowerFirst(MECHANISM_WORD[ai.second.mechanism]))}` : ""
        }.`;
  }
  return `<section class="fid" data-verdict="${esc(ai.relation)}" aria-label="Labels assigned by a language model">
    <p class="fid__head"><span class="decl__label">Step and formal statement</span> <span class="fid__by">Labelled by a language model</span></p>
    <p class="fid__verdict">${esc(RELATION_WORD[ai.relation])}.</p>
    <p class="fid__text"><span class="fid__quoted">The model’s explanation:</span> ${esc(ai.reason)}</p>
    ${why}
    ${second ? `<p class="fid__second">${second}</p>` : ""}
  </section>`;
}

// The sampled statements a language model labelled, grouped by label.
function labelsHtml() {
  const ai = index.ai;
  const entry = Object.fromEntries(index.chains.map((chain) => [chain.id, chain]));
  const formaliser = Object.fromEntries(FORMALISERS);
  const row = (c) => `<li><span class="case__where"><a href="${href(c.chain, c.step, c.version)}">${esc(chainTitle(entry[c.chain]))}, step ${esc(c.step.replace(/^step_/, ""))}</a>, ${esc(formaliser[c.formaliser] || c.formaliser)}</span> <span class="case__why">${esc(c.reason)}</span></li>`;
  const group = (title, cases) =>
    cases.length ? `<section class="group"><h3>${esc(title)} <span class="group__n">${count(cases.length)}</span></h3><ul class="cases">${cases.map(row).join("")}</ul></section>` : "";
  const perturbed = ai.cases.filter((c) => c.version !== "unperturbed");
  const unperturbed = ai.cases.filter((c) => c.version === "unperturbed");
  const share = (cell) => `${count(cell.count)} of ${count(cell.of)}`;
  return `<a class="skip-link" href="#main">Skip to the labelled statements</a>
  ${topNav('<a href="#/">Reasoning chains</a><a href="#/about">About and method</a>')}
  <main id="main" class="wrap labels" tabindex="-1">
    <h1>Labels on a sample of proved statements</h1>
    <p class="labels__lede">${count(ai.items)} proved formal statements, sampled with a fixed seed, were labelled by ${esc(ai.models.first)} following <a href="${REPOSITORY}/blob/main/docs/label_rubric.md">a written rubric</a>. ${esc(ai.models.second)} labelled ${count(ai.agreement.items)} of the same statements without access to the first labels. The two sets of labels agree on the relation for ${share(ai.agreement.relation)} statements and on the reason for provability for ${share(ai.agreement.mechanism)} perturbed steps. No person has reviewed the labels.</p>
    <h2>False positives: why the formal statement is provable</h2>
    <p class="labels__note">${count(perturbed.length)} sampled false positives. Each link opens the formal statement beside its step. The sentence after each link is the reason the model gave.</p>
    ${Object.keys(MECHANISM_WORD).map((key) => group(MECHANISM_WORD[key], perturbed.filter((c) => c.mechanism === key))).join("")}
    <h2>Unperturbed steps: relation of the proved statement to the step</h2>
    <p class="labels__note">${count(unperturbed.length)} sampled statements of unperturbed steps. ${count(unperturbed.filter((c) => c.relation === "same").length)} are labelled equivalent to the step and are not listed.</p>
    ${["different", "less", "more", "cannot_tell"].map((key) => group(RELATION_WORD[key], unperturbed.filter((c) => c.relation === key))).join("")}
  </main>
  <div class="wrap">${footer()}</div>`;
}

// On a narrow screen the formal statements open under the selected step.
function placePanel() {
  const panel = document.getElementById("panel");
  if (!panel) return;
  const on = root.querySelector(".step.is-on");
  const spread = root.querySelector(".spread");
  if (narrow.matches && on) on.append(panel);
  else if (spread && panel.parentElement !== spread) spread.append(panel);
}

// ---------------------------------------------------------------- drawing a route

let drawn = { chain: null };
let pendingDraw = 0;

// The paper/proof divider uses the Proof Reader's pointer-capture and CSS-width pattern.
function installPaperSplit(grid, left, right, key) {
  if (!grid || !left || !right) return () => {};
  const grip = document.createElement("div");
  grip.className = "paper-split";
  grip.tabIndex = 0;
  grip.setAttribute("role", "separator");
  grip.setAttribute("aria-orientation", "vertical");
  grip.setAttribute("aria-label", "Resize the reading and companion panes");
  grip.title = "Drag to resize. Use arrow keys to adjust or double-click to reset.";
  grip.append(document.createElement("span"));
  right.before(grip);

  let share = null;
  try {
    const saved = Number(localStorage.getItem(key));
    if (saved > .2 && saved < .8) share = saved;
  } catch { /* storage is optional */ }
  let finish;
  let width = 0;
  const measure = () => {
    if (!grip.getClientRects().length) return;
    const next = left.clientWidth + right.clientWidth;
    if (width !== next) {
      width = next;
      draw(share);
    }
    describe();
  };
  const limit = () => Math.min(.42, Math.max(.22, 300 / width));
  const describe = () => {
    const min = Math.round(100 * limit());
    const now = Math.round(100 * left.clientWidth / width);
    grip.setAttribute("aria-valuemin", min);
    grip.setAttribute("aria-valuemax", 100 - min);
    grip.setAttribute("aria-valuenow", now);
    grip.setAttribute("aria-valuetext", `Reading pane ${now}%`);
  };
  const draw = (value) => {
    if (!width) return;
    share = value === null ? null : Math.min(1 - limit(), Math.max(limit(), value));
    if (share === null) grid.style.removeProperty("--split-paper");
    else grid.style.setProperty("--split-paper", `${Math.round(share * width)}px`);
    grid.toggleAttribute("data-paper-split", share !== null);
  };
  const save = () => {
    try {
      if (share === null) localStorage.removeItem(key);
      else localStorage.setItem(key, String(share));
    } catch { /* storage is optional */ }
  };
  const reset = () => { draw(null); save(); };
  grip.addEventListener("dblclick", reset);
  grip.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Enter", "Home"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Enter" || event.key === "Home") reset();
    else { draw(left.clientWidth / width + (event.key === "ArrowRight" ? .025 : -.025)); save(); }
  });
  grip.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !width) return;
    event.preventDefault();
    grip.focus({ preventScroll: true });
    grip.setPointerCapture(event.pointerId);
    grid.classList.add("is-resizing");
    const start = event.clientX;
    const leftStart = left.clientWidth;
    let position = start;
    let frame = 0;
    const apply = () => {
      frame = 0;
      if (position !== start) draw((leftStart + position - start) / width);
    };
    const move = (next) => {
      position = next.clientX;
      if (!frame) frame = requestAnimationFrame(apply);
    };
    finish = () => {
      if (frame) cancelAnimationFrame(frame);
      apply();
      save();
      grid.classList.remove("is-resizing");
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("lostpointercapture", finish);
      finish = null;
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("lostpointercapture", finish);
  });
  const observer = new ResizeObserver(measure);
  observer.observe(left);
  observer.observe(right);
  measure();
  return () => {
    finish?.();
    observer.disconnect();
    grip.remove();
  };
}

let releasePaperSplit;

function page(title, html) {
  releasePaperSplit?.();
  releasePaperSplit = null;
  document.title = title;
  root.innerHTML = html;
  drawn = { chain: null };
  window.scrollTo(0, 0);
}

async function draw() {
  const request = ++pendingDraw;
  try {
    const route = parseRoute();
    if (!route.chain || route.chain === "about" || route.chain === "labels") {
      const catalog = route.chain === "labels"
        ? (fullIndex ??= await getJson("data/index.json"))
        : (overview ??= await getJson("data/overview.json", true)
          || (fullIndex ??= await getJson("data/index.json")));
      if (request !== pendingDraw) return;
      index = catalog;
      if (!route.chain) {
        page("FaithformBench Reader: reasoning steps beside their Lean formalisations", frontHtml());
        renderList();
        return;
      }
      if (route.chain === "about") return page("About and method: FaithformBench Reader", aboutHtml());
      if (index.ai) return page("Labels on a sample of proved statements: FaithformBench Reader", labelsHtml());
    }
    if (!chains.has(route.chain)) {
      chains.set(route.chain, await getJson(`data/chains/${encodeURIComponent(route.chain)}.json`, true));
    }
    const chain = chains.get(route.chain);
    if (chain && !chain.navigation) {
      // A cached chain file from before navigation was included still works with the full index.
      fullIndex ??= await getJson("data/index.json");
      const i = fullIndex.chains.findIndex((entry) => entry.id === chain.id);
      chain.navigation = {
        previous: fullIndex.chains[i - 1]?.id,
        next: fullIndex.chains[i + 1]?.id,
        source_name: fullIndex.sources[chain.source] || chain.source,
        dataset_id: fullIndex.dataset.id,
      };
    }
    if (request !== pendingDraw) return;
    if (!chain)
      return page("No page at this address: FaithformBench Reader", `<main id="main" class="lost"><h1>No page at this address</h1><p>This site has no reasoning chain or step with that name. <a href="#/">All reasoning chains.</a></p></main>`);
    const step = chain.steps.find((s) => s.id === route.step) || chain.steps[0];
    document.title = `${readerTitle(chain)}, step ${step.n}: FaithformBench Reader`;
    if (drawn.chain === chain.id && root.querySelector(".spread")) {
      // Same chain: change the selected step in place so the left page keeps its scroll position.
      const panel = document.getElementById("panel");
      const at = drawn.byId.get(step.id);
      if (at !== drawn.at) {
        const previous = drawn.steps[drawn.at];
        const next = drawn.steps[at];
        previous.row.classList.remove("is-on");
        previous.link.removeAttribute("aria-current");
        next.row.classList.add("is-on");
        next.link.setAttribute("aria-current", "true");
        drawn.at = at;
      }
      if (drawn.version !== route.version) {
        for (const { row, link } of drawn.steps) link.setAttribute("href", href(chain.id, row.dataset.step, route.version));
        drawn.version = route.version;
      }
      panel.innerHTML = panelHtml(chain, step, route.version);
      placePanel();
      if (!narrow.matches) panel.scrollTop = 0;
      return;
    }
    releasePaperSplit?.();
    root.innerHTML = readerHtml(chain, step, route.version);
    releasePaperSplit = installPaperSplit(root.querySelector(".spread"), root.querySelector(".left"),
      root.querySelector(".right"), "faithformbench-paper-share");
    const steps = Array.from(root.querySelectorAll(".step"), (row) => ({ row, link: row.querySelector(".step__link") }));
    const byId = new Map(steps.map(({ row }, i) => [row.dataset.step, i]));
    drawn = { chain: chain.id, steps, byId, at: byId.get(step.id), version: route.version };
    placePanel();
    if (route.step) steps[drawn.at]?.row.scrollIntoView({ block: "nearest" });
  } catch (error) {
    if (request !== pendingDraw) return;
    // A failed request or a fault in this script. Reported in the console so that a test of the page fails.
    console.error(error);
    page("This page could not be displayed: FaithformBench Reader", `<main id="main" class="lost"><h1>This page could not be displayed</h1><p>The page's data did not load, or the page's script stopped with an error. <a href="#/">All reasoning chains.</a></p></main>`);
  }
}

root.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action], [data-source], [data-order]");
  if (!target) return;
  if (target.dataset.action === "theme") return toggleTheme();
  if (target.dataset.action === "step-text") return toggleStepText();
  if (target.dataset.action === "more") {
    const previouslyShown = list.shown;
    list.shown += PAGE;
    renderList(previouslyShown);
    return;
  }
  if (target.dataset.source) { list.source = target.dataset.source; list.shown = PAGE; }
  if (target.dataset.order) { list.order = target.dataset.order; list.shown = PAGE; }
  renderList();
});

// The up and down arrow keys (or k and j) select the previous or next step of a chain.
document.addEventListener("keydown", (event) => {
  if (event.altKey || event.ctrlKey || event.metaKey || !drawn.steps) return;
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "j" && event.key !== "k") return;
  if (event.target.closest("input, textarea, select, .decl__code")) return;
  const direction = event.key === "ArrowDown" || event.key === "j" ? 1 : -1;
  const to = drawn.steps[drawn.at + direction];
  if (!to) return;
  event.preventDefault();
  location.hash = to.link.getAttribute("href");
  to.link.focus({ preventScroll: true });
  to.row.scrollIntoView({ block: "nearest" });
});

narrow.addEventListener("change", placePanel);
window.addEventListener("hashchange", draw);
draw();
