"""Command line: download the pinned data, compute the counts, write examples, run Lean."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd

from . import counts, data, examples, labels, lean, site


def _percent(cell: dict[str, int]) -> str:
    share = 100 * cell["count"] / cell["of"] if cell["of"] else 0.0
    return f"{cell['count']:,} of {cell['of']:,} ({share:.1f}%)"


def _print_counts(result: dict) -> None:
    print(f"rows: {result['rows']:,}")
    print("\nsteps whose text is not the same in every autoformaliser's row")
    for arm, cell in result["step_text_differs"].items():
        print(f"  {arm}: {_percent(cell)} {cell['groups'] or ''}")
    print("\nfalse positives (formal statements of perturbed steps that were proved)")
    for arm, cells in result["false_positives"].items():
        print(f"  {arm}: {_percent(cells['all'])}")
    print("\nintroduced number absent from the formal statement")
    for label, cells in result["introduced_number"].items():
        print(f"  {label}, both arms: {_percent(cells['both_arms'])}")
        for arm in counts.WRONG_ARMS:
            print(f"    {arm}: {_percent(cells[arm]['all'])}")
    print("\nlast number of the step absent from the formal statement")
    for arm, by_verdict in result["last_number_check"].items():
        for verdict, cells in by_verdict.items():
            print(f"  {arm}, {verdict}: {_percent(cells['all'])}")
    print("\nfalse positives whose formal statement is identical to the one for the unperturbed step")
    for arm, cells in result["identical_statement"].items():
        print(f"  {arm}: {_percent(cells['all'])}")
    print("\nproved statements whose proof text contains a derivation of False")
    for arm, cells in result["proof_through_false"].items():
        print(f"  {arm}: {_percent(cells['all'])}")


def main() -> None:
    parser = argparse.ArgumentParser(prog="faithformbench_reader", description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)

    fetch = commands.add_parser("download", help="fetch and verify the pinned data (147 MB)")
    fetch.add_argument("--data", type=Path, default=Path("data"))

    count = commands.add_parser("counts", help="compute every count in the README")
    count.add_argument("--data", type=Path, default=Path("data"))
    count.add_argument("--out", type=Path, default=Path("results/counts.json"))

    example = commands.add_parser("examples", help="write a seeded set of examples")
    example.add_argument("--data", type=Path, default=Path("data"))
    example.add_argument("--per-arm", type=int, default=6)
    example.add_argument("--out", type=Path, default=Path("results/examples.md"))

    sample = commands.add_parser("lean-sample", help="check a seeded sample in Lean (needs Lean and Mathlib)")
    sample.add_argument("--data", type=Path, default=Path("data"))
    sample.add_argument("--lean-project", type=Path, required=True, help="a Lake project with Mathlib built")
    sample.add_argument("--work", type=Path, default=Path("lean_work"))
    sample.add_argument("--per-group", type=int, default=240)
    sample.add_argument("--workers", type=int, default=3)
    sample.add_argument("--out", type=Path, default=Path("results/lean_sample.json"))

    reader = commands.add_parser("site", help="build the reader as a static site")
    reader.add_argument("--data", type=Path, default=Path("data"))
    reader.add_argument("--assets", type=Path, default=Path("reader"))
    reader.add_argument("--results", type=Path, default=Path("results"))
    reader.add_argument("--out", type=Path, default=Path("site"))

    packets = commands.add_parser("label-sample", help="write packets of proved statements for a language model to label")
    packets.add_argument("--data", type=Path, default=Path("data"))
    packets.add_argument("--work", type=Path, default=Path("results/label_packets"))
    packets.add_argument("--per-wrong-cell", type=int, default=60)
    packets.add_argument("--per-right-cell", type=int, default=80)
    packets.add_argument("--packet-size", type=int, default=100)
    packets.add_argument("--second-pass", type=int, default=120)

    answers = commands.add_parser("label-import", help="validate the returned labels and report the agreement of the two passes")
    answers.add_argument("--work", type=Path, default=Path("results/label_packets"))
    answers.add_argument("--first-model", default="first model", help="name of the model that labelled every item")
    answers.add_argument("--second-model", default="second model", help="name of the model that labelled the second-pass items")
    answers.add_argument("--counts", type=Path, default=Path("results/counts.json"))
    answers.add_argument("--out", type=Path, default=Path("results/ai_labels.json"))

    args = parser.parse_args()
    if args.command == "download":
        data.download(args.data)
        return
    if args.command == "site":
        rows = data.load(args.data, extra_columns=("depencies",))
        sizes = site.build(rows, args.out, args.assets, args.results)
        megabytes = (sizes["chain_bytes"] + sizes["index_bytes"] + sizes["overview_bytes"]) / 1e6
        print(f"wrote {args.out}: {sizes['chains']:,} reasoning chains, {megabytes:.1f} MB of data")
        return

    if args.command == "label-sample":
        rows = data.load(args.data, extra_columns=("dependencies_content",))
        sample = labels.draw(rows, args.per_wrong_cell, args.per_right_cell)
        written = labels.write_packets(sample, args.work, args.packet_size, args.second_pass)
        print(json.dumps(written, indent=1))
        return
    if args.command == "label-import":
        key = pd.read_csv(args.work / "key.csv")
        first: dict[str, dict] = {}
        for packet in sorted(args.work.glob("packet_[0-9]*.jsonl")):
            reply = args.work / packet.name.replace("packet_", "answers_")
            first.update(labels.read_answers(reply, labels.packet_ids(packet)))
        second_packet = args.work / "packet_second_pass.jsonl"
        second = labels.read_answers(args.work / "answers_second_pass.jsonl", labels.packet_ids(second_packet))
        named = key.set_index("item")
        proved = json.loads(args.counts.read_text())["proof_through_false"]
        population = {(arm, model): cell["of"] for arm, cells in proved.items() for model, cell in cells.items() if model != "all"}
        result = {
            "rubric": "docs/label_rubric.md",
            "models": {"first": args.first_model, "second": args.second_model},
            "items": len(first),
            "tally": labels.tally(first, key),
            "weighted_shares": labels.weighted(first, key, population),
            "agreement": labels.agreement(first, second),
            "labels": [
                {
                    "problem_id": named.loc[name, "problem_id"],
                    "node_id": named.loc[name, "node_id"],
                    "formaliser": named.loc[name, "autoformalizer_model"],
                    "arm": named.loc[name, "type_of_perturbation"],
                    **{field: answer[field] for field in labels.FIELDS if field != "id"},
                    **({"second_pass": {f: second[name][f] for f in labels.FIELDS if f != "id"}} if name in second else {}),
                }
                for name, answer in sorted(first.items())
            ],
        }
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(result, indent=1, ensure_ascii=False) + "\n")
        print(json.dumps({"items": result["items"], "weighted_shares": result["weighted_shares"], "agreement": result["agreement"]}, indent=1))
        return

    rows = data.load(args.data)
    if args.command == "counts":
        result = {"dataset": {"id": data.DATASET, "revision": data.REVISION}, **counts.all_counts(rows)}
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(result, indent=1) + "\n")
        _print_counts(result)
    elif args.command == "examples":
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(examples.to_markdown(examples.pick(rows, args.per_arm)))
        print(f"wrote {args.out}")
    elif args.command == "lean-sample":
        summary, per_row = lean.run(rows, args.lean_project, args.work, args.per_group, args.workers)
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(summary, indent=1) + "\n")
        per_row.to_csv(args.out.with_name(args.out.stem + "_rows.csv"), index=False)
        print(json.dumps(summary["groups"], indent=1))


if __name__ == "__main__":
    main()
