#!/usr/bin/env python3
"""Derive Redline's real Marson numbers from the published supplementary tables.

Reads the two SMALL, real tables that ship in `data/real/` (pulled from the open
S3 bucket `s3://genome-scale-tcell-perturb-seq/marson2025_data/suppl_tables/`,
MIT-licensed, no credentials) and emits `data/real/real-marson.json`: the real
experimental design, the real batch-confounding metric, and real per-perturbation
DE numbers. These are the values the app wires in place of invented constants.

What can be derived from these tables (no expression matrix needed):
  - the experimental design (4 donors + covariates, 3 conditions, 2 runs)
  - the confounding check: run x condition / run x donor Cramér's V
  - per-perturbation cell counts, effect sizes, on-target significance, and
    cross-donor reproducibility (the authors' donor-level DESeq2 result)

What strictly needs the 15-148 GiB `.h5ad` matrices (NOT run here):
  - the naive cell-level p-value (cell-level DE on `.X`)
  - double-dipping discovery-vs-held-out AUC (count-splitting on `.X`)
  - clustering fragility (Leiden resolution sweeps on `.X`)
Those run through the rigor engine (`redline.audit`) on a machine with the data.

Pure standard library on purpose: it runs on the stock Python here (3.9, no pip).
"""

import csv
import json
import math
import os
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
REAL = os.path.join(HERE, "real")
META = os.path.join(REAL, "sample_metadata.suppl_table.csv")
DE = os.path.join(REAL, "DE_stats.suppl_table.csv")
OUT = os.path.join(REAL, "real-marson.json")

# The perturbations the app's Marson scenario can reference, with real numbers.
SCENARIO_GENES = ["IL2RA", "FOXP3", "CTLA4", "IL2", "TNFRSF9", "FOXQ1"]


def cramers_v(pairs):
    """Bias-uncorrected Cramér's V for a list of (row, col) category pairs."""
    xs = sorted({a for a, _ in pairs})
    ys = sorted({b for _, b in pairs})
    n = len(pairs)
    obs = defaultdict(int)
    rx = Counter()
    cy = Counter()
    for a, b in pairs:
        obs[(a, b)] += 1
        rx[a] += 1
        cy[b] += 1
    chi2 = 0.0
    for a in xs:
        for b in ys:
            e = rx[a] * cy[b] / n
            if e > 0:
                chi2 += (obs[(a, b)] - e) ** 2 / e
    k = min(len(xs), len(ys))
    v = math.sqrt(chi2 / (n * (k - 1))) if k > 1 else 0.0
    grid = [[obs[(a, b)] for b in ys] for a in xs]
    return {"rows": xs, "cols": ys, "grid": grid, "chi2": round(chi2, 4), "cramersV": round(v, 4)}


def build_design(samples):
    donors = {}
    for r in samples:
        donors.setdefault(
            r["donor_id"],
            {
                "donor_id": r["donor_id"],
                "sex": r["sex"],
                "age": int(r["age"]),
                "ethnicity": r["ethnicity"],
            },
        )
    return {
        "donors": list(donors.values()),
        "conditions": sorted({r["culture_condition"] for r in samples}),
        "runs": sorted({r["10xrun_id"] for r in samples}),
        "n_samples": len(samples),
        "n_donors": len(donors),
    }


def num(s):
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


def build_de(de_rows):
    by_gene = defaultdict(dict)
    n_ontarget_sig = 0
    for r in de_rows:
        if r["ontarget_significant"] == "True":
            n_ontarget_sig += 1
        g = r["target_contrast_gene_name"]
        if g in SCENARIO_GENES:
            by_gene[g][r["culture_condition"]] = {
                "n_cells_target": num(r["n_cells_target"]),
                "n_total_de_genes": num(r["n_total_de_genes"]),
                "ontarget_effect_size": num(r["ontarget_effect_size"]),
                "ontarget_significant": r["ontarget_significant"] == "True",
                "effect_category": r["ontarget_effect_category"],
            }
    return by_gene, n_ontarget_sig


def main():
    samples = list(csv.DictReader(open(META)))
    de_rows = list(csv.DictReader(open(DE)))

    design = build_design(samples)
    confounding = {
        "run_x_condition": cramers_v([(r["10xrun_id"], r["culture_condition"]) for r in samples]),
        "run_x_donor": cramers_v([(r["10xrun_id"], r["donor_id"]) for r in samples]),
    }
    perturbations, n_ontarget_sig = build_de(de_rows)

    out = {
        "source": {
            "bucket": "s3://genome-scale-tcell-perturb-seq/marson2025_data",
            "tables": ["suppl_tables/sample_metadata.suppl_table.csv", "suppl_tables/DE_stats.suppl_table.csv"],
            "citation": "Zhu, Dann et al. 2025 (Marson/Pritchard genome-scale CD4+ T-cell Perturb-seq)",
            "license": "MIT",
        },
        "design": design,
        "confounding": confounding,
        "de_summary": {
            "n_perturbation_condition_pairs": len(de_rows),
            "n_ontarget_significant": n_ontarget_sig,
        },
        "perturbations": perturbations,
    }
    with open(OUT, "w") as f:
        json.dump(out, f, indent=2)
    print(f"wrote {os.path.relpath(OUT, HERE)}")
    print(f"  donors={design['n_donors']} conditions={design['conditions']} runs={design['runs']}")
    rc = confounding["run_x_condition"]
    print(f"  run x condition Cramér's V = {rc['cramersV']}  grid={rc['grid']}")
    print(f"  perturbations captured: {sorted(perturbations)}")
    print(f"  on-target-significant pairs: {n_ontarget_sig}/{len(de_rows)}")


if __name__ == "__main__":
    main()
