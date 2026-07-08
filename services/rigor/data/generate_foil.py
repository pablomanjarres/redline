#!/usr/bin/env python3
"""Generate a naive foil (or a clean variant) from any single-cell dataset.

This is the CLI for Add-on 4. It reads a dataset, lets the planner choose a
believable naive analysis, plants the flaw, writes the foil, and runs the real
engine to confirm the verdict. The ground truth is printed as JSON and, in batch
mode, collected into a manifest the four-check harness and the oracle read.

    # one dataset, plant all four flaws
    python -m data.generate_foil --input cache/base/immune.h5ad --out cache/foils/immune.foil.h5ad

    # a genuinely clean variant (Case C)
    python -m data.generate_foil --input cache/base/immune.h5ad --out cache/foils/immune.clean.h5ad --clean

    # one targeted flaw
    python -m data.generate_foil --input data.h5ad --out foil.h5ad --flaw confounding

    # build the bundled demonstration set (three presets x {foil, clean}) + manifest
    python -m data.generate_foil --demo --out cache/foils/

The planner defaults to 'auto': Claude via Bedrock when AWS credentials and
REDLINE_BEDROCK_MODEL_ID are set, otherwise the deterministic heuristic. The
heuristic is the reproducible default and needs no network.

Real and runnable. The heavy checks (PyDESeq2, Leiden) run at verify time.
"""

from __future__ import annotations

import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_OUT_DIR = os.path.join(os.path.dirname(HERE), "cache", "foils")
DEFAULT_BASE_DIR = os.path.join(os.path.dirname(HERE), "cache", "base")


def eprint(*args: object) -> None:
    print(*args, file=sys.stderr, flush=True)


def _demo(args: argparse.Namespace) -> int:
    """Build every preset base and generate a foil plus a clean variant for each,
    then write a manifest. This is the fixtures-at-volume and prevalence-study
    entry point in miniature."""
    from data.base_datasets import PRESETS, write_base
    from redline.foilgen import generate_foil, write_manifest

    out_dir = args.out or DEFAULT_OUT_DIR
    os.makedirs(out_dir, exist_ok=True)
    entries = []
    for preset in sorted(PRESETS):
        base = os.path.join(DEFAULT_BASE_DIR, f"{preset}.h5ad")
        write_base(preset, base, seed=args.seed)
        for clean in (False, True):
            tag = "clean" if clean else "foil"
            out = os.path.join(out_dir, f"{preset}.{tag}.h5ad")
            eprint(f"generating {preset} {tag}...")
            gt = generate_foil(base, out, flaw="all", clean=clean, seed=args.seed,
                               backend=args.planner, verify=not args.no_verify)
            ok = gt.verification.get("allMatch") if gt.verification else None
            eprint(f"  {preset} {tag}: verified={ok} engine={json.dumps(gt.verification.get('engine', {}))}")
            entries.append(gt.to_manifest_entry())
    manifest = os.path.join(out_dir, "manifest.json")
    write_manifest(entries, manifest)
    eprint(f"wrote manifest: {manifest} ({len(entries)} cases)")
    print(manifest)
    return 0


def _single(args: argparse.Namespace) -> int:
    from redline.foilgen import generate_foil

    if not args.input:
        eprint("generate_foil: --input is required (or use --demo).")
        return 2
    out = args.out or os.path.join(DEFAULT_OUT_DIR, "foil.h5ad")
    gt = generate_foil(
        args.input,
        out,
        flaw=args.flaw,
        clean=args.clean,
        seed=args.seed,
        backend=args.planner,
        case_id=args.case_id,
        scenario_id=args.scenario,
        verify=not args.no_verify,
    )
    entry = gt.to_manifest_entry()
    if args.manifest:
        from redline.foilgen import write_manifest

        write_manifest([entry], args.manifest)
        eprint(f"wrote manifest: {args.manifest}")
    print(json.dumps(entry, indent=2))
    if gt.verification and not gt.verification.get("allMatch", True):
        eprint(f"WARNING: engine did not return the intended verdicts: {gt.verification.get('mismatches')}")
        return 1
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        prog="generate_foil",
        description="Manufacture a realistic naive foil (or clean variant) on any single-cell dataset.",
    )
    p.add_argument("--input", default=None, help="input .h5ad dataset to build the foil on.")
    p.add_argument("--out", default=None, help="output .h5ad (or output dir in --demo mode).")
    p.add_argument("--flaw", default="all",
                   choices=["all", "pseudoreplication", "double_dipping", "fragility", "confounding"],
                   help="which flaw(s) to plant (default all four).")
    p.add_argument("--clean", action="store_true", help="build a genuinely clean variant (Case C) instead.")
    p.add_argument("--planner", default="auto", choices=["auto", "bedrock", "heuristic"],
                   help="claim planner backend (default auto: Bedrock when configured, else heuristic).")
    p.add_argument("--seed", type=int, default=0, help="random seed (deterministic foils).")
    p.add_argument("--scenario", default=None, help="scenario id for the manifest (default inferred).")
    p.add_argument("--case-id", dest="case_id", default=None, help="case id for the manifest (default inferred).")
    p.add_argument("--manifest", default=None, help="also write a one-case manifest to this path.")
    p.add_argument("--no-verify", action="store_true", help="skip the engine verification step.")
    p.add_argument("--demo", action="store_true", help="build the bundled preset demonstration set + manifest.")
    args = p.parse_args(argv)

    try:
        return _demo(args) if args.demo else _single(args)
    except SystemExit:
        raise
    except Exception as exc:  # surface a clean failure
        eprint(f"generate_foil: {type(exc).__name__}: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
