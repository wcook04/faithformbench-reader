"""Build the reader: each reasoning chain in the release with the formal statements for its steps.

The reader is a static site. This module writes its data (one file per reasoning chain
and its indexes) and copies the page, styles and script from `reader/`. The browser script
lays the data out and computes nothing else.
"""

from __future__ import annotations

import ast
import json
import re
import shutil
from pathlib import Path

import pandas as pd

from . import counts, data, text

SOURCES = {"gsm8k": "GSM8K", "math": "MATH", "olympiadbench": "OlympiadBench", "omnimath": "Omni-MATH"}
VERSIONS = {counts.RIGHT: "unperturbed", "brokenmath-style_llm": "llm", "regex_perturbed": "regex"}
FORMALISERS = ("goedel", "herald", "kimina", "stepfun")
# The release's verdict for an output from which the benchmark extracted no Lean statement.
EXTRACTION_FAILURE = "AF-Fail"
OPENING_CHARS = 150
_STEP_NUMBER = re.compile(r"(\d+)$")
_EXAMPLE_HEADING = re.compile(r"^## (\S+) (\S+), (\w+), (LLM|regex)-perturbed", re.M)


def step_number(node_id: str) -> int:
    found = _STEP_NUMBER.search(node_id)
    return int(found.group(1)) if found else 0


def split_problem(problem_id: str) -> tuple[str, str]:
    source, _, number = problem_id.rpartition("-")
    return source, number


def _parents(raw: object) -> list[str]:
    if not isinstance(raw, str):
        return []
    try:
        value = ast.literal_eval(raw)
    except (ValueError, SyntaxError):
        return []
    return [str(item) for item in value] if isinstance(value, (list, tuple)) else []


def _cell(row, right_statement: str | None, lean_checked: str | None, ai: dict | None = None) -> dict:
    """The data shown for one autoformaliser's formal statement of one version of a step."""
    statement = row.statement if isinstance(row.statement, str) else None
    if row.proof_result == EXTRACTION_FAILURE:
        # The benchmark extracted no Lean statement from this output, so none is shown.
        statement = None
    cell: dict = {"verdict": row.proof_result, "statement": statement}
    if ai:
        cell["ai"] = ai
    if not row.is_perturbed or statement is None:
        return cell
    readable = row.lean_numbers is not None and not isinstance(row.lean_numbers, float)
    if readable and row.introduced:
        cell["absent"] = sorted(n for n in row.introduced if n not in row.lean_numbers)
        cell["present"] = sorted(n for n in row.introduced if n in row.lean_numbers)
    if isinstance(row.formaliser_statement, str) and row.formaliser_statement == right_statement:
        cell["same"] = True
    if row.proof_result == counts.PROVED and text.proof_goes_through_false(row.proof):
        cell["through_false"] = True
    if lean_checked:
        cell["lean"] = lean_checked
    return cell


def _shared_texts(step_rows: pd.DataFrame) -> dict[str, str]:
    """For each version of one step, the step text that occurs in the most rows.

    Ties go to the text of the first autoformaliser in `FORMALISERS`.
    """
    order = {name: position for position, name in enumerate(FORMALISERS)}
    out: dict[str, str] = {}
    for arm, arm_rows in step_rows.groupby("type_of_perturbation", sort=False):
        tally: dict[str, list[int]] = {}
        for model, content in zip(arm_rows.autoformalizer_model, arm_rows.step_content):
            entry = tally.setdefault(content, [0, order.get(model, len(order))])
            entry[0] += 1
            entry[1] = min(entry[1], order.get(model, len(order)))
        out[VERSIONS[arm]] = min(tally, key=lambda content: (-tally[content][0], tally[content][1]))
    return out


def ai_labels_by_statement(labels: list[dict]) -> dict[tuple, dict]:
    """Language-model labels, keyed by reasoning chain, step, autoformaliser and perturbation."""
    out = {}
    for label in labels:
        entry = {key: label[key] for key in ("relation", "wrong_claim_in_lean", "mechanism", "reason")}
        if "second_pass" in label:
            entry["second"] = {key: label["second_pass"][key] for key in ("relation", "mechanism")}
        out[(label["problem_id"], label["node_id"], label["formaliser"], label["arm"])] = entry
    return out


