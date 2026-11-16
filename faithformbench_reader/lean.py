"""Run three Lean tests on a seeded sample of proved formal statements.

Each sampled statement is given to Lean unchanged, with a fixed list of tactics and no
model or prover:

  S  control: the statement elaborates in this environment (proof left as `sorry`)
  F  Lean proves the statement with its conclusion replaced by `False`
     (`intros; exfalso; ...`). If so, its hypotheses are unsatisfiable, and any
     conclusion follows from them.
  A  the conclusion is identical to one of the hypotheses (`intros; assumption`)

A test counts as passed only when `#print axioms` lists the declaration without
`sorryAx`. Fixed tactics find fewer proofs than a prover, so the F and A counts are
lower bounds.

The sample is drawn separately from statements whose proof text contains a derivation
of `False` (flagged) and from those whose proof text does not (unflagged), for false
positives and for unperturbed steps.
"""

from __future__ import annotations

import concurrent.futures
import json
import os
import re
import subprocess
from pathlib import Path

import pandas as pd

from . import text

SEED = 20261116
PER_FILE = 20
FILE_TIMEOUT_SECONDS = 600

HEADER = """import Mathlib
import Aesop

set_option maxHeartbeats 400000

open BigOperators Real Nat Topology Rat

"""
TACTICS = {
    "S": "sorry",
    "F": """first
    | (intros; exfalso; omega)
    | (intros; exfalso; norm_num at *; done)
    | (intros; exfalso; simp_all; done)
    | (intros; exfalso; linarith)
    | (intros; exfalso; norm_num at * <;> omega)
    | (intros; exfalso; norm_num at * <;> linarith)
    | sorry""",
    "A": """first
    | (intros; assumption)
    | sorry""",
}
_DEPENDS = re.compile(r"'(c\d+_[SFA])' depends on axioms: \[(.*?)\]", re.S)
_NO_AXIOMS = re.compile(r"'(c\d+_[SFA])' does not depend on any axioms")
_TIMEOUT_MARK = "FILE_TIMEOUT"


def draw_sample(rows: pd.DataFrame, per_group: int) -> tuple[pd.DataFrame, dict[str, int]]:
    """A seeded sample of proved statements and the size of each group it was drawn from."""
    proved = rows[rows.proof_result == "Proved"].copy()
    split = [text.split_declaration(lean) for lean in proved.prover_output]
    proved["stmt"] = [pair[0] if pair else None for pair in split]
    proved["flag"] = [text.proof_goes_through_false(pair[1]) if pair else False for pair in split]
    proved = proved[proved.stmt.notna()]
    proved["side"] = proved.is_perturbed.map({True: "false_positive", False: "unperturbed_step"})

    # A fixed group order, so that renaming a group cannot change which batch a statement is in.
    groups = []
    for side in ("unperturbed_step", "false_positive"):
        for flag in (False, True):
            group = proved[(proved.side == side) & (proved.flag == flag)]
            if group.empty:
                continue
            size = per_group if side == "false_positive" else per_group // 2
            groups.append(group.sample(n=min(size, len(group)), random_state=SEED))
    sample = (
        pd.concat(groups)
        .sample(frac=1.0, random_state=SEED)
        .reset_index()
        .rename(columns={"index": "row"})
    )
    sample["sid"] = range(len(sample))
    population = {
        f"{side}|{'flagged' if flag else 'unflagged'}": int(n)
        for (side, flag), n in proved.groupby(["side", "flag"]).size().items()
    }
    return sample, population


def lean_file(chunk: pd.DataFrame) -> str:
    parts = [HEADER]
    for row in chunk.itertuples():
        for check, tactic in TACTICS.items():
            name = f"c{row.sid}_{check}"
            head = text.rename_declaration(row.stmt, name)
            parts.append(
                f"set_option maxHeartbeats 20000 in\n{head} := by\n  {tactic}\n\n#print axioms {name}\n\n"
            )
    return "".join(parts)


