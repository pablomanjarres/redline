"""Redline correctness oracle: an independent answer key for the four checks.

This package recomputes the authoritative expected result for each of the four
rigor checks straight from a foil ``.h5ad`` plus a small case descriptor. It is a
clean-room reimplementation of the statistics. It never imports
``redline.pillars``, ``redline.audit``, or ``redline.job_runner``, so when the
app engine and this oracle agree, the agreement is a real cross-check rather than
the same code compared against itself.

Public surface:

- ``Descriptor`` / ``load_manifest`` (see ``redline.oracle.descriptor``): the
  per-case column map (unit, grouping, nuisance, spurious/stable cell-state
  groups, focus gene) and the manifest reader.
- ``run_case`` (see ``redline.oracle.checks``): load the foil, run all four
  checks, and return ``{caseId, checks: {"1":..,"2":..,"3":..,"4":..}}``.

Run it as a module::

    python -m redline.oracle --case A --foil path/to.h5ad \
        --unit donor_id --grouping condition --nuisance lane \
        --spurious Effector --stable Naive --state-col cell_state \
        --focus-gene FOXP3 --out cache/oracle

    python -m redline.oracle --manifest cache/foils/manifest.json --out cache/oracle
"""

from __future__ import annotations

from .checks import run_case
from .descriptor import Descriptor, load_manifest

__all__ = ["Descriptor", "load_manifest", "run_case"]