def chain_records(
    rows: pd.DataFrame, lean_rows: pd.DataFrame | None = None, ai: dict[tuple, dict] | None = None
) -> tuple[list[dict], list[dict]]:
    """One record per reasoning chain, and the index entries that list them."""
    prepared = counts.prepare(rows)
    ai = ai or {}
    lean_checked: dict[int, str] = {}
    if lean_rows is not None:
        for row in lean_rows.itertuples():
            if row.F == "proved":
                lean_checked[int(row.row)] = "premises_cannot_hold"

    right_statement = prepared[prepared.type_of_perturbation == counts.RIGHT].set_index(
        ["problem_id", "node_id", "autoformalizer_model"]
    ).formaliser_statement.to_dict()

    chains: list[dict] = []
    index: list[dict] = []
    for problem_id, chain_rows in prepared.groupby("problem_id", sort=False):
        source, number = split_problem(problem_id)
        steps = []
        proved_perturbed = missing = perturbed = 0
        for node_id, step_rows in chain_rows.groupby("node_id", sort=False):
            # The release repeats the step text in each autoformaliser's row. For a
            # regex-perturbed step the text in one autoformaliser's row can differ from the
            # text in the others' rows, so `text` holds the most frequent text of each version
            # and a cell whose row has another text carries that text as `step`.
            texts = _shared_texts(step_rows)
            parents: list[str] = []
            formalisers: dict[str, dict] = {name: {} for name in FORMALISERS}
            for row in step_rows.itertuples():
                version = VERSIONS[row.type_of_perturbation]
                parents = parents or _parents(row.depencies)
                cell = _cell(
                    row,
                    right_statement.get((problem_id, node_id, row.autoformalizer_model)),
                    lean_checked.get(int(row.Index)),
                    ai.get((problem_id, node_id, row.autoformalizer_model, row.type_of_perturbation)),
                )
                if row.step_content != texts[version]:
                    cell["step"] = row.step_content
                formalisers[row.autoformalizer_model][version] = cell
                perturbed += bool(row.is_perturbed)
                if row.is_perturbed and row.proof_result == counts.PROVED:
                    proved_perturbed += 1
                    missing += bool(cell.get("absent")) and not cell.get("present")
            steps.append(
                {
                    "id": node_id,
                    "n": step_number(node_id),
                    "parents": parents,
                    "text": texts,
                    "formalisers": formalisers,
                }
            )
        steps.sort(key=lambda step: step["n"])
        chains.append({"id": problem_id, "source": source, "number": number, "steps": steps})
        opening = steps[0]["text"].get("unperturbed", "") if steps else ""
        if len(opening) > OPENING_CHARS:
            opening = opening[: OPENING_CHARS - 1].rstrip() + "…"
        index.append(
            {
                "id": problem_id,
                "source": source,
                "number": number,
                "steps": len(steps),
                "perturbed": int(perturbed),
                "false_positives": int(proved_perturbed),
                "missing": int(missing),
                "opening": opening,
            }
        )
    order = {name: position for position, name in enumerate(SOURCES)}
    index.sort(key=lambda entry: (order.get(entry["source"], 99), int(entry["number"]) if entry["number"].isdigit() else 0))
    return chains, index


def featured_example(examples_markdown: str) -> dict | None:
    """The first seeded example, which the front page's "Open an example" link opens."""
    found = _EXAMPLE_HEADING.search(examples_markdown)
    if not found:
        return None
    chain, step, formaliser, how = found.groups()
    return {"chain": chain, "step": step, "formaliser": formaliser, "version": how.lower()}


def build(rows: pd.DataFrame, out: Path, assets: Path, results: Path) -> dict:
    """Write the site under `out` and return its sizes."""
    lean_path = results / "lean_sample_rows.csv"
    lean_rows = pd.read_csv(lean_path) if lean_path.is_file() else None
    labels_path = results / "ai_labels.json"
    labelled = json.loads(labels_path.read_text()) if labels_path.is_file() else None
    chains, index = chain_records(rows, lean_rows, ai_labels_by_statement(labelled["labels"]) if labelled else None)

    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(assets, out, ignore=shutil.ignore_patterns("*.test.mjs", "*.check.mjs", "step-math-compare.mjs"))
    chain_dir = out / "data" / "chains"
    chain_dir.mkdir(parents=True)
    dataset = {"id": data.DATASET, "revision": data.REVISION}
    neighbors = {
        row["id"]: {
            "previous": index[i - 1]["id"] if i else None,
            "next": index[i + 1]["id"] if i + 1 < len(index) else None,
        }
        for i, row in enumerate(index)
    }
    total = 0
    for chain in chains:
        navigation = {
            **neighbors[chain["id"]],
            "source_name": SOURCES.get(chain["source"], chain["source"]),
            "dataset_id": dataset["id"],
        }
        payload = json.dumps({**chain, "navigation": navigation}, ensure_ascii=False, separators=(",", ":"))
        (chain_dir / f"{chain['id']}.json").write_text(payload)
        total += len(payload.encode())

    summary = json.loads((results / "counts.json").read_text())
    examples = results / "examples.md"
    front = {
        "dataset": dataset,
        "sources": SOURCES,
        "rows": summary["rows"],
        "false_positives": {arm: cells["all"]["count"] for arm, cells in summary["false_positives"].items()},
        "introduced_number": {
            label: cells["both_arms"] for label, cells in summary["introduced_number"].items()
        },
        "featured": featured_example(examples.read_text()) if examples.is_file() else None,
        "step_text_differs": summary.get("step_text_differs"),
        "chains": index,
    }
    if labelled:
        front["ai"] = {
            "items": labelled["items"],
            "models": labelled["models"],
            "agreement": labelled["agreement"],
            "tally": labelled["tally"],
            "cases": [
                {
                    "chain": label["problem_id"],
                    "step": label["node_id"],
                    "formaliser": label["formaliser"],
                    "version": VERSIONS[label["arm"]],
                    "relation": label["relation"],
                    "mechanism": label["mechanism"],
                    "reason": label["reason"],
                }
                for label in labelled["labels"]
            ],
        }
    index_payload = json.dumps(front, ensure_ascii=False, separators=(",", ":"))
    (out / "data" / "index.json").write_text(index_payload)
    # Only the labels page needs the individual cases. Keep the full public index
    # available, and give the catalogue and about page a lighter view of it.
    if labelled:
        front["ai"] = {key: value for key, value in front["ai"].items() if key != "cases"}
    overview_payload = json.dumps(front, ensure_ascii=False, separators=(",", ":"))
    (out / "data" / "overview.json").write_text(overview_payload)
    return {
        "chains": len(chains),
        "chain_bytes": total,
        "index_bytes": len(index_payload.encode()),
        "overview_bytes": len(overview_payload.encode()),
    }
