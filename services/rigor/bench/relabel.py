"""Recompute ``labels.json`` from the committed cases, without regenerating them.

The generator plants the flaws and tunes each case against the labeler, then
freezes the ``.h5ad`` files. When the labeler's method changes, the cases do not
have to change with it: the truth is whatever the labeler says about the frozen
data. This entrypoint recomputes that truth in place.

It refuses to write a labels file that would quietly move the benchmark:

  * the truth vector of every case must be unchanged, and
  * every accepted case must still clear the generate-and-filter margin
    (``spec.P3_POS_STAB_MAX`` and friends), so no case sits on a knife edge.

Either violation is printed and the file is left alone. A real change in the
truth vector means the cases need regenerating (``python -m bench.generate``),
not relabeling.

    python -m bench.relabel            # check and rewrite labels.json
    python -m bench.relabel --check    # check only, write nothing
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any

import anndata as ad
import numpy as np

from . import labeler, spec


def _truth_of(adata: Any, claim: dict) -> dict[str, Any]:
    counts = np.asarray(adata.layers["counts"])
    obs = {c: adata.obs[c].to_numpy() for c in adata.obs.columns}
    return labeler.label_case(counts, list(adata.var_names), obs, claim)


def _margin_ok(case_id: str, lab: dict) -> tuple[bool, str]:
    """The generate-and-filter margins, re-checked on the frozen case."""
    frag = lab["fragility"]["stability"]
    if case_id.startswith(("spurious_state_pos", "continuum_pos")):
        if frag > spec.P3_POS_STAB_MAX:
            return False, f"fragility stability {frag} > {spec.P3_POS_STAB_MAX}"
    elif lab["truth"]["fragility"] is False:
        if frag < spec.P3_STABLE_STAB:
            return False, f"clean fragility stability {frag} < {spec.P3_STABLE_STAB}"
    return True, ""


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true", help="verify only; do not write")
    args = ap.parse_args(argv)

    manifest = json.load(open(spec.MANIFEST_PATH, encoding="utf-8"))
    old = json.load(open(spec.LABELS_PATH, encoding="utf-8"))
    cases = manifest["cases"]
    if isinstance(cases, list):
        cases = {c["case_id"]: c for c in cases}

    labels: dict[str, Any] = {}
    truth_changes: list[str] = []
    margin_fails: list[str] = []

    for cid, case in cases.items():
        path = os.path.join(spec.CASES_DIR, f"{cid}.h5ad")
        lab = _truth_of(ad.read_h5ad(path), case["claim"])

        if lab["truth"] != old[cid]["truth"]:
            diff = {k: (old[cid]["truth"][k], lab["truth"][k])
                    for k in lab["truth"] if old[cid]["truth"][k] != lab["truth"][k]}
            truth_changes.append(f"{cid}: {diff}")

        ok, why = _margin_ok(cid, lab)
        if not ok:
            margin_fails.append(f"{cid}: {why}")

        labels[cid] = {
            "truth": lab["truth"],
            "stats": {k: {kk: vv for kk, vv in lab[k].items() if kk != "present"}
                      for k in spec.PILLAR_KEYS},
        }

    print(f"relabeled {len(labels)} cases with {spec.__name__.rsplit('.', 1)[0]}.labeler")
    if truth_changes:
        print(f"\nTRUTH CHANGED on {len(truth_changes)} case(s). The cases no longer match "
              f"the labeler; regenerate them instead of relabeling:", file=sys.stderr)
        for line in truth_changes:
            print(f"  {line}", file=sys.stderr)
    if margin_fails:
        print(f"\nMARGIN LOST on {len(margin_fails)} case(s); they are now borderline:", file=sys.stderr)
        for line in margin_fails:
            print(f"  {line}", file=sys.stderr)
    if truth_changes or margin_fails:
        print("\nlabels.json NOT written.", file=sys.stderr)
        return 1

    print("truth vector unchanged on every case; every case still clears its margin")
    if args.check:
        print("--check: labels.json left alone")
        return 0

    with open(spec.LABELS_PATH, "w", encoding="utf-8") as fh:
        json.dump(labels, fh, indent=2)
    print(f"wrote {spec.LABELS_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
