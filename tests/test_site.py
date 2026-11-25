"""The reader's data, built from a small hand-made table whose answers are known."""

import json
from pathlib import Path

import pandas as pd

from faithformbench_reader import counts, site

from test_counts import LLM, REGEX, row


def table() -> pd.DataFrame:
    rows = [
        row(counts.RIGHT, "Proved", "O = 2 × 54 = 108.", "2 * 54 = 108"),
        row(LLM, "Proved", "O = 2 × 54 = 118.", "2 * 54 = 108"),
        row(REGEX, "Refuted", "O = 2 × 54 = 118.", "2 * 54 = 118"),
        row(counts.RIGHT, "Proved", "x = 7.", "(7 : ℕ) = 7", node="step_10"),
        row(
            LLM,
            "Proved",
            "x = 9.",
            "∀ x : ℕ, x + 1 = 0 → x = 9",
            proof="intro x h\n  exfalso\n  omega",
            node="step_10",
        ),
    ]
    frame = pd.DataFrame(rows)
    frame["depencies"] = ["[]", "[]", "[]", "['step_1']", "['step_1']"]
    return frame


def test_one_record_per_solution_with_steps_in_number_order():
    chains, index = site.chain_records(table())
    assert [chain["id"] for chain in chains] == ["p-1"]
    assert [step["id"] for step in chains[0]["steps"]] == ["step_1", "step_10"]
    assert chains[0]["steps"][1]["parents"] == ["step_1"]
    assert index[0]["steps"] == 2


def test_cells_carry_what_was_counted():
    chains, _ = site.chain_records(table())
    first, second = chains[0]["steps"]
    assert first["text"] == {"unperturbed": "O = 2 × 54 = 108.", "llm": "O = 2 × 54 = 118.", "regex": "O = 2 × 54 = 118."}
    assert "step" not in first["formalisers"]["goedel"]["regex"]
    false_positive = first["formalisers"]["goedel"]["llm"]
    assert false_positive["verdict"] == "Proved"
    assert false_positive["absent"] == ["118"] and false_positive["present"] == []
    assert false_positive["same"] is True
    kept = first["formalisers"]["goedel"]["regex"]
    assert kept["verdict"] == "Refuted" and kept["present"] == ["118"] and "same" not in kept
    assert first["formalisers"]["goedel"]["unperturbed"] == {"verdict": "Proved", "statement": "theorem t : 2 * 54 = 108"}
    assert second["formalisers"]["goedel"]["llm"]["through_false"] is True


def test_a_row_with_its_own_step_text_carries_that_text():
    # Three autoformalisers' rows share one regex-perturbed text; the fourth row has another.
    rows = [row(counts.RIGHT, "Proved", "O = 2 × 54 = 108.", "2 * 54 = 108", model=m) for m in site.FORMALISERS]
    rows += [row(REGEX, "Refuted", "O = 2 × 54 = 118.", "2 * 54 = 118", model=m) for m in site.FORMALISERS[:3]]
    rows += [row(REGEX, "Refuted", "O = 2 × 54 = 109.", "2 * 54 = 109", model="stepfun")]
    frame = pd.DataFrame(rows)
    frame["depencies"] = "[]"
    chains, _ = site.chain_records(frame)
    step = chains[0]["steps"][0]
    assert step["text"]["regex"] == "O = 2 × 54 = 118."
    assert step["formalisers"]["stepfun"]["regex"]["step"] == "O = 2 × 54 = 109."
    assert step["formalisers"]["stepfun"]["regex"]["present"] == ["109"]
    assert all("step" not in step["formalisers"][m]["regex"] for m in site.FORMALISERS[:3])
    differs = counts.step_text_differs(frame)
    assert differs[REGEX] == {"count": 1, "of": 1, "groups": {"goedel+herald+kimina | stepfun": 1}}
    assert differs[counts.RIGHT] == {"count": 0, "of": 1, "groups": {}}


