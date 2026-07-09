"""Small, realistic base single-cell datasets the foil generator plants flaws in.

These stand in for public datasets a scientist would download (GEO, an S3 bucket,
the CZI cell atlas). The point of the generator is that it works on data it has
never seen, so each preset uses a DIFFERENT column-naming convention and a
different gene panel. The generator only ever reads the resulting ``.h5ad``: it
resolves the roles with the engine's own foundation step and picks a claim from
what it finds, with no preset name baked in anywhere downstream.

A base is deliberately NEUTRAL. It carries raw integer counts, a biological unit
nested inside a two-arm grouping, a technical column that is independent of the
grouping, and mild between-unit structure so the data looks real. It has no
planted flaw: the generator induces every flaw itself, so a base run reports
mostly clean until a flaw is planted. Pure numpy / pandas / anndata, seeded, no
network.

    python -m data.base_datasets --preset immune --out cache/base/immune.h5ad
    python -m data.base_datasets --list
"""

from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass
from typing import Optional

import anndata as ad
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_OUT = os.path.join(os.path.dirname(HERE), "cache", "base")


@dataclass
class Preset:
    """A base dataset recipe: its column names, arms, units, and gene panel."""

    name: str
    unit_col: str
    group_col: str
    nuisance_col: str
    barcode_col: str
    control_level: str
    treated_level: str
    n_units_per_arm: int
    cells_per_unit: int
    unit_prefix: str
    genes: list[str]
    n_filler_genes: int
    filler_prefix: str


# Real symbol pools so a generated claim reads like a real over-reach, not a
# strawman. None of these drive the planted flaw; the generator overwrites the
# genes it needs. Distinct panels per preset keep the presets genuinely different.
_IMMUNE_GENES = [
    "FOXP3", "IL2RA", "CTLA4", "IKZF2", "CCR7", "SELL", "TCF7", "LEF1", "IL7R",
    "IFNG", "TBX21", "GZMB", "GZMK", "GZMA", "PRF1", "NKG7", "CCL5", "KLRG1",
    "RORC", "IL17A", "CCR6", "CXCR5", "PDCD1", "BCL6", "ICOS", "TIGIT", "TNFRSF9",
    "CD4", "CD8A", "IL10", "TNF", "IL2", "MKI67", "HLA-DRA", "CD27", "CD28",
]
_BRAIN_GENES = [
    "SNAP25", "RBFOX3", "SYT1", "GAD1", "GAD2", "SLC17A7", "GFAP", "AQP4",
    "MBP", "PLP1", "MOG", "PDGFRA", "OLIG1", "OLIG2", "CX3CR1", "P2RY12",
    "AIF1", "CLDN5", "PECAM1", "VWF", "PDGFRB", "GRIN1", "GRIN2B", "CAMK2A",
    "BDNF", "FOS", "ARC", "EGR1", "NPAS4", "HOMER1", "DLG4", "SYN1", "MAP2",
]
_TUMOR_GENES = [
    "EPCAM", "KRT8", "KRT18", "KRT19", "MKI67", "TOP2A", "PCNA", "VIM",
    "PTPRC", "CD3D", "CD8A", "CD4", "FOXP3", "CD68", "CD163", "COL1A1",
    "ACTA2", "PECAM1", "VWF", "PDGFRB", "MYC", "CCND1", "TP53", "CDKN2A",
    "ERBB2", "EGFR", "ESR1", "PGR", "MUC1", "CDH1", "SNAI1", "ZEB1", "CD274",
]

PRESETS: dict[str, Preset] = {
    "immune": Preset(
        name="immune",
        unit_col="donor_id",
        group_col="condition",
        nuisance_col="lane",
        barcode_col="cell_barcode",
        control_level="non-targeting",
        treated_level="IL2RA-KD",
        n_units_per_arm=3,
        cells_per_unit=60,
        unit_prefix="D",
        genes=_IMMUNE_GENES,
        n_filler_genes=42,
        filler_prefix="G",
    ),
    "brain": Preset(
        name="brain",
        unit_col="subject",
        group_col="treatment",
        nuisance_col="chip",
        barcode_col="library_id",
        control_level="vehicle",
        treated_level="psilocybin",
        n_units_per_arm=3,
        cells_per_unit=60,
        unit_prefix="S",
        genes=_BRAIN_GENES,
        n_filler_genes=42,
        filler_prefix="ENSG",
    ),
    "tumor": Preset(
        name="tumor",
        unit_col="patient",
        group_col="arm",
        nuisance_col="batch",
        barcode_col="spot_id",
        control_level="baseline",
        treated_level="treated",
        n_units_per_arm=3,
        cells_per_unit=60,
        unit_prefix="P",
        genes=_TUMOR_GENES,
        n_filler_genes=42,
        filler_prefix="feat",
    ),
}


