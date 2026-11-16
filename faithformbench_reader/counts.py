"""Every count in the README, computed from the released rows.

Terms follow the FaithformBench paper. A step is one line of a reasoning chain. Each
step appears in three versions: unperturbed, perturbed by a language model
(`brokenmath-style_llm`) and perturbed by a regular expression (`regex_perturbed`).
A false positive is a perturbed step whose formal statement the prover proved; the
paper's false positive rate counts these.
"""

from __future__ import annotations

import pandas as pd

from . import text

RIGHT = "unperturbed"
WRONG_ARMS = ("brokenmath-style_llm", "regex_perturbed")
ARMS = (RIGHT, *WRONG_ARMS)
PROVED = "Proved"
REFUTED = "Refuted"
STEP_KEY = ["problem_id", "node_id"]


def prepare(rows: pd.DataFrame) -> pd.DataFrame:
    """Add the text-derived columns the counts use.

    `statement` is the theorem the prover proved when the verdict is Proved, and
    otherwise the last theorem in the autoformaliser's output. `formaliser_statement`
    is always the latter, normalised, and is what the identical-statement count compares.
    """
    out = rows.copy()
    split = [text.split_declaration(lean) for lean in out.prover_output]
    proved = out.proof_result == PROVED
    from_formaliser = [text.statement_from_formaliser_output(o) for o in out.autoformalizer_output]
    out["statement"] = [
        pair[0] if is_proved and pair else fallback
        for pair, is_proved, fallback in zip(split, proved, from_formaliser)
    ]
    out["proof"] = [pair[1] if is_proved and pair else None for pair, is_proved in zip(split, proved)]
    out["formaliser_statement"] = [
        text.normalise_statement(s) if isinstance(s, str) else None for s in from_formaliser
    ]
    out["step_numbers"] = out.step_content.map(text.numbers)
    out["lean_numbers"] = [
        text.numbers(text.strip_comments(s)) if isinstance(s, str) else None for s in out.statement
    ]
    out["last_number"] = out.step_content.map(text.last_number)

    unperturbed_step = (
        out[out.type_of_perturbation == RIGHT]
        .drop_duplicates(STEP_KEY)
        .set_index(STEP_KEY)
        .step_numbers.to_dict()
    )
    out["introduced"] = [
        numbers - unperturbed_step.get((problem, node), set())
        for numbers, problem, node in zip(out.step_numbers, out.problem_id, out.node_id)
    ]
    return out


def _fraction(part: int, whole: int) -> dict[str, int]:
    return {"count": int(part), "of": int(whole)}


def verdicts(rows: pd.DataFrame) -> dict:
    table = rows.groupby(["type_of_perturbation", "proof_result"]).size()
    return {
        arm: {verdict: int(n) for verdict, n in table[arm].items()} for arm in ARMS
    }


def false_positives(rows: pd.DataFrame) -> dict:
    """Perturbed steps whose formal statement was proved, per perturbation and autoformaliser."""
    out: dict = {}
    for arm in WRONG_ARMS:
        in_arm = rows[rows.type_of_perturbation == arm]
        proved = in_arm[in_arm.proof_result == PROVED]
        out[arm] = {"all": _fraction(len(proved), len(in_arm))}
        for model, group in in_arm.groupby("autoformalizer_model"):
            out[arm][model] = _fraction((group.proof_result == PROVED).sum(), len(group))
    return out


def introduced_number(prepared: pd.DataFrame) -> dict:
    """Does a number introduced by the perturbation occur in the formal statement?

    Counted over perturbed steps that contain a number absent from the unperturbed step
    and whose formal statement could be extracted. `count` is the number of rows in
    which no introduced number occurs in the formal statement.
    """
    out: dict = {}
    usable = prepared[prepared.lean_numbers.notna() & prepared.introduced.map(bool)]
    for verdict, label in ((PROVED, "false_positive"), (REFUTED, "refuted_perturbed")):
        out[label] = {}
        both_absent = both_total = 0
        for arm in WRONG_ARMS:
            group = usable[(usable.type_of_perturbation == arm) & (usable.proof_result == verdict)]
            absent = [not (i & lean) for i, lean in zip(group.introduced, group.lean_numbers)]
            group = group.assign(absent=absent)
            out[label][arm] = {"all": _fraction(group.absent.sum(), len(group))}
            for model, by_model in group.groupby("autoformalizer_model"):
                out[label][arm][model] = _fraction(by_model.absent.sum(), len(by_model))
            both_absent += int(group.absent.sum())
            both_total += len(group)
        out[label]["both_arms"] = _fraction(both_absent, both_total)
    return out