def parse_log(log: str) -> dict[str, str]:
    """Map each declaration Lean reported on to `proved` or `sorry`."""
    results = {}
    for name, axioms in _DEPENDS.findall(log):
        results[name] = "sorry" if "sorryAx" in axioms else "proved"
    for name in _NO_AXIOMS.findall(log):
        results[name] = "proved"
    return results


def _environment(lean_project: Path) -> tuple[dict[str, str], str, dict[str, str]]:
    def lake(*args: str) -> str:
        done = subprocess.run(
            ["lake", "env", *args], cwd=lean_project, capture_output=True, text=True, check=True
        )
        return done.stdout.strip()

    env = dict(os.environ)
    env["LEAN_PATH"] = lake("printenv", "LEAN_PATH")
    lean_bin = lake("which", "lean")
    version = subprocess.run([lean_bin, "--version"], capture_output=True, text=True).stdout.strip()
    described = {"lean": version}
    manifest = lean_project / "lake-manifest.json"
    if manifest.is_file():
        for package in json.loads(manifest.read_text())["packages"]:
            if package["name"] == "mathlib":
                described["mathlib_rev"] = package.get("rev", "")
    return env, lean_bin, described


def run(rows: pd.DataFrame, lean_project: Path, work: Path, per_group: int, workers: int) -> tuple[dict, pd.DataFrame]:
    """Write the Lean files under `work`, check them, and summarise.

    A batch whose file and log already exist under `work` with identical contents is
    read back and not rerun, so an interrupted run can be resumed.
    """
    sample, population = draw_sample(rows, per_group)
    env, lean_bin, described = _environment(lean_project)
    work.mkdir(parents=True, exist_ok=True)

    paths = []
    fresh = set()
    for start in range(0, len(sample), PER_FILE):
        path = work / f"batch_{start // PER_FILE:04d}.lean"
        content = lean_file(sample.iloc[start : start + PER_FILE])
        if not path.is_file() or path.read_text() != content:
            path.write_text(content)
            fresh.add(path)
        paths.append(path)

    def check(path: Path) -> dict[str, str]:
        log_path = path.with_suffix(".lean.log")
        if path not in fresh and log_path.is_file():
            log = log_path.read_text()
            if log.strip() and _TIMEOUT_MARK not in log:
                return parse_log(log)
        try:
            done = subprocess.run(
                [lean_bin, str(path.resolve())],
                cwd=lean_project,
                env=env,
                capture_output=True,
                text=True,
                timeout=FILE_TIMEOUT_SECONDS,
            )
            log = done.stdout + done.stderr
        except subprocess.TimeoutExpired as expired:
            raw = expired.stdout or ""
            log = (raw.decode("utf8", "replace") if isinstance(raw, bytes) else raw) + "\n" + _TIMEOUT_MARK
        log_path.write_text(log)
        return parse_log(log)

    results: dict[str, str] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        for done, found in enumerate(pool.map(check, paths), start=1):
            results.update(found)
            print(f"batches checked {done}/{len(paths)}", flush=True)

    for check_name in TACTICS:
        sample[check_name] = [results.get(f"c{sid}_{check_name}", "missing") for sid in sample.sid]
    elaborated = sample[sample.S != "missing"]
    summary = {
        "environment": described,
        "design": {"seed": SEED, "per_group": per_group, "tactics": TACTICS},
        "population_proved_statements": population,
        "sampled": int(len(sample)),
        "elaborated": int(len(elaborated)),
        "groups": {},
    }
    for (side, flag), group in elaborated.groupby(["side", "flag"]):
        summary["groups"][f"{side}|{'flagged' if flag else 'unflagged'}"] = {
            "n": int(len(group)),
            "premises_cannot_hold": int((group.F == "proved").sum()),
            "conclusion_is_a_premise": int((group.A == "proved").sum()),
        }
    columns = ["sid", "row", "side", "flag", "problem_id", "node_id", "autoformalizer_model", "type_of_perturbation", "S", "F", "A"]
    return summary, sample[columns]
