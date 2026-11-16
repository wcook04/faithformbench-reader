# Comparing a step with its Lean statement: the rubric

This file is the text that was given to the language models, unchanged since the labels were produced. Its wording ("as written", "made wrong", "reader") is the wording the models received. The README and the website use the paper's terms for the same things: unperturbed, perturbed, and labelling pass.

Each item pairs one step of a worked solution with the Lean statement a formaliser wrote for it. A prover proved every statement in the sample. The reader says how the statement's claim stands to the step's claim.

## What an item holds

- `step`: the step exactly as the formaliser was given it.
- `version`: `as_written` when the step is the original, `made_wrong` when the benchmark's authors altered it so that it is false.
- `step_as_written`: for a `made_wrong` item, the original step, so the altered part can be seen.
- `earlier_steps`: when present, the earlier steps this one depends on. A statement may restate them as assumptions or definitions.
- `lean`: the Lean statement. Comments (after `--`) show what the formaliser intended and are not part of the statement.

## What to answer

One JSON object for each item, with these five fields.

**`relation`**: how the Lean statement's claim stands to the claim the `step` makes, as the step is given.

| Value | Meaning |
|---|---|
| `same` | The statement asserts what the step asserts. Restating earlier steps as assumptions, naming quantities, or writing a number another way (60% as `3/5`) does not change this. |
| `more` | The statement asserts the step's claim and something further, or the same claim from fewer assumptions. |
| `less` | The statement asserts only part of the step's claim or a weaker form: a value is left out, a specific result becomes "there exists", or the claim holds only because of assumptions the step does not make. |
| `different` | The statement asserts something the step does not say: another value, another relation, or another subject. |
| `cannot_tell` | The step or the statement is too unclear to compare. |

For a `made_wrong` item, compare with the wrong step as given. A statement that asserts the correct value where the wrong step asserts a wrong one is `different`.

**`wrong_claim_in_lean`**: for a `made_wrong` item, does the statement assert the altered part of the step? `yes`, `no` or `partly`. For an `as_written` item, `n/a`.

**`mechanism`**: for a `made_wrong` item, the single best description of why the statement could be proved although the step is wrong. For an `as_written` item, `n/a`.

| Value | Meaning |
|---|---|
| `right_value` | The statement states the correct value or relation in place of the wrong one. |
| `claim_dropped` | The altered part is left out; what remains is true. |
| `premises_cannot_hold` | The statement's assumptions contradict each other or can never be met, so any conclusion follows from them. |
| `assumed` | The wrong claim is taken as an assumption and then restated as the conclusion. |
| `tautology` | The conclusion is true by its form alone, such as `12 = 12`. |
| `number_system` | The statement is true only because of how the chosen number type behaves, such as natural-number subtraction or division rounding to zero. |
| `weakened` | A specific claim is replaced by a weaker one that is easy to satisfy, such as "there exist numbers such that". |
| `other_statement` | The statement is about something else. |
| `step_still_true` | The altered step is in fact still correct, or the statement states the altered step faithfully and it is true. |
| `unclear` | None of the above can be decided. |

When two descriptions fit, choose the one that explains why the proof goes through.

**`reason`**: one sentence of at most 40 words, naming the numbers or symbols that decide the answer.

**`id`**: the item's `id`, unchanged.

## Example answers

```json
{"id": "i0001", "relation": "different", "wrong_claim_in_lean": "no", "mechanism": "right_value", "reason": "The step says the sum is 5 miles; the statement proves 3 * 2 = 6."}
{"id": "i0002", "relation": "same", "wrong_claim_in_lean": "n/a", "mechanism": "n/a", "reason": "The statement computes 2 * 54 = 108, exactly the step's product."}
```

## Limits

The readers are language models. Their answers are a reading aid, shown with the share of items on which two readers agreed. They are not checked by Lean or by a person.