def last_number_check(prepared: pd.DataFrame) -> dict:
    """Flag a formal statement when the last number in the step does not occur in it.

    Counted over rows whose step contains a number and whose formal statement could be
    extracted. The test takes only the step and the formal statement as input, so it can
    be applied without knowing whether the step was perturbed.
    """
    usable = prepared[prepared.lean_numbers.notna() & prepared.last_number.notna()]
    flagged = [last not in lean for last, lean in zip(usable.last_number, usable.lean_numbers)]
    usable = usable.assign(flagged=flagged)
    out: dict = {}
    for arm in ARMS:
        out[arm] = {}
        for verdict in (PROVED, REFUTED):
            group = usable[(usable.type_of_perturbation == arm) & (usable.proof_result == verdict)]
            out[arm][verdict] = {"all": _fraction(group.flagged.sum(), len(group))}
            for model, by_model in group.groupby("autoformalizer_model"):
                out[arm][verdict][model] = _fraction(by_model.flagged.sum(), len(by_model))
    return out


def identical_statement(prepared: pd.DataFrame) -> dict:
    """False positives whose formal statement equals the one for the unperturbed step.

    Compares the autoformaliser's statement for the perturbed step with its statement
    for the unperturbed step, after removing comments, the theorem name and whitespace.
    """
    right = prepared[prepared.type_of_perturbation == RIGHT].set_index(
        [*STEP_KEY, "autoformalizer_model"]
    ).formaliser_statement.to_dict()
    out: dict = {}
    for arm in WRONG_ARMS:
        group = prepared[(prepared.type_of_perturbation == arm) & (prepared.proof_result == PROVED)]
        same = [
            statement is not None and statement == right.get((problem, node, model))
            for statement, problem, node, model in zip(
                group.formaliser_statement, group.problem_id, group.node_id, group.autoformalizer_model
            )
        ]
        group = group.assign(same=same)
        out[arm] = {"all": _fraction(group.same.sum(), len(group))}
        for model, by_model in group.groupby("autoformalizer_model"):
            out[arm][model] = _fraction(by_model.same.sum(), len(by_model))
    return out


def proof_through_false(prepared: pd.DataFrame) -> dict:
    """Proved statements whose proof text mentions a step through `False`."""
    proved = prepared[prepared.proof_result == PROVED]
    signal = proved.proof.map(text.proof_goes_through_false)
    proved = proved.assign(signal=signal)
    out: dict = {}
    for arm in ARMS:
        group = proved[proved.type_of_perturbation == arm]
        out[arm] = {"all": _fraction(group.signal.sum(), len(group))}
        for model, by_model in group.groupby("autoformalizer_model"):
            out[arm][model] = _fraction(by_model.signal.sum(), len(by_model))
    return out


def step_text_differs(rows: pd.DataFrame) -> dict:
    """Steps whose released text is not the same in every autoformaliser's row.

    The release repeats the step text in each autoformaliser's row. For each version,
    `count` is the number of steps with more than one distinct text across those rows,
    and `groups` lists, for those steps, which autoformalisers' rows share a text.
    """
    out: dict[str, dict] = {}
    for arm in ARMS:
        steps = differing = 0
        groups: dict[str, int] = {}
        for _, step_rows in rows[rows.type_of_perturbation == arm].groupby(STEP_KEY, sort=False):
            steps += 1
            by_text: dict[str, list[str]] = {}
            for model, content in zip(step_rows.autoformalizer_model, step_rows.step_content):
                by_text.setdefault(content, []).append(model)
            if len(by_text) > 1:
                differing += 1
                name = " | ".join(sorted("+".join(sorted(models)) for models in by_text.values()))
                groups[name] = groups.get(name, 0) + 1
        out[arm] = {**_fraction(differing, steps), "groups": groups}
    return out


def all_counts(rows: pd.DataFrame) -> dict:
    prepared = prepare(rows)
    return {
        "rows": int(len(rows)),
        "step_text_differs": step_text_differs(rows),
        "verdicts": verdicts(rows),
        "false_positives": false_positives(rows),
        "introduced_number": introduced_number(prepared),
        "last_number_check": last_number_check(prepared),
        "identical_statement": identical_statement(prepared),
        "proof_through_false": proof_through_false(prepared),
    }
