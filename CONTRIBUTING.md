# Contributing

## Report a wrong count, note or label

Open an issue naming the reasoning chain, the step, the autoformaliser and the version (unperturbed, LLM-perturbed or regex-perturbed), with what the page or the README shows and what you expected. If you are an author of FaithformBench and want something here changed or removed, say so and it will be.

## Change the code

Data flows one way: the pinned release, then `faithformbench_reader/` (counts and the reader's data), then `reader/` (the page that displays that data). The page computes nothing except the typesetting and the marks on changed tokens.

From the repository root, with [uv](https://docs.astral.sh/uv/) and Node 20 or later:

```sh
uv sync --extra test
uv run pytest
node --test reader/lean-tokens.test.mjs reader/step-math.test.mjs
uv run python -m faithformbench_reader download
uv run python -m faithformbench_reader counts
uv run python -m faithformbench_reader site
node reader/step-math.check.mjs site --out results/step_math_check.json
```

A figure in the README must equal the figure in `results/`; `tests/test_readme_numbers.py` fails otherwise. A change to how step text is typeset must leave `different_characters` at 0 in `results/step_math_check.json`.

Look at any visual change in a browser at laptop and phone widths, in the day and night colours.
