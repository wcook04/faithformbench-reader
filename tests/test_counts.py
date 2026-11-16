"""The counts on a small hand-built table whose answers are known."""

import pandas as pd

from faithformbench_reader import counts, lean


def row(arm, verdict, step, statement, proof="norm_num", model="goedel", node="step_1"):
    perturbed = arm != counts.RIGHT
    if verdict == "Proved":
        prover = f"theorem t : {statement} := by\n  {proof}"
    else:
        prover = f"theorem not_t : ¬ ({statement}) := by\n  norm_num"
    return {
        "step_content": step,
        "is_perturbed": perturbed,
        "type_of_perturbation": arm,
        "problem_id": "p-1",
        "node_id": node,
        "autoformalizer_model": model,
        "autoformalizer_output": f"```lean4\ntheorem t : {statement} := by sorry\n```",
        "prover_output": prover,
        "proof_result": verdict,
    }


LLM = "brokenmath-style_llm"
REGEX = "regex_perturbed"


def table():
    return pd.DataFrame(
        [
            # step_1: the unperturbed step, then two perturbed versions that introduce 118.
            row(counts.RIGHT, "Proved", "O = 2 × 54 = 108.", "2 * 54 = 108"),
            # false positive: the formal statement contains 108, so 118 is absent from it.
            row(LLM, "Proved", "O = 2 × 54 = 118.", "2 * 54 = 108"),
            # refuted: the formal statement contains 118 and the prover proved its negation.
            row(REGEX, "Refuted", "O = 2 × 54 = 118.", "2 * 54 = 118"),
            # step_2: a perturbed step whose proof text derives False; the introduced number is in the statement.
            row(counts.RIGHT, "Proved", "x = 7.", "(7 : ℕ) = 7", node="step_2"),
            row(
                LLM,
                "Proved",
                "x = 9.",
                "∀ x : ℕ, x + 1 = 0 → x = 9",
                proof="intro x h\n  exfalso\n  omega",
                node="step_2",
            ),
        ]
    )


def test_false_positives_per_arm():
    result = counts.false_positives(table())
    assert result[LLM]["all"] == {"count": 2, "of": 2}
    assert result[REGEX]["all"] == {"count": 0, "of": 1}


def test_introduced_number():
    result = counts.introduced_number(counts.prepare(table()))
    # two false positives introduce a number (118 and 9); only 118 is absent from the Lean
    assert result["false_positive"][LLM]["all"] == {"count": 1, "of": 2}
    assert result["refuted_perturbed"][REGEX]["all"] == {"count": 0, "of": 1}
    assert result["false_positive"]["both_arms"] == {"count": 1, "of": 2}


def test_last_number_check_flags_only_the_missing_value():
    result = counts.last_number_check(counts.prepare(table()))
    assert result[counts.RIGHT]["Proved"]["all"] == {"count": 0, "of": 2}
    assert result[LLM]["Proved"]["all"] == {"count": 1, "of": 2}
    assert result[REGEX]["Refuted"]["all"] == {"count": 0, "of": 1}


def test_identical_statement():
    result = counts.identical_statement(counts.prepare(table()))
    assert result[LLM]["all"] == {"count": 1, "of": 2}


def test_proof_through_false():
    result = counts.proof_through_false(counts.prepare(table()))
    assert result[LLM]["all"] == {"count": 1, "of": 2}
    assert result[counts.RIGHT]["all"] == {"count": 0, "of": 2}


def test_lean_sample_is_seeded_and_names_each_check():
    sample_a, population = lean.draw_sample(table(), per_group=4)
    sample_b, _ = lean.draw_sample(table(), per_group=4)
    assert list(sample_a.row) == list(sample_b.row)
    assert population == {
        "unperturbed_step|unflagged": 2,
        "false_positive|flagged": 1,
        "false_positive|unflagged": 1,
    }
    source = lean.lean_file(sample_a)
    for sid in sample_a.sid:
        for check in "SFA":
            assert f"theorem c{sid}_{check} " in source
            assert f"#print axioms c{sid}_{check}" in source


def test_parse_log_reads_axiom_reports():
    log = (
        "'c0_S' depends on axioms: [sorryAx]\n"
        "'c0_F' depends on axioms: [propext, Classical.choice]\n"
        "'c0_A' does not depend on any axioms\n"
    )
    assert lean.parse_log(log) == {"c0_S": "sorry", "c0_F": "proved", "c0_A": "proved"}
