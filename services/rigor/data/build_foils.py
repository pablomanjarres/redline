"""Deterministic synthetic .h5ad foils for the Redline rigor engine.

Writes four small, seeded AnnData files plus a manifest. Each foil is tuned so
the REAL engine (``redline.job_runner.compute_result``) returns a specific set of
verdicts, so the demo and the tests exercise the pillars on data whose answer is
known.

    caseA_marson_foil.h5ad    canonical foil: 1,2,4 flagged, Effector flagged,
                              Naive clean.
    caseB_pfc_foil.h5ad       same four flaw shapes, different column names and
                              magnitudes (generalization check).
    caseC_clean.h5ad          nothing wrong: all four clean.
    caseD_nocounts.h5ad       normalized X, no integer counts: pillars 1 and 2
                              gate to flag_only, 3 and 4 still run.

Pure numpy + pandas + anndata. No S3, no scanpy needed to BUILD (the engine may
use scanpy at verify time; with leidenalg absent it falls back to KMeans, which
is what these foils are tuned against).

Run from ``services/rigor`` so ``redline`` imports:

    python -m data.build_foils            # write foils + manifest
    python -m data.build_foils --verify   # write, then run the engine and check

The generator is parameter-driven on purpose. The two hard inductions (check2
collapse, check3 narrow window) were tuned by running --verify and reading the
printed discAUC / holdAUC / stability / present-range until the verdicts held.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass, field
from typing import Any, Optional

import anndata as ad
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
RIGOR_ROOT = os.path.dirname(HERE)
DEFAULT_OUT = os.path.join(RIGOR_ROOT, "cache", "foils")


# ── Shape helpers ─────────────────────────────────────────────────────────────
def _finish(rng: np.random.Generator, X: np.ndarray, obs: pd.DataFrame, var_names: list[str],
            with_counts: bool) -> ad.AnnData:
    """Assemble an AnnData. With counts: X is the integer count matrix and a
    'counts' layer mirrors it. Without: X is log1p(CPM), fractional, no counts."""
    n = X.shape[0]
    n_genes_col = (X > 0).sum(axis=1).astype(int)
    obs = obs.copy()
    obs["n_genes"] = n_genes_col
    obs["pct_mito"] = np.round(rng.uniform(0.2, 7.5, size=n), 3)
    barcodes = [f"{obs.index[i]}" for i in range(n)]
    if with_counts:
        counts = X.astype(np.float32)
        adata = ad.AnnData(X=counts.copy(), obs=obs)
        adata.var_names = var_names
        adata.layers["counts"] = counts
    else:
        lib = X.sum(axis=1, keepdims=True)
        cpm = X / np.clip(lib, 1, None) * 1e4
        norm = np.log1p(cpm).astype(np.float32)
        adata = ad.AnnData(X=norm, obs=obs)
        adata.var_names = var_names
    adata.obs_names = barcodes
    return adata


def _naive_block(rng, X, mask, cols, hi, lo):
    """Strong bimodal markers: a tight, reproducible, well-separated state."""
    m = int(mask.sum())
    nm = int((~mask).sum())
    X[np.ix_(mask, cols)] = rng.poisson(hi, size=(m, len(cols)))
    X[np.ix_(~mask, cols)] = rng.poisson(lo, size=(nm, len(cols)))


def _diffuse_block(rng, X, mask, cols, shift, depth):
    """Optional heterogeneous elevation on the spurious group's gene block.

    Count-splitting (check2) validates ANY real per-cell rate structure, so at
    ``shift == 0`` this adds nothing and the spurious group is pure background:
    its claimed markers collapse to chance on a held-out split (check2 flags it)
    and it never forms a discrete cluster across the resolution sweep (check3
    flags it). ``depth`` (in [0,1]) is kept as a per-cell knob for a faint
    coarse-resolution blob when a small positive shift is wanted."""
    if shift <= 0:
        return
    idx = np.where(mask)[0]
    for r, ci in enumerate(idx):
        lam = shift * (0.25 + 1.6 * depth[r])
        X[ci, cols] = X[ci, cols] + rng.poisson(lam, size=len(cols))


# ── Case A: the canonical Marson foil ─────────────────────────────────────────
# The spurious-group knobs (eff_shift, the state proportions, naive tightness) were
# tuned against the real engine so default-config check2 collapses held-out while
# check3 keeps Naive stable. See the module docstring.
def build_case_a(seed: int, eff_shift: float = 0.0, eff_p: float = 0.64, nai_p: float = 0.06,
                 naive_hi: float = 19.0, n_naive_g: int = 10, n_eff_g: int = 150,
                 n_noise: int = 100) -> "Foil":
    rng = np.random.default_rng(seed)
    donors = ["D1", "D2", "D3", "D4"]
    cond_of = {"D1": "non-targeting", "D2": "non-targeting", "D3": "IL2RA-KD", "D4": "IL2RA-KD"}
    # FOXP3 carries between-donor structure: the KD arm sits a touch higher on
    # average, but the within-arm donor spread is large, so a cell-level test is
    # inflated while a donor-level (pseudobulk) test collapses to non-significant.
    foxp3_lambda = {"D1": 3.0, "D2": 7.5, "D3": 4.0, "D4": 8.5}
    n_per = 280

    donor_col, cond_col = [], []
    for d in donors:
        donor_col += [d] * n_per
        cond_col += [cond_of[d]] * n_per
    donor_col = np.array(donor_col)
    cond_col = np.array(cond_col)
    n = donor_col.size

    # Cell states assigned independently of condition (balanced per arm), so the
    # state markers carry no condition signal and FOXP3 stays the max-naive-t gene.
    # Effector is the plurality (so default check2 tests it) and is a weak diffuse
    # blob whose auto-markers collapse held-out. Naive is a small, tight, strongly
    # separated cluster (stable across the whole sweep) kept small enough that its
    # inverse markers cannot rescue the Effector split. Memory is unstructured
    # filler with no distinct markers, so nothing reproducible separates Effector
    # from the rest and the double-dipping catch is genuine.
    mem_p = round(1.0 - eff_p - nai_p, 4)
    states = rng.choice(["Effector", "Memory", "Naive"], size=n, p=[eff_p, mem_p, nai_p])
    eff = states == "Effector"
    naive = states == "Naive"

    var_names = (
        ["FOXP3"]
        + [f"NAIVE{i}" for i in range(n_naive_g)]
        + [f"EFF{i}" for i in range(n_eff_g)]
        + [f"NOISE{i}" for i in range(n_noise)]
    )
    G = len(var_names)
    naive_cols = list(range(1, 1 + n_naive_g))
    eff_cols = list(range(1 + n_naive_g, 1 + n_naive_g + n_eff_g))

    X = rng.poisson(1.0, size=(n, G)).astype(np.int64)
    X[:, 0] = rng.poisson([foxp3_lambda[d] for d in donor_col])
    _naive_block(rng, X, naive, naive_cols, hi=naive_hi, lo=0.3)     # tight + stable
    depth = rng.uniform(0.0, 1.0, size=int(eff.sum()))
    _diffuse_block(rng, X, eff, eff_cols, shift=eff_shift, depth=depth)  # shift=0 -> pure-noise spurious state

    guide_pool_nt = ["NT-1", "NT-2", "NT-3"]
    guide_pool_kd = ["IL2RA-g1", "IL2RA-g2", "IL2RA-g3"]
    guide_id = np.array([
        rng.choice(guide_pool_kd if c == "IL2RA-KD" else guide_pool_nt) for c in cond_col
    ])

    obs = pd.DataFrame(
        {
            "donor_id": donor_col,
            "condition": cond_col,
            "cell_state": states,                                        # first derived -> check2 grouping
            "lane": np.where(cond_col == "IL2RA-KD", "Lane-A", "Lane-B"),  # perfectly collinear with condition
            "cell_barcode": [f"AAACC{i:07d}-1" for i in range(n)],
            "guide_id": guide_id,
            "phase": rng.choice(["G1", "S", "G2M"], size=n, p=[0.6, 0.25, 0.15]),
            "leiden": np.where(naive, "1", "0"),
        },
        index=[f"AAACC{i:07d}-1" for i in range(n)],
    )
    adata = _finish(rng, X, obs, var_names, with_counts=True)
    return Foil(
        case_id="caseA",
        filename="caseA_marson_foil.h5ad",
        scenario_id="marson",
        adata=adata,
        tracks=[("Effector", "flagged"), ("Naive", "clean")],
        intended={"1": "flagged", "2": "flagged",
                  "3": {"Effector": "flagged", "Naive": "clean"}, "4": "flagged"},
    )


# ── Case B: PFC foil (different names + magnitudes) ────────────────────────────
def build_case_b(seed: int, react_shift: float = 0.0, react_p: float = 0.64, neu_p: float = 0.06,
                 neu_hi: float = 20.0, n_neu_g: int = 10, n_react_g: int = 140,
                 n_noise: int = 90) -> "Foil":
    rng = np.random.default_rng(seed)
    patients = ["P1", "P2", "P3", "P4", "P5", "P6"]
    treat_of = {"P1": "vehicle", "P2": "vehicle", "P3": "vehicle",
                "P4": "psilocybin", "P5": "psilocybin", "P6": "psilocybin"}
    genex_lambda = {"P1": 2.0, "P2": 5.0, "P3": 9.0, "P4": 3.0, "P5": 6.0, "P6": 10.0}
    n_per = 190

    pat_col, treat_col = [], []
    for p in patients:
        pat_col += [p] * n_per
        treat_col += [treat_of[p]] * n_per
    pat_col = np.array(pat_col)
    treat_col = np.array(treat_col)
    n = pat_col.size

    # Reactive is the spurious plurality (weak diffuse, auto-markers collapse),
    # Neuron is the small tight stable cluster, Astro is unstructured filler.
    ast_p = round(1.0 - react_p - neu_p, 4)
    states = rng.choice(["Reactive", "Astro", "Neuron"], size=n, p=[react_p, ast_p, neu_p])
    react = states == "Reactive"
    neuron = states == "Neuron"

    var_names = (
        ["GENEX"]
        + [f"NEU{i}" for i in range(n_neu_g)]
        + [f"REACT{i}" for i in range(n_react_g)]
        + [f"BG{i}" for i in range(n_noise)]
    )
    G = len(var_names)
    neu_cols = list(range(1, 1 + n_neu_g))
    react_cols = list(range(1 + n_neu_g, 1 + n_neu_g + n_react_g))

    X = rng.poisson(1.0, size=(n, G)).astype(np.int64)
    X[:, 0] = rng.poisson([genex_lambda[p] for p in pat_col])
    _naive_block(rng, X, neuron, neu_cols, hi=neu_hi, lo=0.3)       # tight + stable
    depth = rng.uniform(0.0, 1.0, size=int(react.sum()))
    _diffuse_block(rng, X, react, react_cols, shift=react_shift, depth=depth)  # shift=0 -> pure-noise spurious state

    obs = pd.DataFrame(
        {
            "patient": pat_col,
            "treatment": treat_col,
            "cell_state": states,
            "batch": np.where(treat_col == "psilocybin", "chip-2", "chip-1"),  # collinear with treatment
            "sample": [f"lib_{i:06d}" for i in range(n)],                        # near-unique -> observation
            "phase": rng.choice(["G1", "S", "G2M"], size=n, p=[0.65, 0.2, 0.15]),
        },
        index=[f"pfc_{i:06d}" for i in range(n)],
    )
    adata = _finish(rng, X, obs, var_names, with_counts=True)
    return Foil(
        case_id="caseB",
        filename="caseB_pfc_foil.h5ad",
        scenario_id="pfc",
        adata=adata,
        tracks=[("Reactive", "flagged"), ("Neuron", "clean")],
        intended={"1": "flagged", "2": "flagged",
                  "3": {"Reactive": "flagged", "Neuron": "clean"}, "4": "flagged"},
    )


# ── Case C: clean ─────────────────────────────────────────────────────────────
def build_case_c(seed: int) -> "Foil":
    rng = np.random.default_rng(seed)
    donors = ["C1", "C2", "C3", "C4", "C5", "C6"]
    cond_of = {"C1": "control", "C2": "control", "C3": "control",
               "C4": "treated", "C5": "treated", "C6": "treated"}
    n_per = 190

    donor_col, cond_col = [], []
    for d in donors:
        donor_col += [d] * n_per
        cond_col += [cond_of[d]] * n_per
    donor_col = np.array(donor_col)
    cond_col = np.array(cond_col)
    n = donor_col.size

    # A large group with strong, reproducible markers (Bulk: the group check2 holds
    # up on a held-out split) and a small, tight, well-separated Rare group that is
    # a discrete cluster across the whole sweep (check3 clean). Nothing spurious.
    states = rng.choice(["Bulk", "Rare"], size=n, p=[0.80, 0.20])
    bulk = states == "Bulk"
    rare = states == "Rare"

    n_bulk_g, n_rare_g, n_noise = 8, 10, 90
    var_names = (
        ["REAL1"]
        + [f"BULK{i}" for i in range(n_bulk_g)]
        + [f"RARE{i}" for i in range(n_rare_g)]
        + [f"BG{i}" for i in range(n_noise)]
    )
    G = len(var_names)
    bulk_cols = list(range(1, 1 + n_bulk_g))
    rare_cols = list(range(1 + n_bulk_g, 1 + n_bulk_g + n_rare_g))

    X = rng.poisson(1.0, size=(n, G)).astype(np.int64)
    # REAL1: a donor-consistent condition effect that survives pseudobulk.
    real_lambda = np.where(cond_col == "treated", 12.0, 2.0)
    X[:, 0] = rng.poisson(real_lambda)
    _naive_block(rng, X, bulk, bulk_cols, hi=15.0, lo=0.3)   # strong reproducible markers
    _naive_block(rng, X, rare, rare_cols, hi=16.0, lo=0.3)   # small, tight, stable cluster

    obs = pd.DataFrame(
        {
            "donor": donor_col,
            "condition": cond_col,
            "cell_state": states,
            "batch": rng.choice(["b1", "b2"], size=n),   # independent of condition -> separable
            "cell_barcode": [f"clean_{i:06d}-1" for i in range(n)],
            "phase": rng.choice(["G1", "S", "G2M"], size=n, p=[0.6, 0.25, 0.15]),
        },
        index=[f"clean_{i:06d}-1" for i in range(n)],
    )
    adata = _finish(rng, X, obs, var_names, with_counts=True)
    return Foil(
        case_id="caseC",
        filename="caseC_clean.h5ad",
        scenario_id="clean",
        adata=adata,
        tracks=[("Rare", "clean")],
        intended={"1": "clean", "2": "clean",
                  "3": {"Rare": "clean"}, "4": "clean"},
    )


# ── Case D: no counts (normalized only) ───────────────────────────────────────
def build_case_d(seed: int) -> "Foil":
    rng = np.random.default_rng(seed)
    donors = ["D1", "D2", "D3", "D4"]
    cond_of = {"D1": "non-targeting", "D2": "non-targeting", "D3": "IL2RA-KD", "D4": "IL2RA-KD"}
    foxp3_lambda = {"D1": 3.0, "D2": 7.5, "D3": 4.0, "D4": 8.5}
    n_per = 180

    donor_col, cond_col = [], []
    for d in donors:
        donor_col += [d] * n_per
        cond_col += [cond_of[d]] * n_per
    donor_col = np.array(donor_col)
    cond_col = np.array(cond_col)
    n = donor_col.size

    states = rng.choice(["Effector", "Naive"], size=n, p=[0.55, 0.45])
    naive = states == "Naive"

    n_naive_g, n_noise = 6, 80
    var_names = ["FOXP3"] + [f"NAIVE{i}" for i in range(n_naive_g)] + [f"NOISE{i}" for i in range(n_noise)]
    G = len(var_names)
    naive_cols = list(range(1, 1 + n_naive_g))

    X = rng.poisson(1.0, size=(n, G)).astype(np.int64)
    X[:, 0] = rng.poisson([foxp3_lambda[d] for d in donor_col])
    _naive_block(rng, X, naive, naive_cols, hi=14.0, lo=0.3)

    obs = pd.DataFrame(
        {
            "donor_id": donor_col,
            "condition": cond_col,
            "cell_state": states,
            "lane": np.where(cond_col == "IL2RA-KD", "Lane-A", "Lane-B"),
            "cell_barcode": [f"nocnt_{i:06d}-1" for i in range(n)],
            "phase": rng.choice(["G1", "S", "G2M"], size=n, p=[0.6, 0.25, 0.15]),
        },
        index=[f"nocnt_{i:06d}-1" for i in range(n)],
    )
    # with_counts=False -> X becomes log1p(CPM): fractional, non-integer, no counts layer.
    adata = _finish(rng, X, obs, var_names, with_counts=False)
    return Foil(
        case_id="caseD",
        filename="caseD_nocounts.h5ad",
        scenario_id="nocounts",
        adata=adata,
        tracks=[("Naive", None)],
        intended={"1": "flag_only", "2": "flag_only", "3": {"Naive": "any"}, "4": "any"},
    )


@dataclass
class Foil:
    case_id: str
    filename: str
    scenario_id: str
    adata: ad.AnnData
    tracks: list[tuple[str, Optional[str]]]
    intended: dict[str, Any]

    def obs_columns(self) -> list[str]:
        return [str(c) for c in self.adata.obs.columns]


BUILDERS = {
    "caseA": build_case_a,
    "caseB": build_case_b,
    "caseC": build_case_c,
    "caseD": build_case_d,
}
# Distinct seeds per case so a tweak to one does not silently perturb another.
SEEDS = {"caseA": 7, "caseB": 23, "caseC": 41, "caseD": 5}


# ── Write ─────────────────────────────────────────────────────────────────────
def build_all(out_dir: str) -> list[Foil]:
    os.makedirs(out_dir, exist_ok=True)
    foils: list[Foil] = []
    for case_id, builder in BUILDERS.items():
        foil = builder(SEEDS[case_id])
        path = os.path.join(out_dir, foil.filename)
        foil.adata.write_h5ad(path)
        foils.append(foil)
        print(f"wrote {path}  ({foil.adata.n_obs} cells x {foil.adata.n_vars} genes)", file=sys.stderr)
    manifest = {
        "generatedBy": "services/rigor/data/build_foils.py",
        "seeds": SEEDS,
        "cases": [
            {
                "caseId": f.case_id,
                "filename": f.filename,
                "scenarioId": f.scenario_id,
                "obs_columns": f.obs_columns(),
                "intended_verdicts": f.intended,
            }
            for f in foils
        ],
    }
    mpath = os.path.join(out_dir, "manifest.json")
    with open(mpath, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2)
    print(f"wrote {mpath}", file=sys.stderr)
    return foils


# ── Verify against the real engine ────────────────────────────────────────────
def _f(x: Any) -> str:
    try:
        return f"{float(x):.3f}"
    except Exception:
        return str(x)


def verify(out_dir: str) -> bool:
    from redline import job_runner
    from redline.audit import default_config

    ok_all = True
    rows: list[str] = []
    for case_id, builder in BUILDERS.items():
        foil = builder(SEEDS[case_id])
        path = os.path.join(out_dir, foil.filename)
        fields = job_runner.resolve_fields(path)
        roles = {f["id"]: f["role"] for f in fields}

        # checks 1, 2, 4 from default_config; check 3 once per tracked group.
        cfg1 = default_config(1, fields)
        r1 = job_runner.compute_result(1, path, cfg1, fields)
        cfg2 = default_config(2, fields)
        r2 = job_runner.compute_result(2, path, cfg2, fields)
        cfg4 = default_config(4, fields)
        r4 = job_runner.compute_result(4, path, cfg4, fields)
        base3 = default_config(3, fields)
        r3 = {}
        for track, _exp in foil.tracks:
            c = dict(base3)
            c["track"] = track
            r3[track] = job_runner.compute_result(3, path, c, fields)

        ch1, ch2, ch4 = r1["chart"], r2["chart"], r4["chart"]
        rows.append(f"\n=== {case_id} ({foil.filename}) ===")
        rows.append(f"  roles: {roles}")
        rows.append(
            f"  check1 state={r1['state']:<9} naive.sig={ch1['naive']['sig']} honest.sig={ch1['honest']['sig']} "
            f"naive.p={_f(ch1['naive']['p'])} honest.p={_f(ch1['honest']['p'])} badUnit={ch1['badUnit']}"
        )
        rows.append(
            f"  check2 state={r2['state']:<9} discAUC={ch2.get('discAUC')} holdAUC={ch2.get('holdAUC')} "
            f"grouping={cfg2.get('grouping')} markers={[m['gene'] for m in ch2.get('markers', [])]}"
        )
        for track, exp in foil.tracks:
            ch3 = r3[track]["chart"]
            rows.append(
                f"  check3 track={track:<10} state={r3[track]['state']:<9} "
                f"stability={ch3['stability']} present={ch3['present']} "
                f"clusters={[s['clusters'] for s in ch3['steps']]}"
            )
        rows.append(f"  check4 state={r4['state']:<9} cramersV={ch4.get('cramersV')} interest={cfg4.get('interest')} "
                    f"nuisance={cfg4.get('nuisance')}")

        # Compare to intended.
        def check(label: str, got: str, want: str) -> None:
            nonlocal ok_all
            if want == "any":
                rows.append(f"    [info] {label}: {got} (unconstrained)")
                return
            mark = "OK " if got == want else "XX "
            if got != want:
                ok_all = False
            rows.append(f"    [{mark}] {label}: got={got} want={want}")

        check("check1", r1["state"], foil.intended["1"])
        check("check2", r2["state"], foil.intended["2"])
        for track, exp in foil.tracks:
            want = foil.intended["3"].get(track, "any")
            check(f"check3[{track}]", r3[track]["state"], want)
        check("check4", r4["state"], foil.intended["4"])

    print("\n".join(rows))
    print("\n" + ("ALL INTENDED VERDICTS MATCH" if ok_all else "MISMATCH(ES) ABOVE"))
    return ok_all


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(prog="build_foils", description="Generate Redline synthetic foils.")
    parser.add_argument("--out", default=DEFAULT_OUT, help=f"Output dir (default {DEFAULT_OUT})")
    parser.add_argument("--verify", action="store_true", help="Run the engine and check verdicts after writing.")
    parser.add_argument("--verify-only", action="store_true", help="Skip writing; just verify existing files.")
    args = parser.parse_args(argv)

    if not args.verify_only:
        build_all(args.out)
    if args.verify or args.verify_only:
        ok = verify(args.out)
        return 0 if ok else 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
