"""``python -m redline.oracle`` — recompute the answer key for the four checks.

Two modes:

Single case (all descriptor fields as flags)::

    python -m redline.oracle --case A --foil path/to.h5ad \
        --unit donor_id --grouping condition --nuisance lane \
        --spurious Effector --stable Naive --state-col cell_state \
        --focus-gene FOXP3 --out cache/oracle

Manifest (per-case descriptors read from a foils manifest, run all cases)::

    python -m redline.oracle --manifest cache/foils/manifest.json --out cache/oracle

Either way it writes ``<out>/<caseId>.json`` per case and prints each case JSON to
stdout (pass ``--quiet`` to write only). A renamed-column case (patient /
treatment / batch) works by naming those columns in its descriptor or flags; no
column name is hardcoded.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Optional, Sequence

from .checks import run_case
from .descriptor import Descriptor, descriptor_from_dict, load_manifest

_REQUIRED_SINGLE = ("foil", "unit", "grouping", "nuisance", "spurious", "state_col", "focus_gene")

# (arg attribute, manifest key) for optional tuning knobs passed on the CLI.
_OVERRIDES = (
    ("markers", "markers"),
    ("markers_k", "markers_k"),
    ("split", "split"),
    ("alpha", "alpha"),
    ("res_min", "res_min"),
    ("res_max", "res_max"),
    ("res_step", "res_step"),
    ("seed", "seed"),
    ("cluster_method", "cluster_method"),
    ("min_coverage", "min_coverage"),
    ("min_purity", "min_purity"),
    ("stable_fraction", "stable_fraction"),
)


def _build_single(args: argparse.Namespace) -> Descriptor:
    """Assemble a Descriptor from single-case flags."""
    entry: dict[str, object] = {
        "caseId": args.case,
        "foil": args.foil,
        "unit": args.unit,
        "grouping": args.grouping,
        "nuisance": args.nuisance,
        "state_col": args.state_col,
        "focus_gene": args.focus_gene,
        "spurious": args.spurious,
    }
    if args.stable is not None:
        entry["stable"] = args.stable
    for attr, key in _OVERRIDES:
        val = getattr(args, attr, None)
        if val is not None:
            entry[key] = val
    # base_dir empty: a relative foil path resolves against the current directory.
    return descriptor_from_dict(entry, base_dir="")


def _write_case(out_dir: str, case: dict) -> str:
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, f"{case['caseId']}.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(case, fh, indent=2)
        fh.write("\n")
    return path


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m redline.oracle",
        description="Independent answer key for the four rigor checks.",
    )
    p.add_argument("--manifest", help="foils manifest JSON; runs every case it lists")
    p.add_argument("--case", default="A", help="case id for single-case mode (default: A)")
    p.add_argument("--foil", help="path to the foil .h5ad")
    p.add_argument("--unit", help="obs column that is the biological unit (donor/patient)")
    p.add_argument("--grouping", help="obs column being compared (condition/treatment)")
    p.add_argument("--nuisance", help="technical obs column (lane/batch)")
    p.add_argument("--spurious", help="cell-state group treated as the tracked spurious group")
    p.add_argument("--stable", help="cell-state group treated as the stable group (optional)")
    p.add_argument("--state-col", dest="state_col", help="obs column holding the cell-state labels")
    p.add_argument("--focus-gene", dest="focus_gene", help="gene audited by check 1")
    p.add_argument("--out", default="cache/oracle", help="output directory (default: cache/oracle)")
    # Optional tuning overrides.
    p.add_argument("--markers", help="comma-separated marker genes for check 2")
    p.add_argument("--markers-k", dest="markers_k", type=int, help="default marker count when none given")
    p.add_argument("--split", type=float, help="count-split fraction eps (default 0.5)")
    p.add_argument("--alpha", type=float, help="significance level for check 1 (default 0.05)")
    p.add_argument("--res-min", dest="res_min", type=float, help="min clustering resolution (default 0.2)")
    p.add_argument("--res-max", dest="res_max", type=float, help="max clustering resolution (default 2.0)")
    p.add_argument("--res-step", dest="res_step", type=float, help="resolution step (default 0.2)")
    p.add_argument("--seed", type=int, help="random seed for thinning and clustering (default 0)")
    p.add_argument(
        "--cluster-method",
        dest="cluster_method",
        choices=["leiden", "kmeans"],
        help="clustering backend for check 3 (default leiden, KMeans fallback)",
    )
    p.add_argument("--min-coverage", dest="min_coverage", type=float, help="check 3 coverage floor (default 0.5)")
    p.add_argument("--min-purity", dest="min_purity", type=float, help="check 3 purity floor (default 0.5)")
    p.add_argument(
        "--stable-fraction",
        dest="stable_fraction",
        type=float,
        help="check 3 present-fraction for a clean verdict (default 0.8)",
    )
    p.add_argument("--quiet", action="store_true", help="write files without printing the JSON")
    return p


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = _parser()
    args = parser.parse_args(argv)

    if args.manifest:
        descriptors = load_manifest(args.manifest)
    else:
        missing = [f for f in _REQUIRED_SINGLE if getattr(args, f) is None]
        if missing:
            parser.error("single-case mode needs: " + ", ".join("--" + m.replace("_", "-") for m in missing))
        descriptors = [_build_single(args)]

    rc = 0
    for d in descriptors:
        try:
            case = run_case(d)
        except Exception as exc:  # one bad case must not sink the rest
            rc = 1
            sys.stderr.write(f"[oracle] case {d.case_id!r} failed: {exc}\n")
            continue
        path = _write_case(args.out, case)
        sys.stderr.write(f"[oracle] wrote {path}\n")
        if not args.quiet:
            print(json.dumps(case, indent=2))
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
