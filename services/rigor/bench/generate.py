"""Deterministic single-error foil generator for the detection benchmark.

Each case is a small, seeded ``.h5ad`` built to carry a KNOWN statistical error
(or none). Cases are organized into families for coverage of every error class:

  p1              pseudoreplication present (pos) / a real donor-consistent
                  effect (neg)
  spurious_state  a fake over-clustered state: its markers collapse on a
                  held-out split (double dipping) AND it is not a stable cluster
                  (fragility). Positive for pillars 2 and 3.
  real_state      a genuine, tight, reproducible state: negative for 2 and 3.
  continuum       a real expression gradient. Its markers replicate (pillar 2
                  clean) but the cluster boundary is resolution-dependent
                  (pillar 3 flagged). Isolates fragility and is a hard negative
                  for double dipping.
  p4              the comparison is collinear with a technical batch (pos) /
                  a balanced, separable design (neg).
  clean_control   nothing wrong on any pillar.

Ground truth is assigned by the INDEPENDENT labeler (``bench.labeler``), and each
case is accepted only when the labeler shows the intended pattern with a clear
margin (generate-and-filter). The generator never consults the Redline engine.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Any, Optional

import anndata as ad
import numpy as np
import pandas as pd

from . import labeler, spec


# ── low-level expression blocks ──────────────────────────────────────────────
def _bimodal_block(rng, X, mask, cols, hi, lo=0.3):
    """A tight, reproducible, well-separated marker block for a state."""
    m = int(mask.sum())
    nm = int((~mask).sum())
    X[np.ix_(mask, cols)] = rng.poisson(hi, size=(m, len(cols)))
    X[np.ix_(~mask, cols)] = rng.poisson(lo, size=(nm, len(cols)))


def _gradient_block(rng, X, latent, cols, hi):
    """Markers that scale with a continuous latent score. Real (they replicate
    on a held-out split) but with no discrete boundary, so any 'state' carved
    from the top of the gradient is a resolution artifact."""
    lam = 0.3 + hi * np.clip(latent, 0, None)[:, None]
    X[:, cols] = rng.poisson(lam)


@dataclass
class Case:
    case_id: str
    family: str
    polarity: str
    seed: int
    filename: str
    adata: Any
    claim: dict
    design: dict
    intended: dict[str, bool]      # what we planted (for filtering / provenance)


# ── the base builder ─────────────────────────────────────────────────────────
def _build(family: str, polarity: str, seed: int) -> Case:
    rng = np.random.default_rng(seed)
    # 6 donors, 3 vs 3, so pillar 1 has a real replicate structure to aggregate to.
    donors = [f"D{i+1}" for i in range(6)]
    cond_of = {d: ("control" if i < 3 else "treated") for i, d in enumerate(donors)}
    n_per = 120
    donor_col, cond_col = [], []
    for d in donors:
        donor_col += [d] * n_per
        cond_col += [cond_of[d]] * n_per
    donor_col = np.array(donor_col)
    cond_col = np.array(cond_col)
    n = donor_col.size

    p1_error = (family == "p1" and polarity == "pos")
    p4_error = (family == "p4" and polarity == "pos")

    # ── cell states ──────────────────────────────────────────────────────────
    # Every case carries exactly one "claimed" state (the analysis's subject).
    # Which kind it is decides pillars 2 and 3.
    if family == "spurious_state":
        target = "Reactive"
        states = rng.choice([target, "Bulk"], size=n, p=[0.35, 0.65])
    elif family == "continuum":
        target = "High"
        # a latent gradient; the "state" is just its upper tail (no real boundary)
        latent = rng.normal(0, 1, size=n)
        states = np.where(latent > np.quantile(latent, 0.70), target, "Low")
    else:
        target = "Rare"
        states = rng.choice([target, "Bulk"], size=n, p=[0.20, 0.80])
    states = np.asarray(states)
    tmask = states == target

    # ── genes ─────────────────────────────────────────────────────────────────
    n_state_g, n_noise = 12, 90
    var_names = ["MARKERGENE"] + [f"STATE{i}" for i in range(n_state_g)] + [f"BG{i}" for i in range(n_noise)]
    G = len(var_names)
    state_cols = list(range(1, 1 + n_state_g))
    X = rng.poisson(1.0, size=(n, G)).astype(np.int64)

    # focus gene (pillar 1)
    if p1_error:
        # The classic pseudoreplication trap: one donor in the treated arm is a
        # high-expression outlier. It drags the cell-level test to a tiny p
        # (hundreds of its cells look "significant"), but with only 3 donors per
        # arm the effect vanishes at the donor level. cell-significant, unit-null.
        lam = {d: float(rng.uniform(2.0, 3.0)) for d in donors}
        lam[donors[5]] = 14.0                       # D6 (treated) is the outlier
        X[:, 0] = rng.poisson([lam[d] for d in donor_col])
    else:
        # a genuine, donor-consistent condition effect (survives pseudobulk)
        X[:, 0] = rng.poisson(np.where(cond_col == "treated", 9.0, 2.5))

    # state genes (pillars 2 and 3)
    if family == "spurious_state":
        pass                                   # target stays pure background: fake state
    elif family == "continuum":
        _gradient_block(rng, X, latent, state_cols, hi=6.0)   # real, replicating, boundary-less
    else:
        _bimodal_block(rng, X, tmask, state_cols, hi=16.0)    # tight, real, stable

    # ── technical nuisance (pillar 4) ─────────────────────────────────────────
    if p4_error:
        nuisance = np.where(cond_col == "treated", "chip-A", "chip-B")   # collinear
    else:
        nuisance = rng.choice(["chip-A", "chip-B"], size=n)              # balanced

    barcodes = [f"{family}_{seed}_{i:05d}-1" for i in range(n)]
    obs = pd.DataFrame(
        {
            "donor_id": donor_col,
            "condition": cond_col,
            "cell_state": states,
            "batch": nuisance,
            "cell_barcode": barcodes,
            "leiden": np.where(tmask, "1", "0"),
            "phase": rng.choice(["G1", "S", "G2M"], size=n, p=[0.6, 0.25, 0.15]),
        },
        index=barcodes,
    )
    obs["n_genes"] = (X > 0).sum(axis=1).astype(int)
    obs["pct_mito"] = np.round(rng.uniform(0.2, 7.5, size=n), 3)

    Xf = X.astype(np.float32)
    adata = ad.AnnData(X=Xf.copy(), obs=obs)
    adata.var_names = var_names
    adata.layers["counts"] = Xf.copy()

    claim = {
        "focus_gene": "MARKERGENE",
        "condition_col": "condition",
        "unit_col": "donor_id",
        "state_col": "cell_state",
        "target_state": target,
        "nuisance_col": "batch",
        "resolution": 1.0,
        "label_seed": int(seed),
    }
    design = {
        "n_cells": int(n),
        "n_genes": int(G),
        "donors": donors,
        "per_group_donors": 3,
        "condition_levels": ["control", "treated"],
        "nuisance_levels": sorted(set(nuisance.tolist())),
        "resolution": 1.0,
    }
    return Case(
        case_id="",  # filled by the caller
        family=family,
        polarity=polarity,
        seed=seed,
        filename="",
        adata=adata,
        claim=claim,
        design=design,
        intended={},  # filled below
    )


# distinct seed base per (family, polarity) so a tweak to one never perturbs another
FAMILY_SEED_BASE: dict[str, int] = {
    "p1_pos": 1000, "p1_neg": 1500,
    "spurious_state_pos": 2000,
    "real_state_neg": 2500,
    "continuum_pos": 3000,
    "p4_pos": 4000, "p4_neg": 4500,
    "clean_control_neg": 9000,
}

# families and the truth vector each is built to produce
FAMILY_PLAN: list[tuple[str, str, dict[str, bool]]] = [
    ("p1", "pos", {"pseudoreplication": True}),
    ("p1", "neg", {}),
    ("spurious_state", "pos", {"double_dipping": True, "fragility": True}),
    ("real_state", "neg", {}),
    ("continuum", "pos", {"fragility": True}),
    ("p4", "pos", {"confounding": True}),
    ("p4", "neg", {}),
    ("clean_control", "neg", {}),
]


def _truth_of(adata, claim) -> dict[str, Any]:
    counts = np.asarray(adata.layers["counts"])
    obs = {c: adata.obs[c].to_numpy() for c in adata.obs.columns}
    return labeler.label_case(counts, list(adata.var_names), obs, claim)


def _matches(truth: dict[str, bool], intended: dict[str, bool]) -> bool:
    """Every pillar's labeler truth equals what we intended (default False)."""
    for k in spec.PILLAR_KEYS:
        want = bool(intended.get(k, False))
        if bool(truth[k]) != want:
            return False
    return True


