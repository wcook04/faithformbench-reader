"""Reading numbers, statements and proofs out of the released text.

Everything here is plain text handling. Nothing is parsed by Lean, so a number written
two ways (60% in a step, 3/5 in Lean) is treated as two different numbers.
"""

from __future__ import annotations

import re

# Where a statement ends and its proof begins. Some formalisers write two spaces here.
_PROOF_START = re.compile(r":=\s*by\b")

# A number standing on its own: digits with an optional decimal part, not glued to a
# letter, an identifier or a longer number.
_NUMBER = re.compile(r"(?<![\w.])\d+(?:\.\d+)?(?![\w]|\.\d)")
_LINE_COMMENT = re.compile(r"--.*?$", re.M)
_BLOCK_COMMENT = re.compile(r"/-.*?-/", re.S)
_CODE_BLOCK = re.compile(r"```lean4?\s*(.*?)```", re.S)
_DECLARATION_NAME = re.compile(r"^(theorem|lemma)\s+\S+")
_WHITESPACE = re.compile(r"\s+")
_THROUGH_FALSE = re.compile(r"\bexfalso\b|False\.elim|\babsurd\b|:\s*False\s*:=")


def normalise_number(token: str) -> str:
    """Write a number one way: no leading zeros, no trailing zero decimals."""
    if "." in token:
        token = token.rstrip("0").rstrip(".")
    token = token.lstrip("0") or "0"
    return "0" + token if token.startswith(".") else token


def numbers(text: str | None) -> set[str]:
    """The set of numbers written in `text`."""
    return {normalise_number(token) for token in _NUMBER.findall(text or "")}


def last_number(text: str | None) -> str | None:
    """The last number written in `text`, or None when it has none."""
    found = _NUMBER.findall(text or "")
    return normalise_number(found[-1]) if found else None


def strip_comments(lean: str) -> str:
    return _LINE_COMMENT.sub("", _BLOCK_COMMENT.sub("", lean))


def split_declaration(lean: str | None) -> tuple[str, str] | None:
    """Split `theorem ... := by <proof>` into its statement and its proof.

    Returns None when the text does not start with a theorem or has no proof marker.
    Block comments are removed first; line comments stay in the proof.
    """
    if not isinstance(lean, str) or not lean.lstrip().startswith(("theorem", "lemma")):
        return None
    parts = _PROOF_START.split(_BLOCK_COMMENT.sub("", lean), maxsplit=1)
    if len(parts) < 2:
        return None
    return parts[0].rstrip(), parts[1]


def statement_from_formaliser_output(output: str | None) -> str | None:
    """The last theorem statement in an autoformaliser's raw output, up to its proof marker."""
    if not isinstance(output, str):
        return None
    blocks = _CODE_BLOCK.findall(output)
    text = blocks[-1] if blocks else output
    start = max(text.rfind("theorem "), text.rfind("lemma "))
    if start < 0:
        return None
    return _PROOF_START.split(_BLOCK_COMMENT.sub("", text[start:]), maxsplit=1)[0].rstrip()


def normalise_statement(statement: str) -> str:
    """A statement with comments removed, its name replaced and whitespace collapsed."""
    text = _LINE_COMMENT.sub("", statement).strip()
    text = _DECLARATION_NAME.sub("theorem T", text)
    return _WHITESPACE.sub(" ", text).strip()


def rename_declaration(statement: str, name: str) -> str:
    return _DECLARATION_NAME.sub(f"theorem {name}", statement.strip(), count=1)


def proof_goes_through_false(proof: str | None) -> bool:
    """Whether a proof's text mentions a step through `False`.

    A textual signal only: `exfalso`, `False.elim`, `absurd`, or a `have ... : False :=`.
    It also fires on a legitimate case split, so it is confirmed separately in Lean.
    """
    return isinstance(proof, str) and bool(_THROUGH_FALSE.search(proof))