def build_base(preset: Preset, seed: int = 0) -> ad.AnnData:
    """Construct one neutral base AnnData for a preset. Raw integer counts, a
    unit nested in a two-arm grouping, a technical column independent of the arm,
    and mild between-unit variation so the data reads as real."""
    rng = np.random.default_rng(seed)

    units = [f"{preset.unit_prefix}{i+1}" for i in range(2 * preset.n_units_per_arm)]
    # Alternate arms across units so both arms hold several units (pseudobulk-ready).
    arm_of = {}
    for i, u in enumerate(units):
        arm_of[u] = preset.control_level if i % 2 == 0 else preset.treated_level

    unit_col, group_col = [], []
    for u in units:
        unit_col += [u] * preset.cells_per_unit
        group_col += [arm_of[u]] * preset.cells_per_unit
    unit_col = np.array(unit_col)
    group_col = np.array(group_col)
    n = unit_col.size

    gene_names = list(preset.genes) + [f"{preset.filler_prefix}{i:04d}" for i in range(preset.n_filler_genes)]
    G = len(gene_names)

    # Background counts only. The base carries no reproducible per-cell program,
    # so a planted flaw is never confounded by leftover base signal: the generator
    # induces every real and spurious structure itself on a copy.
    X = rng.poisson(1.0, size=(n, G)).astype(np.int64)

    # Technical column INDEPENDENT of the arm (balanced random), so confounding is
    # clean until the generator plants it.
    nuisance = rng.choice([f"{preset.nuisance_col}-1", f"{preset.nuisance_col}-2"], size=n)

    barcodes = [f"{preset.name}_{i:07d}-1" for i in range(n)]
    obs = pd.DataFrame(
        {
            preset.unit_col: unit_col,
            preset.group_col: group_col,
            preset.nuisance_col: nuisance,
            preset.barcode_col: barcodes,
        },
        index=barcodes,
    )
    counts = X.astype(np.float32)
    adata = ad.AnnData(X=counts.copy(), obs=obs)
    adata.var_names = gene_names
    adata.layers["counts"] = counts
    adata.uns["redline_base"] = {
        "preset": preset.name,
        "unit_col": preset.unit_col,
        "group_col": preset.group_col,
        "nuisance_col": preset.nuisance_col,
        "control_level": preset.control_level,
        "treated_level": preset.treated_level,
        "note": "Neutral base dataset. No planted flaw. The foil generator induces flaws on a copy.",
    }
    return adata


def write_base(preset_name: str, out_path: str, seed: int = 0) -> str:
    preset = PRESETS[preset_name]
    adata = build_base(preset, seed=seed)
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    adata.write_h5ad(out_path)
    print(f"wrote base '{preset_name}': {adata.n_obs} cells x {adata.n_vars} genes to {out_path}", file=sys.stderr)
    return out_path


def main(argv: Optional[list[str]] = None) -> int:
    p = argparse.ArgumentParser(prog="base_datasets", description="Write neutral base single-cell datasets.")
    p.add_argument("--preset", choices=sorted(PRESETS), default="immune")
    p.add_argument("--out", default=None, help="output .h5ad (default cache/base/<preset>.h5ad)")
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--list", action="store_true", help="list presets and their column conventions")
    args = p.parse_args(argv)

    if args.list:
        for name, pr in sorted(PRESETS.items()):
            print(f"{name:8s} unit={pr.unit_col:10s} group={pr.group_col:10s} "
                  f"nuisance={pr.nuisance_col:8s} arms=({pr.control_level} vs {pr.treated_level})")
        return 0

    out = args.out or os.path.join(DEFAULT_OUT, f"{args.preset}.h5ad")
    write_base(args.preset, out, seed=args.seed)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