def _accept(family: str, polarity: str, lab: dict, intended: dict[str, bool]) -> bool:
    """Accept a case only when the truth vector matches AND the discriminating
    statistic clears a margin, so labels are unambiguous (no borderline cases)."""
    if not _matches(lab["truth"], intended):
        return False
    if family == "p1" and polarity == "pos":
        s = lab["pseudoreplication"]
        return s["cell_p"] < spec.P1_POS_CELL_MAX and s["unit_p"] >= spec.P1_POS_UNIT_MIN
    if family == "spurious_state":
        return (lab["double_dipping"]["hold_auc"] <= spec.P2_COLLAPSE_AUC
                and lab["fragility"]["stability"] <= spec.P3_POS_STAB_MAX)
    if family == "continuum":
        return (lab["fragility"]["stability"] <= spec.P3_POS_STAB_MAX
                and lab["double_dipping"]["hold_auc"] >= spec.P2_HOLD_AUC)
    if family == "p4" and polarity == "pos":
        return lab["confounding"]["cramers_v"] >= 0.99
    return True  # negatives / clean controls: _matches already requires all-clean


def build_all(max_tries: int = 24) -> list[Case]:
    cases: list[Case] = []
    for family, polarity, intended in FAMILY_PLAN:
        base = FAMILY_SEED_BASE[f"{family}_{polarity}"]
        count = spec.N_CLEAN_CONTROLS if family == "clean_control" else spec.N_PER_CELL
        made = 0
        attempt = 0
        while made < count:
            seed = base + made * max_tries + attempt
            case = _build(family, polarity, seed)
            lab = _truth_of(case.adata, case.claim)
            attempt += 1
            if _accept(family, polarity, lab, intended) or attempt >= max_tries:
                tag = "pos" if intended else "clean"
                case.case_id = f"{family}_{tag}_{made:02d}"
                case.filename = f"{case.case_id}.h5ad"
                case.intended = {k: bool(intended.get(k, False)) for k in spec.PILLAR_KEYS}
                case._label = lab  # type: ignore[attr-defined]
                case._label_ok = _matches(lab["truth"], intended)  # type: ignore[attr-defined]
                cases.append(case)
                made += 1
                attempt = 0
    return cases


