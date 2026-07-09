"""Build the seeded CI reference foil and print the real interval numbers.

The confidence-interval layer repeats a stochastic check over many seeds and
reports the spread. This script builds the small, fully seeded reference foil
(``redline.oracle.reference``), runs the two stochastic checks on it, and prints
the intervals it actually computes, so the numbers are reproducible and never
hand-authored. It optionally writes the foil to ``cache/`` (gitignored).

    python build_ci_reference.py                 # print intervals (reps 200 / 40)
    python build_ci_reference.py --write         # also write cache/ci_reference.h5ad
    python build_ci_reference.py --c2-reps 200 --c3-reps 40

Nothing here reads the network or any credential. The foil is synthetic and
seeded, so two runs print the same interval. It carries a real Naive program
(holds out, tight interval) and a spurious Effector group (weak, wide interval),
the same honesty discipline as the Marson naive foil.
"""

from __future__ import annotations

import argparse
import json
import os
import sys

# Allow running this file directly from services/rigor/data without an install.
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from redline.oracle.reference import ReferenceSpec, build_reference_foil, naive_marker_names  # noqa: E402
from redline.pillars import double_dipping, fragility  # noqa: E402


def _iv(stat):
    return getattr(stat, "interval", None)


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="build_ci_reference", description=__doc__)
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--c2-reps", dest="c2_reps", type=int, default=200)
    p.add_argument("--c3-reps", dest="c3_reps", type=int, default=40)
    p.add_argument("--write", action="store_true", help="write cache/ci_reference.h5ad")
    args = p.parse_args(argv)

    spec = ReferenceSpec(seed=args.seed)
    adata = build_reference_foil(spec)

    if args.write:
        out_dir = os.path.join(os.path.dirname(__file__), "cache")
        os.makedirs(out_dir, exist_ok=True)
        path = os.path.join(out_dir, "ci_reference.h5ad")
        adata.write_h5ad(path)
        sys.stderr.write(f"[ci-reference] wrote {path}\n")

    def run_c2(target, markers=None):
        cfg = {"split": 0.5, "grouping": "cell_state", "target_group": target, "repeats": args.c2_reps, "seed": args.seed}
        if markers:
            cfg["markers"] = markers
        r = double_dipping.run(adata, cfg)
        return {
            "state": r.state,
            "headline": r.headline,
            "stats": [{"label": s.label, "value": s.value, "interval": _iv(s)} for s in r.stats],
        }

    def run_c3(track):
        cfg = {"min": 0.2, "max": 2.0, "step": 0.2, "track": track, "repeats": args.c3_reps, "seed": args.seed}
        r = fragility.run(adata, cfg)
        return {
            "state": r.state,
            "headline": r.headline,
            "stats": [{"label": s.label, "value": s.value, "interval": _iv(s)} for s in r.stats],
        }

    report = {
        "foil": {"cells": int(adata.n_obs), "genes": int(adata.n_vars), "seed": args.seed},
        "check2": {
            "effector_spurious": run_c2("Effector"),
            "naive_real": run_c2("Naive", naive_marker_names(spec)),
        },
        "check3": {
            "effector_spurious": run_c3("Effector"),
            "naive_real": run_c3("Naive"),
        },
    }
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
