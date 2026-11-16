"""A seeded sample of proved formal statements, labelled by language models.

The counts in this repository come from a program that compares text. A text comparison
cannot classify how a formal statement relates to its step. For that, a sample of proved
statements is given to a language model with a written rubric, and a second model labels
part of the same sample without access to the first labels, so the agreement between the
two sets of labels can be reported with them.

This module draws the sample, writes it as packets with opaque item names, and reads the
models' output back, rejecting any label outside the rubric.

The packet fields and label values (`as_written`, `made_wrong`, `right_value` and the
rest) are the words of the rubric the models were given, and are kept as they were used.
"""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

from . import counts, text

SEED = 20261116
RELATIONS = ("same", "more", "less", "different", "cannot_tell")
WRONG_CLAIM = ("yes", "no", "partly", "n/a")
MECHANISMS = (
    "right_value",
    "claim_dropped",
    "premises_cannot_hold",
    "assumed",
    "tautology",
    "number_system",
    "weakened",
    "other_statement",
    "step_still_true",
    "unclear",
    "n/a",
)
FIELDS = ("id", "relation", "wrong_claim_in_lean", "mechanism", "reason")
MAX_REASON_WORDS = 40


def draw(rows: pd.DataFrame, per_wrong_cell: int, per_right_cell: int) -> pd.DataFrame:
    """Proved statements, sampled evenly over autoformalisers and versions, in a seeded order."""
    proved = rows[rows.proof_result == counts.PROVED].copy()
    split = [text.split_declaration(lean) for lean in proved.prover_output]
    proved["lean"] = [pair[0] if pair else None for pair in split]
    proved = proved[proved.lean.notna()]
    right_text = (
        rows[rows.type_of_perturbation == counts.RIGHT]
        .drop_duplicates(counts.STEP_KEY)
        .set_index(counts.STEP_KEY)
        .step_content.to_dict()
    )
    picked = []
    for (arm, _model), group in proved.groupby(["type_of_perturbation", "autoformalizer_model"]):
        size = per_right_cell if arm == counts.RIGHT else per_wrong_cell
        picked.append(group.sample(n=min(size, len(group)), random_state=SEED))
    sample = pd.concat(picked).sample(frac=1.0, random_state=SEED).reset_index().rename(columns={"index": "row"})
    sample["item"] = [f"i{n:04d}" for n in range(1, len(sample) + 1)]
    sample["step_as_written"] = [right_text.get((p, n), "") for p, n in zip(sample.problem_id, sample.node_id)]
    return sample


def item(row) -> dict:
    """One item as given to a model: no autoformaliser name and no problem name."""
    wrong = bool(row.is_perturbed)
    out = {
        "id": row.item,
        "version": "made_wrong" if wrong else "as_written",
        "step": row.step_content,
    }
    if wrong:
        out["step_as_written"] = row.step_as_written
    earlier = getattr(row, "dependencies_content", None)
    if isinstance(earlier, str) and earlier.strip() not in ("", "[]"):
        out["earlier_steps"] = earlier
    out["lean"] = row.lean
    return out


def write_packets(sample: pd.DataFrame, work: Path, size: int, second_pass: int) -> dict:
    """Write the first-pass packets, one second-pass packet, and the key that names each item."""
    work.mkdir(parents=True, exist_ok=True)
    items = [item(row) for row in sample.itertuples()]
    names = []
    for start in range(0, len(items), size):
        path = work / f"packet_{start // size + 1:02d}.jsonl"
        path.write_text("".join(json.dumps(entry, ensure_ascii=False) + "\n" for entry in items[start : start + size]))
        names.append(path.name)
    # The second pass covers a seeded subset of the same items, in a different order.
    again = sample.sample(n=min(second_pass, len(sample)), random_state=SEED + 1)
    second = work / "packet_second_pass.jsonl"
    second.write_text("".join(json.dumps(item(row), ensure_ascii=False) + "\n" for row in again.itertuples()))
    key = sample[["item", "row", "problem_id", "node_id", "autoformalizer_model", "type_of_perturbation"]]
    key.to_csv(work / "key.csv", index=False)
    return {"items": len(items), "packets": names, "second_pass_items": int(len(again))}


