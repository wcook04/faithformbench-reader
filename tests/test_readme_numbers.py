"""Every figure the README states must equal the figure in the committed results."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
README = (ROOT / "README.md").read_text()
COUNTS = json.loads((ROOT / "results" / "counts.json").read_text())
LLM = "brokenmath-style_llm"
REGEX = "regex_perturbed"
MODELS = ("goedel", "herald", "kimina", "stepfun")


def full(cell):
    return f"{cell['count']:,} of {cell['of']:,} ({100 * cell['count'] / cell['of']:.1f}%)"


def percent(cell):
    return f"{100 * cell['count'] / cell['of']:.1f}%"


def test_main_count():
    for label in ("false_positive", "refuted_perturbed"):
        cells = COUNTS["introduced_number"][label]
        for key in (LLM, REGEX):
            assert full(cells[key]["all"]) in README
        assert full(cells["both_arms"]) in README


def test_main_count_per_autoformaliser():
    for label in ("false_positive", "refuted_perturbed"):
        for model in MODELS:
            pair = " / ".join(percent(COUNTS["introduced_number"][label][arm][model]) for arm in (LLM, REGEX))
            assert pair in README, (label, model, pair)


def test_last_number_test():
    cells = COUNTS["last_number_check"]
    for arm in ("unperturbed", LLM, REGEX):
        for verdict in ("Proved", "Refuted"):
            assert full(cells[arm][verdict]["all"]) in README, (arm, verdict)


def test_further_counts():
    for arm in (LLM, REGEX):
        assert full(COUNTS["identical_statement"][arm]["all"]) in README
        assert full(COUNTS["proof_through_false"][arm]["all"]) in README
    assert full(COUNTS["proof_through_false"]["unperturbed"]["all"]) in README


def test_dataset_sizes():
    assert f"{COUNTS['rows']:,} rows" in README
    for arm in (LLM, REGEX):
        assert f"{COUNTS['false_positives'][arm]['all']['count']:,}" in README
    assert f"{COUNTS['verdicts']['unperturbed']['Proved']:,}" in README


def test_step_text_that_differs_between_rows():
    differs = COUNTS["step_text_differs"]
    assert differs["unperturbed"]["count"] == 0 and differs[LLM]["count"] == 0
    assert differs[REGEX]["groups"] == {"goedel+herald+kimina | stepfun": differs[REGEX]["count"]}
    assert f"For {differs[REGEX]['count']:,} of the {differs[REGEX]['of']:,} regex-perturbed steps, the text in StepFun's row differs" in README


def test_first_example_is_the_one_quoted():
    examples = (ROOT / "results" / "examples.md").read_text()
    first = examples.split("\n## ", 2)[1]
    quoted = [line for line in first.splitlines() if line.startswith(("- Unperturbed step:", "- Perturbed step:"))]
    assert len(quoted) == 2
    for line in quoted:
        assert line in README


def test_lean_sample_figures():
    sample = json.loads((ROOT / "results" / "lean_sample.json").read_text())
    assert f"sample of {sample['sampled']} proved statements" in README
    assert f"Of the {sample['sampled']}, {sample['elaborated']} elaborated" in README
    weighted = {"false_positive": 0.0, "unperturbed_step": 0.0}
    sizes = {"false_positive": 0, "unperturbed_step": 0}
    for name, group in sample["groups"].items():
        assert f"{group['premises_cannot_hold']} of {group['n']}" in README
        assert f"{group['conclusion_is_a_premise']} of {group['n']}" in README
        side = name.split("|")[0]
        size = sample["population_proved_statements"][name]
        weighted[side] += group["premises_cannot_hold"] / group["n"] * size
        sizes[side] += size
    assert f"at least {100 * weighted['false_positive'] / sizes['false_positive']:.1f}% of false positives" in README
    assert f"{100 * weighted['unperturbed_step'] / sizes['unperturbed_step']:.1f}% of proved statements of unperturbed steps" in README


def test_model_label_figures():
    labels = json.loads((ROOT / "results" / "ai_labels.json").read_text())
    tally, shares, agreement = labels["tally"], labels["weighted_shares"], labels["agreement"]
    assert f"sample of {labels['items']} proved statements" in README
    assert f"{labels['models']['first']} was given" in README
    assert f"{labels['models']['second']} labelled {agreement['items']} of the same statements" in README
    for value, n in tally["perturbed"]["mechanism"].items():
        assert f"| {n} | {100 * shares['perturbed']['mechanism'][value]:.1f}% |" in README, value
    present = tally["perturbed"]["wrong_claim_in_lean"]
    assert f"In {present['no']} of the {tally['perturbed']['items']} sampled false positives" in README
    assert f"in {present['yes']} present and in {present['partly']} partly present" in README
    relation, share = tally["unperturbed"]["relation"], shares["unperturbed"]["relation"]
    assert f"Of the {tally['unperturbed']['items']} proved statements of unperturbed steps" in README
    assert f"{relation['same']} are labelled equivalent to the step (estimated {100 * share['same']:.1f}%)" in README
    assert f"{relation['less']} weaker ({100 * share['less']:.1f}%)" in README
    assert f"{relation['more']} stronger ({100 * share['more']:.1f}%)" in README
    assert f"{relation['different']} a different proposition ({100 * share['different']:.1f}%)" in README
    assert f"the relation labels agree for {agreement['relation']['count']}" in README
    assert f"equivalent-or-not distinction for {agreement['same_or_not']['count']}" in README
    assert f"Among the {agreement['mechanism']['of']} perturbed steps" in README
    assert f"agree for {agreement['wrong_claim_in_lean']['count']}, and the reasons for provability for {agreement['mechanism']['count']}" in README


def test_typesetting_check_figures():
    check = json.loads((ROOT / "results" / "step_math_check.json").read_text())
    assert check["different_characters"] == 0
    assert f"KaTeX {check['katex']}" in README
    assert f"{check['formulas']:,} formulas in {check['step_texts']:,} step texts" in README
    assert f"{check['from_plain_characters']:,} are converted from plain characters and {check['from_released_latex']:,} are LaTeX in the release" in README
    assert f"In {check['same_characters_superscript_written_before_subscript']}, KaTeX writes a superscript before a subscript" in README
    reasons = check["rejected_reasons"]
    assert sum(reasons.values()) == check["rejected_by_katex"]
    assert f"KaTeX rejects {check['rejected_by_katex']} formulas" in README
    assert f"{reasons['a character KaTeX does not accept']} contain a control character" in README
    assert f"{reasons['two subscripts or two superscripts on one base']} have two subscripts or two superscripts on one base" in README


def test_the_old_term_appears_only_as_the_papers_name():
    lines = [line for line in README.splitlines() if "silent" in line.lower()]
    assert len(lines) == 1 and "the paper's name for the failure" in lines[0]
