"""The released results this repository reads, pinned to one revision."""

from __future__ import annotations

import hashlib
import urllib.request
from pathlib import Path

import pandas as pd

DATASET = "ighina/Faithform-AF"
REVISION = "86b7061b73580c6694f593ded9f7fbbc1d07083e"
URL = "https://huggingface.co/datasets/{dataset}/resolve/{revision}/data/{name}"

# File name -> (SHA-256, size in bytes) at the pinned revision.
FILES: dict[str, tuple[str, int]] = {
    "test-00000-of-00004.parquet": (
        "234b4ce3999fc47234da4750b806924b6a9eb42337fde37198fba50efa2a2f71",
        36629624,
    ),
    "test-00001-of-00004.parquet": (
        "9814afc2d77782a793ccd8b4d344e1d31c3e29f806fa9ae8a90d863781aa3a53",
        36607992,
    ),
    "test-00002-of-00004.parquet": (
        "84d7053dafed890a7bca9dcaac4f31d13716e512da30a6808660678427f4d88f",
        36671437,
    ),
    "test-00003-of-00004.parquet": (
        "fe8e53707c14efc231dc18f01a258082b934d95441092a99f94379a3d7a807a9",
        36810867,
    ),
}

COLUMNS = [
    "step_content",
    "is_perturbed",
    "type_of_perturbation",
    "problem_id",
    "node_id",
    "autoformalizer_model",
    "autoformalizer_output",
    "prover_output",
    "proof_result",
]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def verify(directory: Path) -> None:
    """Raise unless every pinned file is present with the recorded hash."""
    for name, (expected, _size) in FILES.items():
        path = directory / name
        if not path.is_file():
            raise FileNotFoundError(f"{path} is missing; run the download command first")
        actual = sha256(path)
        if actual != expected:
            raise ValueError(f"{path} has SHA-256 {actual}, expected {expected}")


def download(directory: Path) -> None:
    """Fetch the pinned files into `directory`, skipping any already verified."""
    directory.mkdir(parents=True, exist_ok=True)
    for name, (expected, size) in FILES.items():
        path = directory / name
        if path.is_file() and sha256(path) == expected:
            print(f"have  {name}")
            continue
        url = URL.format(dataset=DATASET, revision=REVISION, name=name)
        print(f"fetch {name} ({size / 1e6:.1f} MB)")
        partial = path.with_suffix(".partial")
        with urllib.request.urlopen(url) as response, partial.open("wb") as handle:
            for block in iter(lambda: response.read(1 << 20), b""):
                handle.write(block)
        partial.replace(path)
    verify(directory)


def load(directory: Path, extra_columns: tuple[str, ...] = ()) -> pd.DataFrame:
    """Return the verified rows, in file order, with the columns the counts use."""
    verify(directory)
    columns = [*COLUMNS, *extra_columns]
    frames = [pd.read_parquet(directory / name, columns=columns) for name in FILES]
    return pd.concat(frames, ignore_index=True)