def read_answers(path: Path, expected: set[str] | None = None) -> dict[str, dict]:
    """The labels in one returned file, keyed by item. Raises on any value outside the rubric."""
    answers: dict[str, dict] = {}
    for number, line in enumerate(path.read_text().splitlines(), start=1):
        if not line.strip():
            continue
        entry = json.loads(line)
        where = f"{path.name} line {number}"
        missing = [field for field in FIELDS if field not in entry]
        if missing:
            raise ValueError(f"{where}: missing {missing}")
        if entry["relation"] not in RELATIONS:
            raise ValueError(f"{where}: relation {entry['relation']!r}")
        if entry["wrong_claim_in_lean"] not in WRONG_CLAIM:
            raise ValueError(f"{where}: wrong_claim_in_lean {entry['wrong_claim_in_lean']!r}")
        if entry["mechanism"] not in MECHANISMS:
            raise ValueError(f"{where}: mechanism {entry['mechanism']!r}")
        reason = str(entry["reason"]).strip()
        if not reason or len(reason.split()) > MAX_REASON_WORDS:
            raise ValueError(f"{where}: reason must be 1 to {MAX_REASON_WORDS} words")
        if entry["id"] in answers:
            raise ValueError(f"{where}: {entry['id']} answered twice")
        answers[entry["id"]] = {field: entry[field] for field in FIELDS}
    if expected is not None:
        extra, absent = set(answers) - expected, expected - set(answers)
        if extra or absent:
            raise ValueError(f"{path.name}: {len(absent)} items unanswered, {len(extra)} unknown items")
    return answers


def packet_ids(path: Path) -> set[str]:
    return {json.loads(line)["id"] for line in path.read_text().splitlines() if line.strip()}


def agreement(first: dict[str, dict], second: dict[str, dict]) -> dict:
    """On the items labelled in both passes, the number given the same label in each field."""
    shared = sorted(set(first) & set(second))
    out = {"items": len(shared)}
    for field in ("relation", "wrong_claim_in_lean", "mechanism"):
        relevant = [i for i in shared if first[i][field] != "n/a" or second[i][field] != "n/a"]
        same = sum(first[i][field] == second[i][field] for i in relevant)
        out[field] = {"count": same, "of": len(relevant)}
    faithful = lambda answer: answer["relation"] == "same"  # noqa: E731
    out["same_or_not"] = {"count": sum(faithful(first[i]) == faithful(second[i]) for i in shared), "of": len(shared)}
    return out


def weighted(answers: dict[str, dict], key: pd.DataFrame, population: dict[tuple[str, str], int]) -> dict:
    """Shares of each answer among all proved statements, estimated from the sample.

    The sample takes the same number of statements from every autoformaliser and arm, but
    those groups differ in size in the release. Each group's sample shares are therefore
    weighted by `population[(arm, formaliser)]`, the group's number of proved statements.
    """
    named = key.set_index("item")
    sides = {
        "unperturbed": ("relation",),
        "perturbed": ("relation", "wrong_claim_in_lean", "mechanism"),
    }
    out: dict = {}
    for side, fields in sides.items():
        cells: dict[tuple[str, str], list[dict]] = {}
        for name, answer in answers.items():
            arm = named.loc[name, "type_of_perturbation"]
            if (arm == counts.RIGHT) != (side == "unperturbed"):
                continue
            cells.setdefault((arm, named.loc[name, "autoformalizer_model"]), []).append(answer)
        total = sum(population[cell] for cell in cells)
        out[side] = {}
        for field in fields:
            shares: dict[str, float] = {}
            for cell, group in cells.items():
                for answer in group:
                    shares[answer[field]] = shares.get(answer[field], 0.0) + population[cell] / len(group) / total
            out[side][field] = {value: round(share, 4) for value, share in sorted(shares.items(), key=lambda kv: -kv[1])}
    return out


def tally(answers: dict[str, dict], key: pd.DataFrame) -> dict:
    """Counts of each label, for unperturbed steps and for false positives."""
    arm = key.set_index("item").type_of_perturbation.to_dict()
    out: dict = {"unperturbed": {"relation": {}}, "perturbed": {"relation": {}, "wrong_claim_in_lean": {}, "mechanism": {}}}
    for name, answer in answers.items():
        side = "unperturbed" if arm[name] == counts.RIGHT else "perturbed"
        for field in out[side]:
            out[side][field][answer[field]] = out[side][field].get(answer[field], 0) + 1
    for side in out:
        out[side]["items"] = sum(out[side]["relation"].values())
    return out
