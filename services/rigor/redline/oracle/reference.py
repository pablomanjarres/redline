"""A small, seeded synthetic foil the confidence-interval layer can actually run.

The full Marson matrix is 1.7 TB and cannot repeat a stochastic check hundreds of
times in CI. This builds a compact, fully seeded ``.h5ad`` with the same structure
the pillars audit, carrying two planted groups:

- ``Naive`` — a REAL subpopulation with a coherent marker program. Its markers
  separate it in and out of sample, and it forms a discrete cluster across the
  resolution sweep. Check 2 clears it and Check 3 reports it stable.
- ``Effector`` — a SPURIOUS group with almost no coherent program. Markers chosen
  on a discovery half overfit and collapse out of sample, and it only coalesces
  into a discrete cluster inside a narrow resolution band. Check 2 flags it and
  Check 3 reports it fragile.

Nothing here is hardcoded into a pillar. The foil is a reproducible substrate for
the interval capability: repeat the stochastic step over the seeds, and the spread
of the results is a real interval, reproducible because the substrate is seeded.
The planted groups are honest by construction (the spurious one carries no real
program), which is the same discipline the Marson naive foil uses.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np


@dataclass
class ReferenceSpec:
    """Knobs for the synthetic reference foil. Defaults give the two planted groups."""

    seed: int = 0
    n_cells: int = 2400
    n_genes: int = 240
    n_naive: int = 700  # a real, stable subpopulation
    n_effector: int = 450  # a spurious, fragile group
    naive_markers: int = 18  # genes carrying the real Naive program
    effector_markers: int = 6  # genes nominally "defining" the spurious group
    naive_mult: float = 3.0  # Naive marker rate multiplier (strong, real)
    effector_mult: float = 1.0  # Effector carries NO real program: a pure double-dipping artifact
    size_sigma: float = 0.08  # per-cell size-factor spread; small so a null group has no library-size signal to leak


def build_reference_foil(spec: ReferenceSpec | None = None, **overrides: Any) -> Any:
    """Build the seeded reference ``AnnData``. Deterministic in ``spec.seed``.

    Requires anndata + pandas (the heavy stats extra). Returns an object with raw
    integer counts in ``layers['counts']`` and ``.X``, the resolved obs columns,
    and a provenance block in ``uns['redline_ci_reference']``.
    """
    import anndata as ad
    import pandas as pd

    spec = spec or ReferenceSpec()
    if overrides:
        spec = ReferenceSpec(**{**spec.__dict__, **overrides})

    rng = np.random.default_rng(int(spec.seed))
    n, g = int(spec.n_cells), int(spec.n_genes)

    # Gene baseline rates (a realistic spread) and per-cell size factors.
    base_rate = np.exp(rng.normal(0.4, 0.8, size=g)).clip(0.05, 12.0)
    size_factor = np.exp(rng.normal(0.0, float(spec.size_sigma), size=n)).clip(0.4, 3.0)

    # Assign the two planted groups across a shuffled index so the states are not
    # confounded with donor or condition (those are set independently below).
    order = rng.permutation(n)
    naive_idx = order[: spec.n_naive]
    effector_idx = order[spec.n_naive : spec.n_naive + spec.n_effector]
    state = np.array(["Bulk"] * n, dtype=object)
    state[naive_idx] = "Naive"
    state[effector_idx] = "Effector"

    rate = size_factor[:, None] * base_rate[None, :]
    naive_cols = np.arange(0, spec.naive_markers)
    eff_cols = np.arange(spec.naive_markers, spec.naive_markers + spec.effector_markers)
    rate[np.ix_(naive_idx, naive_cols)] *= float(spec.naive_mult)
    rate[np.ix_(effector_idx, eff_cols)] *= float(spec.effector_mult)

    counts = rng.poisson(rate).astype(np.int64)

    # Independent design columns: 4 donors, condition aligned to donor, lane aligned
    # to condition (a clean Check-4 confound), all orthogonal to the planted states.
    donor = np.array([f"D{i % 4 + 1}" for i in range(n)])
    donor = donor[rng.permutation(n)]
    condition = np.where(np.isin(donor, ["D1", "D2"]), "non-targeting", "IL2RA-KD")
    lane = np.where(condition == "non-targeting", "Lane-A", "Lane-B")

    var_names = [f"G{j:03d}" for j in range(g)]
    obs = pd.DataFrame(
        {
            "donor_id": pd.Categorical(donor),
            "condition": pd.Categorical(condition),
            "lane": pd.Categorical(lane),
            "cell_state": pd.Categorical(state.astype(str)),
        },
        index=[f"cell{i:05d}" for i in range(n)],
    )

    adata = ad.AnnData(X=counts.astype(np.float32), obs=obs)
    adata.var_names = var_names
    adata.layers["counts"] = counts
    adata.uns["redline_ci_reference"] = {
        "seed": int(spec.seed),
        "n_cells": n,
        "n_genes": g,
        "naive_markers": [var_names[j] for j in naive_cols],
        "effector_markers": [var_names[j] for j in eff_cols],
        "planted": {"Naive": "real, stable", "Effector": "spurious, fragile"},
    }
    return adata


def naive_marker_names(spec: ReferenceSpec | None = None) -> list[str]:
    spec = spec or ReferenceSpec()
    return [f"G{j:03d}" for j in range(spec.naive_markers)]
