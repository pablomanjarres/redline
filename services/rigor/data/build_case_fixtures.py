#!/usr/bin/env python3
"""Synthesize the small, deterministic case fixtures the acceptance harness runs on.

There is no real ``.h5ad`` committed anywhere (datasets are gitignored and the
Marson subset is multi-gigabyte), so the intake, inspection, and claim-extraction
paths have nothing to run against out of the box. This script builds three tiny,
seeded, clearly-labeled TEST FIXTURE files that stand in for the shapes that
actually occur, so every downstream step is exercised end to end without a
network fetch.

They are fixtures and they say so twice: the filename carries ``case_*`` and each
object carries ``uns['redline_fixture']`` with a plain-language note. Nothing here
is real biology; the gene names are chosen only so the inventory and the routing
are legible.

Three cases:

  case_a.h5ad       Marson-shaped foil. ~600 cells, ~120 genes, 4 donors. Carries
                    BOTH a scanpy-shaped ``rank_genes_groups`` marker table (with
                    TNFRSF9 / ICOS / TIGIT / CTLA4 among the cluster markers) AND a
                    stored ``de_results`` DE table (including FOXP3 at a tiny
                    p-value). The full worked example from the spec.

  case_b.h5ad       Ketamine-shaped and DELIBERATELY different. ~500 cells, ~100
                    genes. Different obs columns entirely (mouse_id, treatment,
                    batch, cell_type), different genes (BDNF, HOMER1, ARC, NPAS4),
                    a DE result with different column names (pvalue /
                    log2FoldChange rather than pvals / logfoldchanges), and NO
                    marker table, so extraction has to cope with a DE table alone.
                    Identical claims across case_a and case_b would prove the
                    extractor is faked; different shapes force it to adapt.

  case_c_bare.h5ad  Counts and obs, and NOTHING stored in uns. This is the honest
                    "no auditable claims" state: the harness asserts Redline says
                    so plainly rather than inventing claims to fill the list.

Deterministic and idempotent: seeded RNG per case, and each run overwrites the
same path, so re-running produces the same bytes.

Usage::

    python -m data.build_case_fixtures            # run from services/rigor
    python services/rigor/data/build_case_fixtures.py
    python services/rigor/data/build_case_fixtures.py --out /tmp/fixtures
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path
from typing import Any

import anndata as ad
import numpy as np
import pandas as pd

# Where the fixtures land by default: services/rigor/data/fixtures/.
DEFAULT_OUT = Path(__file__).resolve().parent / "fixtures"

_FIXTURE_NOTE = "Redline synthetic TEST FIXTURE ({case}). Not real data; do not cite."

# The one place the per-case seeds live. Every random draw in every build_case_*
# derives from these, so a rebuild reproduces the same RNG stream, the same counts
# matrix, the same obs, and the same stored results. Change a seed here and the
# whole case changes deterministically; there is no unseeded RNG and no Python
# ``random`` anywhere in this module. Distinct seeds keep the three cases from
# accidentally sharing a stream.
SEEDS: dict[str, int] = {
    "case_a": 11,
    "case_b": 22,
    "case_c": 33,
}


def _structured(groups: list[str], columns: dict[str, list[Any]], dt: str) -> np.ndarray:
    """A scanpy-style structured array: one field per group, values down each field."""
    length = len(next(iter(columns.values())))
    arr = np.empty(length, dtype=[(g, dt) for g in groups])
    for g in groups:
        arr[g] = np.array(columns[g], dtype=dt if dt != object else object)
    return arr


# ── Case A: Marson-shaped foil (marker table + DE result) ─────────────────────
def build_case_a(path: Path) -> Path:
    rng = np.random.default_rng(SEEDS["case_a"])
    n_cells, n_genes = 600, 120
    donors = ["D1", "D2", "D3", "D4"]
    donor_id = np.repeat(donors, n_cells // len(donors))
    cond_by_donor = {"D1": "non_targeting", "D2": "non_targeting",
                     "D3": "IL2RA_knockdown", "D4": "IL2RA_knockdown"}
    condition = np.array([cond_by_donor[d] for d in donor_id])

    # lane: three levels, PARTIALLY confounded with condition (knockdown leans
    # Lane-A, non-targeting leans Lane-B, with Lane-C mixed across both).
    lane = np.where(condition == "IL2RA_knockdown", "Lane-A", "Lane-B")
    spill = rng.random(n_cells) < 0.2
    lane = np.where(spill, "Lane-C", lane)

    leiden = np.array([str(i % 5) for i in range(n_cells)])
    barcodes = np.array([f"AAAC{i:07d}-1" for i in range(n_cells)])

    named = ["FOXP3", "TNFRSF9", "ICOS", "TIGIT", "CTLA4", "IL2RA"]
    genes = named + [f"GENE{i:03d}" for i in range(n_genes - len(named))]
    idx = {g: i for i, g in enumerate(genes)}

    X = rng.poisson(1.0, size=(n_cells, n_genes)).astype(np.int64)
    # Cluster 0 is an "activated Treg-like" state: its four markers run high there.
    c0 = leiden == "0"
    for g in ("TNFRSF9", "ICOS", "TIGIT", "CTLA4"):
        X[c0, idx[g]] = rng.poisson(12.0, size=int(c0.sum()))
    # FOXP3 carries between-donor structure, higher in the knockdown donors.
    lam = np.where(np.isin(donor_id, ["D3", "D4"]), 8.0, 3.0)
    X[:, idx["FOXP3"]] = rng.poisson(lam)

    obs = pd.DataFrame(
        {
            "donor_id": pd.Categorical(donor_id),
            "condition": pd.Categorical(condition),
            "lane": pd.Categorical(lane),
            "leiden": pd.Categorical(leiden),
            "cell_barcode": barcodes,  # object dtype -> an identifier column
        },
        index=barcodes,
    )
    adata = ad.AnnData(X=X.astype(np.float32), obs=obs)
    adata.var_names = genes
    adata.layers["counts"] = X.astype(np.float32)

    # A scanpy-shaped rank_genes_groups: cluster 0 leads with the four markers.
    groups = ["0", "1", "2", "3", "4"]
    top_k = 10

    def top_for(g: str) -> list[str]:
        base = ["TNFRSF9", "ICOS", "TIGIT", "CTLA4", "IL2RA", "FOXP3"] if g == "0" else []
        shift = int(g) * 13
        rotated = genes[shift:] + genes[:shift]
        return list(dict.fromkeys(base + rotated))[:top_k]

    names_cols = {g: top_for(g) for g in groups}
    ranks = np.linspace(10.0, 1.0, top_k)
    pv = np.geomspace(1e-8, 1e-2, top_k)
    lfc = np.linspace(3.0, 0.2, top_k)
    adata.uns["rank_genes_groups"] = {
        "params": {"groupby": "leiden", "method": "wilcoxon", "reference": "rest"},
        "names": _structured(groups, names_cols, object),
        "scores": _structured(groups, {g: ranks.tolist() for g in groups}, "f4"),
        "pvals": _structured(groups, {g: pv.tolist() for g in groups}, "f4"),
        "pvals_adj": _structured(groups, {g: np.clip(pv * 5, 0, 1).tolist() for g in groups}, "f4"),
        "logfoldchanges": _structured(groups, {g: lfc.tolist() for g in groups}, "f4"),
    }

    # A stored DE table (dict-of-arrays), FOXP3 first at a tiny p-value.
    de_genes = ["FOXP3", "TNFRSF9", "ICOS", "CTLA4", "IL2RA", "TIGIT"] + genes[6:26]
    lead_p = [6.2e-11, 1e-4, 2e-3, 5e-3, 0.30, 0.02]
    lead_lfc = [2.4, 1.8, 1.2, 0.9, -0.1, 0.7]
    tail_p = rng.uniform(0.01, 0.9, len(de_genes) - len(lead_p))
    tail_lfc = rng.uniform(-1.0, 1.0, len(de_genes) - len(lead_lfc))
    de_p = np.concatenate([lead_p, tail_p])
    de_lfc = np.concatenate([lead_lfc, tail_lfc])
    adata.uns["de_results"] = {
        "gene": np.array(de_genes, dtype=object),
        "pvals": de_p.astype("f8"),
        "pvals_adj": np.clip(de_p * 10, 0, 1).astype("f8"),
        "logfoldchanges": de_lfc.astype("f8"),
        "scores": rng.normal(size=len(de_genes)).astype("f8"),
    }
    adata.uns["redline_fixture"] = _FIXTURE_NOTE.format(case="case_a")

    return _write(adata, path)


# ── Case B: ketamine-shaped, deliberately different (DE only, no marker table) ─
def build_case_b(path: Path) -> Path:
    rng = np.random.default_rng(SEEDS["case_b"])
    n_cells, n_genes = 500, 100
    mice = ["M1", "M2", "M3", "M4"]
    mouse_id = np.repeat(mice, n_cells // len(mice))
    treat_by_mouse = {"M1": "saline", "M2": "saline", "M3": "ketamine", "M4": "ketamine"}
    treatment = np.array([treat_by_mouse[m] for m in mouse_id])
    batch = np.array([f"batch{(i % 2) + 1}" for i in range(n_cells)])
    cell_types = ["Excitatory", "Inhibitory", "Astrocyte", "Microglia"]
    cell_type = np.array([cell_types[i % len(cell_types)] for i in range(n_cells)])
    barcodes = np.array([f"CTRL{i:07d}-1" for i in range(n_cells)])

    named = ["BDNF", "HOMER1", "ARC", "NPAS4"]
    genes = named + [f"Gene{i:03d}" for i in range(n_genes - len(named))]
    idx = {g: i for i, g in enumerate(genes)}

    X = rng.poisson(1.0, size=(n_cells, n_genes)).astype(np.int64)
    kd = treatment == "ketamine"
    for g in ("BDNF", "ARC", "NPAS4", "HOMER1"):
        X[kd, idx[g]] = rng.poisson(6.0, size=int(kd.sum()))

    obs = pd.DataFrame(
        {
            "mouse_id": pd.Categorical(mouse_id),
            "treatment": pd.Categorical(treatment),
            "batch": pd.Categorical(batch),
            "cell_type": pd.Categorical(cell_type),
        },
        index=barcodes,
    )
    adata = ad.AnnData(X=X.astype(np.float32), obs=obs)
    adata.var_names = genes
    adata.layers["counts"] = X.astype(np.float32)

    # A stored DE result with DIFFERENT column names (pvalue / log2FoldChange /
    # baseMean), and no rank_genes_groups, so extraction adapts to a DE table alone.
    de_genes = ["BDNF", "ARC", "NPAS4", "HOMER1"] + genes[4:24]
    lead_p = [3.1e-9, 4e-6, 1e-4, 8e-3]
    lead_lfc = [1.9, 1.5, 1.1, 0.8]
    tail_p = rng.uniform(0.01, 0.9, len(de_genes) - len(lead_p))
    tail_lfc = rng.uniform(-1.0, 1.0, len(de_genes) - len(lead_lfc))
    adata.uns["de_results"] = {
        "gene": np.array(de_genes, dtype=object),
        "pvalue": np.concatenate([lead_p, tail_p]).astype("f8"),
        "log2FoldChange": np.concatenate([lead_lfc, tail_lfc]).astype("f8"),
        "baseMean": rng.uniform(1.0, 500.0, len(de_genes)).astype("f8"),
    }
    adata.uns["redline_fixture"] = _FIXTURE_NOTE.format(case="case_b")

    return _write(adata, path)


# ── Case C: bare object, counts + obs, nothing stored in uns ──────────────────
def build_case_c(path: Path) -> Path:
    rng = np.random.default_rng(SEEDS["case_c"])
    n_cells, n_genes = 300, 80
    subjects = ["S1", "S2", "S3", "S4"]
    donor_id = np.repeat(subjects, n_cells // len(subjects))
    condition = np.where(np.isin(donor_id, ["S3", "S4"]), "case", "ctrl")
    barcodes = np.array([f"BARE{i:07d}-1" for i in range(n_cells)])
    genes = [f"g{i:03d}" for i in range(n_genes)]

    X = rng.poisson(1.0, size=(n_cells, n_genes)).astype(np.int64)
    obs = pd.DataFrame(
        {
            "donor_id": pd.Categorical(donor_id),
            "condition": pd.Categorical(condition),
            "cell_barcode": barcodes,
        },
        index=barcodes,
    )
    adata = ad.AnnData(X=X.astype(np.float32), obs=obs)
    adata.var_names = genes
    adata.layers["counts"] = X.astype(np.float32)
    # The only uns entry is the provenance tag: no stored results at all.
    adata.uns["redline_fixture"] = _FIXTURE_NOTE.format(case="case_c_bare")

    return _write(adata, path)


def _write(adata: ad.AnnData, path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    adata.write_h5ad(path)
    return path


# The three fixtures' filenames, in one place so the builder and the on-demand
# guard agree on what "the fixtures" are.
_FIXTURE_FILES: dict[str, str] = {
    "case_a": "case_a.h5ad",
    "case_b": "case_b.h5ad",
    "case_c": "case_c_bare.h5ad",
}

_REBUILD_CMD = (
    "cd services/rigor && source .venv/bin/activate && python -m data.build_case_fixtures"
)


def fixture_paths(out_dir: str | os.PathLike[str] = DEFAULT_OUT) -> dict[str, str]:
    """The expected ``{name: path}`` for the three fixtures under ``out_dir``.

    Names the paths without building anything, so a consumer can check for them.
    """
    out = Path(out_dir)
    return {name: str(out / fname) for name, fname in _FIXTURE_FILES.items()}


def build_fixtures(out_dir: str | os.PathLike[str]) -> dict[str, str]:
    """Write the three case fixtures into ``out_dir``. Returns ``{name: path}``.

    Deterministic (seeded per case) and idempotent (overwrites), so the
    acceptance harness can rebuild them into a tmp directory on every run.
    """
    out = Path(out_dir)
    return {
        "case_a": str(build_case_a(out / _FIXTURE_FILES["case_a"])),
        "case_b": str(build_case_b(out / _FIXTURE_FILES["case_b"])),
        "case_c": str(build_case_c(out / _FIXTURE_FILES["case_c"])),
    }


def ensure_fixtures(out_dir: str | os.PathLike[str] = DEFAULT_OUT) -> dict[str, str]:
    """Return the fixture paths, building any that are missing first.

    The fixtures are gitignored (the repo's global ``*.h5ad`` rule) and kept
    generated rather than committed, because no consumer reads them from this
    fixed path: the inspection tests build them into a tmp directory, and the
    acceptance harness runs on in-memory inventories. A future consumer that DOES
    want them at ``data/fixtures/`` calls this instead of reading the path raw, so
    it never hits a bare ``FileNotFoundError``. The build is deterministic and
    takes about a second, so generating the missing ones on demand is safe. To
    build them by hand: ``%s``.
    """ % _REBUILD_CMD
    paths = fixture_paths(out_dir)
    if all(Path(p).exists() for p in paths.values()):
        return paths
    return build_fixtures(out_dir)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="build_case_fixtures",
        description="Synthesize the case_a / case_b / case_c_bare test fixtures.",
    )
    parser.add_argument(
        "--out",
        default=str(DEFAULT_OUT),
        help=f"Directory to write the fixtures into (default: {DEFAULT_OUT}).",
    )
    args = parser.parse_args(argv)

    paths = build_fixtures(args.out)
    for name, path in paths.items():
        size = os.path.getsize(path)
        print(f"{name}: {path} ({size} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
