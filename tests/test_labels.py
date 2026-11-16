"""Drawing the sample for the language models and reading their labels back."""

import json

import pandas as pd
import pytest

from faithformbench_reader import counts, labels

from test_counts import LLM, row


def table() -> pd.DataFrame:
    rows = []
    for n in range(6):
        rows.append(row(counts.RIGHT, "Proved", f"x = {n}.", f"({n} : ℕ) = {n}", node=f"step_{n}"))
        rows.append(row(LLM, "Proved", f"x = {n + 10}.", f"({n} : ℕ) = {n}", node=f"step_{n}"))
    frame = pd.DataFrame(rows)
    frame["dependencies_content"] = "[]"
    return frame


def answer(name, **changes):
    base = {"id": name, "relation": "same", "wrong_claim_in_lean": "n/a", "mechanism": "n/a", "reason": "It restates the step."}
    return {**base, **changes}


def test_sample_is_seeded_and_hides_the_formaliser():
    first = labels.draw(table(), per_wrong_cell=3, per_right_cell=2)
    second = labels.draw(table(), per_wrong_cell=3, per_right_cell=2)
    assert list(first.row) == list(second.row)
    assert len(first) == 5
    shown = labels.item(next(first[first.is_perturbed].itertuples()))
    assert set(shown) == {"id", "version", "step", "step_as_written", "lean"}
    assert shown["version"] == "made_wrong"
    assert "goedel" not in json.dumps(shown)


def test_packets_and_key(tmp_path):
    sample = labels.draw(table(), per_wrong_cell=3, per_right_cell=2)
    written = labels.write_packets(sample, tmp_path, size=2, second_pass=3)
    assert written == {"items": 5, "packets": ["packet_01.jsonl", "packet_02.jsonl", "packet_03.jsonl"], "second_pass_items": 3}
    assert labels.packet_ids(tmp_path / "packet_01.jsonl") == {"i0001", "i0002"}
    assert labels.packet_ids(tmp_path / "packet_second_pass.jsonl") <= set(sample.item)
    assert list(pd.read_csv(tmp_path / "key.csv").item) == list(sample.item)


def test_answers_outside_the_rubric_are_refused(tmp_path):
    path = tmp_path / "answers.jsonl"
    path.write_text(json.dumps(answer("i0001")) + "\n")
    assert labels.read_answers(path, {"i0001"})["i0001"]["relation"] == "same"
    with pytest.raises(ValueError, match="unanswered"):
        labels.read_answers(path, {"i0001", "i0002"})
    for bad in (
        answer("i0001", relation="identical"),
        answer("i0001", mechanism="magic"),
        answer("i0001", wrong_claim_in_lean="maybe"),
        answer("i0001", reason=""),
        answer("i0001", reason="word " * 41),
    ):
        path.write_text(json.dumps(bad) + "\n")
        with pytest.raises(ValueError):
            labels.read_answers(path)
    path.write_text(json.dumps(answer("i0001")) + "\n" + json.dumps(answer("i0001")) + "\n")
    with pytest.raises(ValueError, match="twice"):
        labels.read_answers(path)


def test_agreement_counts_only_shared_items():
    first = {"a": answer("a"), "b": answer("b", relation="different", wrong_claim_in_lean="no", mechanism="right_value"), "c": answer("c")}
    second = {"a": answer("a"), "b": answer("b", relation="less", wrong_claim_in_lean="no", mechanism="claim_dropped")}
    result = labels.agreement(first, second)
    assert result["items"] == 2
    assert result["relation"] == {"count": 1, "of": 2}
    assert result["wrong_claim_in_lean"] == {"count": 1, "of": 1}
    assert result["mechanism"] == {"count": 0, "of": 1}
    assert result["same_or_not"] == {"count": 2, "of": 2}


def test_weighted_shares_follow_group_sizes():
    key = pd.DataFrame(
        {
            "item": ["a", "b", "c"],
            "type_of_perturbation": [LLM, LLM, LLM],
            "autoformalizer_model": ["goedel", "goedel", "kimina"],
        }
    )
    wrong = dict(wrong_claim_in_lean="no")
    answers = {
        "a": answer("a", relation="different", mechanism="right_value", **wrong),
        "b": answer("b", relation="different", mechanism="tautology", **wrong),
        "c": answer("c", relation="less", mechanism="tautology", **wrong),
    }
    # goedel has 300 proved statements and kimina 100, so goedel's two items carry 3/4.
    shares = labels.weighted(answers, key, {(LLM, "goedel"): 300, (LLM, "kimina"): 100})
    assert shares["perturbed"]["mechanism"] == {"tautology": 0.625, "right_value": 0.375}
    assert shares["perturbed"]["relation"] == {"different": 0.75, "less": 0.25}
    assert shares["unperturbed"] == {"relation": {}}


def test_tally_splits_unperturbed_steps_from_false_positives():
    key = pd.DataFrame({"item": ["a", "b"], "type_of_perturbation": [counts.RIGHT, LLM]})
    answers = {"a": answer("a"), "b": answer("b", relation="different", wrong_claim_in_lean="no", mechanism="right_value")}
    result = labels.tally(answers, key)
    assert result["unperturbed"] == {"relation": {"same": 1}, "items": 1}
    assert result["perturbed"]["mechanism"] == {"right_value": 1}
    assert result["perturbed"]["items"] == 1
