"""Shared constants, paths, and thresholds for the detection benchmark.

Everything tunable lives here so a re-run is one file to read. The labeler
thresholds below define when each error is "present" for ground-truth purposes.
They mirror the engine's own decision boundaries (the labeler is a separate
implementation but not a method-independent one), so agreement between the
labeler and the engine is a consistency check, not a tautology-free validation.
See ``bench.labeler`` for the honest accounting of what is definitional by
construction (pillars 1 and 4) versus what retains some independence (pillars 2
and 3).
"""

from __future__ import annotations

import os

# ── The four error classes (the four pillars) ────────────────────────────────
# key -> (checkId, short name, one-line description of the failure mode)
PILLARS: dict[str, tuple[int, str, str]] = {
    "pseudoreplication": (1, "Pseudoreplication",
                          "cells from a few donors tested as independent samples"),
    "double_dipping": (2, "Double dipping",
                       "markers tested on the same cells used to define the cluster"),
    "fragility": (3, "Clustering fragility",
                  "a state that exists only at one clustering resolution"),
    "confounding": (4, "Technical confounding",
                    "the biological comparison is collinear with a technical variable"),
}
# canonical order and reverse maps
PILLAR_KEYS: list[str] = list(PILLARS)
CHECK_OF: dict[str, int] = {k: v[0] for k, v in PILLARS.items()}
KEY_OF_CHECK: dict[int, str] = {v[0]: k for k, v in PILLARS.items()}

# ── Bedrock model (same model powers both arms; only the scaffolding differs) ─
# Opus 4.6 is the strongest model this account can invoke; using it gives the
# baseline its best honest shot. Override with REDLINE_BENCH_MODEL.
DEFAULT_MODEL = os.environ.get("REDLINE_BENCH_MODEL", "us.anthropic.claude-opus-4-6-v1")
AWS_REGION = os.environ.get("AWS_REGION", os.environ.get("AWS_DEFAULT_REGION", "us-east-1"))
ANTHROPIC_BEDROCK_VERSION = "bedrock-2023-05-31"
LLM_TEMPERATURE = 0.0          # as deterministic as the API allows; still recorded
LLM_MAX_TOKENS = 1600
LLM_CONCURRENCY = int(os.environ.get("REDLINE_BENCH_CONCURRENCY", "3"))

# ── Paths ────────────────────────────────────────────────────────────────────
BENCH_DIR = os.path.dirname(os.path.abspath(__file__))
CASES_DIR = os.path.join(BENCH_DIR, "cases")
TRANSCRIPTS_DIR = os.path.join(BENCH_DIR, "transcripts")
RESULTS_DIR = os.path.join(BENCH_DIR, "results")
MANIFEST_PATH = os.path.join(CASES_DIR, "manifest.json")
LABELS_PATH = os.path.join(CASES_DIR, "labels.json")
TRANSCRIPT_PATH = os.path.join(TRANSCRIPTS_DIR, "llm_calls.jsonl")
RESULTS_PATH = os.path.join(RESULTS_DIR, "results.json")
REPORT_PATH = os.path.join(RESULTS_DIR, "report.md")

# ── Benchmark set shape ──────────────────────────────────────────────────────
# Per pillar we build POSITIVE cases (the error is present) and NEGATIVE cases
# (the error is absent, same analysis method), plus fully-clean whole-analysis
# controls. Distinct per-(family, polarity) seed bases so a tweak to one family
# never silently perturbs another.
N_PER_CELL = int(os.environ.get("REDLINE_BENCH_N", "6"))   # cases per (pillar, polarity)
N_CLEAN_CONTROLS = int(os.environ.get("REDLINE_BENCH_CLEAN", "4"))
SEED_BASE: dict[str, int] = {
    "pseudoreplication": 1000,
    "double_dipping": 2000,
    "fragility": 3000,
    "confounding": 4000,
    "clean_control": 9000,
}
# offset added for the negative (clean) polarity of a pillar family
NEG_SEED_OFFSET = 500

# ── Statistical decisions (shared alpha) ─────────────────────────────────────
ALPHA = 0.05

# ── Independent labeler thresholds (ground-truth definitions) ────────────────
# Pillar 1: cell-level test significant but per-unit (pseudobulk) test not.
P1_CELL_SIG = ALPHA           # cell-level p below this => inflated significance
P1_UNIT_NULL = ALPHA          # unit-level p at/above this => collapses on aggregation
# Pillar 2: top-k claimed markers, discovery AUC vs held-out AUC on a count split.
P2_SPLIT_EPS = 0.5
P2_TOP_K = 4
P2_COLLAPSE_AUC = 0.60        # held-out mean-marker AUC at/below => markers collapse
P2_HOLD_AUC = 0.62            # held-out AUC at/above => markers genuinely hold
P2_MIN_HELDOUT = 20           # cells needed on the held-out side to judge
# Pillar 3: k-sweep persistence of the claimed state.
P3_K_GRID = (2, 3, 4, 5, 6, 7, 8)
P3_PRESENT_COVER = 0.5        # a state is "present" at a k if best cluster covers >= this
P3_PRESENT_PURITY = 0.5       # ... and is at least this pure
P3_FRAGILE_STAB = 0.5         # present in < this fraction of settings => fragile
P3_STABLE_STAB = 0.8          # present in >= this fraction => stable
P3_POS_STAB_MAX = 0.45        # generate-and-filter: a fragile case needs a clear margin
# Pillar 4: Cramer's V between the comparison and the technical column.
P4_CONFOUND_V = 0.80          # V at/above => inseparable (confounded)
P4_SEPARABLE_V = 0.50         # V below => separable

# Generate-and-filter margins: a generated case is accepted only if the labeler
# shows a clear margin for its intended pattern, so labels are unambiguous.
P1_POS_CELL_MAX = 1e-4        # positive P1: cell p must be at least this small
P1_POS_UNIT_MIN = 0.15        # ... and unit p at least this large
P1_NEG_UNIT_MAX = 0.05        # negative P1: unit p must be significant (real effect)