def write_all(out_dir: str = spec.CASES_DIR) -> dict[str, Any]:
    os.makedirs(out_dir, exist_ok=True)
    cases = build_all()
    manifest_cases = []
    labels = {}
    n_forced = 0
    for c in cases:
        path = os.path.join(out_dir, c.filename)
        c.adata.write_h5ad(path, compression="gzip")   # integer counts compress well
        lab = c._label  # type: ignore[attr-defined]
        if not c._label_ok:  # type: ignore[attr-defined]
            n_forced += 1
        manifest_cases.append({
            "case_id": c.case_id,
            "family": c.family,
            "polarity": c.polarity,
            "seed": c.seed,
            "filename": c.filename,
            "claim": c.claim,
            "design": c.design,
            "intended": c.intended,
            "label_matches_intended": bool(c._label_ok),  # type: ignore[attr-defined]
        })
        labels[c.case_id] = {
            "truth": lab["truth"],
            "stats": {k: {kk: vv for kk, vv in lab[k].items() if kk != "present"}
                      for k in spec.PILLAR_KEYS},
        }
    manifest = {
        "generatedBy": "services/rigor/bench/generate.py",
        "labeledBy": "services/rigor/bench/labeler.py (independent numpy/scipy)",
        "n_cases": len(cases),
        "n_label_mismatches": n_forced,
        "pillars": {k: spec.PILLARS[k][1] for k in spec.PILLAR_KEYS},
        "cases": manifest_cases,
    }
    with open(spec.MANIFEST_PATH, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2)
    with open(spec.LABELS_PATH, "w", encoding="utf-8") as fh:
        json.dump(labels, fh, indent=2)
    return {"n_cases": len(cases), "n_label_mismatches": n_forced,
            "out_dir": out_dir, "manifest": spec.MANIFEST_PATH}


if __name__ == "__main__":
    info = write_all()
    print(json.dumps(info, indent=2))
