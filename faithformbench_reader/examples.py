"""A seeded set of false positives in which the introduced number is absent from the formal statement."""

from __future__ import annotations

import pandas as pd

from . import counts

SEED = 20261116
MAX_STEP_CHARS = 220
MAX_STATEMENT_CHARS = 420
ARM_NAMES = {"brokenmath-style_llm": "LLM-perturbed", "regex_perturbed": "regex-perturbed"}


def pick(rows: pd.DataFrame, per_arm: int) -> pd.DataFrame:
    """Sample rows with short text, so each example fits a few lines. No row is hand-picked."""
    prepared = counts.prepare(rows)
    unperturbed_text = (
        prepared[prepared.type_of_perturbation == counts.RIGHT]
        .drop_duplicates(counts.STEP_KEY)
        .set_index(counts.STEP_KEY)
        .step_content.to_dict()
    )
    chosen = []
    for arm in counts.WRONG_ARMS:
        group = prepared[
            (prepared.type_of_perturbation == arm)
            & (prepared.proof_result == counts.PROVED)
            & prepared.lean_numbers.notna()
            & prepared.introduced.map(bool)
        ]
        absent = [not (i & lean) for i, lean in zip(group.introduced, group.lean_numbers)]
        group = group[absent]
        group = group[
            (group.statement.str.len() < MAX_STATEMENT_CHARS)
            & (group.step_content.str.len() < MAX_STEP_CHARS)
        ]
        chosen.append(group.sample(n=min(per_arm, len(group)), random_state=SEED))
    out = pd.concat(chosen)
    out["unperturbed_step"] = [unperturbed_text.get((p, n), "") for p, n in zip(out.problem_id, out.node_id)]
    return out


def to_markdown(picked: pd.DataFrame) -> str:
    lines = [
        "# Examples",
        "",
        "False positives in which the number introduced by the perturbation does not occur in",
        "the formal statement. The rows were sampled with a fixed seed from those whose step and",
        "statement are short; none was hand-picked. Regenerate with",
        "`python -m faithformbench_reader examples`.",
        "",
    ]
    for row in picked.itertuples():
        lines += [
            f"## {row.problem_id} {row.node_id}, {row.autoformalizer_model}, {ARM_NAMES[row.type_of_perturbation]}",
            "",
            f"- Unperturbed step: {row.unperturbed_step}",
            f"- Perturbed step: {row.step_content}",
            f"- Number introduced: {', '.join(sorted(row.introduced))}",
            "",
            "```lean",
            row.statement.strip(),
            "```",
            "",
        ]
    return "\n".join(lines)