def test_an_extraction_failure_has_no_statement():
    failed = row(LLM, "Refuted", "O = 2 × 54 = 118.", "2 * 54 = 118")
    failed["proof_result"] = "AF-Fail"
    failed["autoformalizer_output"] = "The theorem is that the product is 118."
    frame = pd.DataFrame([row(counts.RIGHT, "Proved", "O = 2 × 54 = 108.", "2 * 54 = 108"), failed])
    frame["depencies"] = "[]"
    chains, _ = site.chain_records(frame)
    assert chains[0]["steps"][0]["formalisers"]["goedel"]["llm"] == {"verdict": "AF-Fail", "statement": None}


def test_index_counts_false_positives_and_missing_numbers():
    _, index = site.chain_records(table())
    assert index[0]["false_positives"] == 2
    assert index[0]["perturbed"] == 3
    assert index[0]["missing"] == 1
    assert index[0]["opening"] == "O = 2 × 54 = 108."


def test_lean_sample_marks_only_the_rows_it_proved():
    rows = table()
    lean_rows = pd.DataFrame({"row": [1, 4], "F": ["sorry", "proved"]})
    chains, _ = site.chain_records(rows, lean_rows)
    first, second = chains[0]["steps"]
    assert "lean" not in first["formalisers"]["goedel"]["llm"]
    assert second["formalisers"]["goedel"]["llm"]["lean"] == "premises_cannot_hold"


def test_ai_labels_attach_to_their_statement_only():
    label = {
        "problem_id": "p-1",
        "node_id": "step_1",
        "formaliser": "goedel",
        "arm": LLM,
        "relation": "different",
        "wrong_claim_in_lean": "no",
        "mechanism": "right_value",
        "reason": "The step says 118; the statement says 108.",
        "second_pass": {"relation": "different", "wrong_claim_in_lean": "no", "mechanism": "right_value", "reason": "Same."},
    }
    chains, _ = site.chain_records(table(), ai=site.ai_labels_by_statement([label]))
    first = chains[0]["steps"][0]["formalisers"]["goedel"]
    assert first["llm"]["ai"] == {
        "relation": "different",
        "wrong_claim_in_lean": "no",
        "mechanism": "right_value",
        "reason": "The step says 118; the statement says 108.",
        "second": {"relation": "different", "mechanism": "right_value"},
    }
    assert "ai" not in first["unperturbed"] and "ai" not in first["regex"]


def test_small_parsers():
    assert site.step_number("step_12") == 12
    assert site.split_problem("olympiadbench-844") == ("olympiadbench", "844")
    heading = "# Examples\n\n## gsm8k-221 step_3, kimina, LLM-perturbed\n"
    assert site.featured_example(heading) == {
        "chain": "gsm8k-221",
        "step": "step_3",
        "formaliser": "kimina",
        "version": "llm",
    }
    assert site.featured_example("nothing here") is None


def test_built_chain_navigation_matches_the_public_index(tmp_path):
    rows = pd.concat(
        [table().assign(problem_id=id_) for id_ in ["math-10", "gsm8k-2", "math-9"]],
        ignore_index=True,
    )
    root = Path(__file__).resolve().parents[1]
    out = tmp_path / "site"
    site.build(rows, out, root / "reader", root / "results")

    def read(name):
        return json.loads((out / "data" / name).read_text())

    index = read("index.json")
    overview = read("overview.json")
    assert overview["chains"] == index["chains"]
    assert "cases" in index["ai"] and "cases" not in overview["ai"]
    assert overview["ai"]["items"] == index["ai"]["items"]
    assert read("chains/gsm8k-2.json")["navigation"]["previous"] is None
    assert read("chains/math-9.json")["navigation"] == {
        "previous": "gsm8k-2",
        "next": "math-10",
        "source_name": "MATH",
        "dataset_id": index["dataset"]["id"],
    }
    assert read("chains/math-10.json")["navigation"]["next"] is None
