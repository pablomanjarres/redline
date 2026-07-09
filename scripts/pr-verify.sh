#!/usr/bin/env bash
#
# The machine-checkable done-condition for a PR.
#
# Every gate here is an exit code, never a judgement. The loop that calls this
# script may not merge a PR until this script exits 0.
#
# The load-bearing gate is `assert_real_stack`. `services/rigor`'s [stats] extra
# once shipped scanpy without leidenalg. scanpy imports leidenalg lazily inside
# sc.tl.leiden, a bare `except Exception:` swallowed the ModuleNotFoundError, and
# every clustering call silently ran KMeans. Three real bugs lived behind that for
# months, and the test named test_pillar3_runs_real_leiden_sweep passed the whole
# time without ever running Leiden. A test suite that runs against fallbacks
# verifies the fallbacks.
#
#   usage: scripts/pr-verify.sh [--skip-slow]
#   exit 0  every gate passed
#   exit 1  a gate failed (stdout says which)
#   exit 2  the environment is not fit to judge (dependency missing, no network)

set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RIGOR_DIR="$REPO_ROOT/services/rigor"
VENV="$RIGOR_DIR/.venv"
SKIP_SLOW=0
[[ "${1:-}" == "--skip-slow" ]] && SKIP_SLOW=1

FAILURES=""   # newline-delimited. bash 3.2 cannot expand an empty array under set -u.

log()  { printf '[pr-verify] %s\n' "$*"; }
pass() { printf '[pr-verify]   PASS  %s\n' "$*"; }
fail() { printf '[pr-verify]   FAIL  %s\n' "$*"; FAILURES="${FAILURES}${1}"$'\n'; }
die()  { printf '[pr-verify] ABORT %s\n' "$*" >&2; exit 2; }

# ── preflight: abort before doing any work ───────────────────────────────────
preflight() {
  command -v pnpm >/dev/null || die "pnpm not on PATH"
  command -v uv   >/dev/null || die "uv not on PATH"
  [[ -d "$RIGOR_DIR" ]]      || die "no services/rigor at $RIGOR_DIR"

  # A fresh worktree has no node_modules. Installing them is setup, not a gate:
  # a typecheck that fails because nothing is installed says nothing about the PR.
  # An unfit environment is exit 2, never a failing PR.
  if [[ ! -d "$REPO_ROOT/node_modules" ]]; then
    log "installing node dependencies (fresh worktree)"
    (cd "$REPO_ROOT" && pnpm install --frozen-lockfile >/dev/null 2>&1) \
      || die "pnpm install failed; this box cannot judge the PR"
  fi
  log "preflight ok"
}

# ── the gate that would have caught everything ───────────────────────────────
assert_real_stack() {
  log "installing services/rigor[stats,dev] and asserting the real stack imports"
  [[ -x "$VENV/bin/python" ]] || uv venv --python 3.12 "$VENV" >/dev/null 2>&1
  VIRTUAL_ENV="$VENV" uv pip install -e "$RIGOR_DIR[stats,dev]" >/dev/null 2>&1 \
    || { fail "pip install of [stats,dev] failed"; return; }

  if "$VENV/bin/python" - <<'PY'
import importlib.util as u, sys
required = ("scanpy", "leidenalg", "igraph", "pydeseq2", "decoupler", "sklearn")
missing = [m for m in required if not u.find_spec(m)]
if missing:
    sys.exit(f"[stats] did not install: {missing}")

# Presence is not enough. scanpy imports leidenalg lazily, so prove leiden runs.
import warnings; warnings.filterwarnings("ignore")
import anndata as ad, numpy as np, scanpy as sc
a = ad.AnnData(X=np.random.default_rng(0).normal(size=(60, 6)))
sc.pp.neighbors(a, use_rep="X", n_neighbors=10)
sc.tl.leiden(a, resolution=1.0, key_added="k", random_state=0)
if a.obs["k"].nunique() < 1:
    sys.exit("leiden produced no clusters")
PY
  then pass "real statistical stack imports and sc.tl.leiden partitions a graph"
  else fail "the real statistical stack is not usable; the engine would silently fall back"
  fi
}

# ── the engine must not silently degrade at runtime either ───────────────────
assert_no_silent_degrade() {
  log "asserting the pillars report the engine they actually ran"
  if "$VENV/bin/python" - <<'PY'
import warnings, sys; warnings.filterwarnings("ignore")
import numpy as np
from redline.pillars import double_dipping as dd

rng = np.random.default_rng(0)
X = rng.poisson(4, size=(400, 40)).astype(float)
X[np.ix_(np.arange(150), np.arange(5))] += rng.poisson(14, size=(150, 5))

labels, engine, _res = dd._recluster_train(X, k=2, seed=0)
if engine != "Leiden (scanpy)":
    sys.exit(f"pillar 2 discovery clustering degraded to: {engine!r}")
if int(np.unique(labels).size) != 2:
    sys.exit(f"leiden ignored the requested k: got {np.unique(labels).size} clusters")
PY
  then pass "pillar 2 runs leiden at the k the claim implies, and names its engine"
  else fail "a pillar degraded silently, or leiden ignored k"
  fi
}

# ── ordinary gates ───────────────────────────────────────────────────────────
gate_typecheck() {
  log "pnpm typecheck"
  if (cd "$REPO_ROOT" && pnpm exec turbo typecheck --force >/dev/null 2>&1)
  then pass "typecheck"; else fail "typecheck"; fi
}

gate_js_tests() {
  log "pnpm test"
  if (cd "$REPO_ROOT" && pnpm test >/dev/null 2>&1)
  then pass "js tests"; else fail "js tests"; fi
}

gate_pytest() {
  local args=(-q)
  (( SKIP_SLOW )) && args+=(-m "not slow")
  log "pytest ${args[*]}"
  if (cd "$RIGOR_DIR" && "$VENV/bin/python" -m pytest "${args[@]}" >/dev/null 2>&1)
  then pass "pytest"; else fail "pytest"; fi
}

# ── honesty invariants the product asserts about itself ──────────────────────
gate_no_em_dashes_in_new_prose() {
  log "checking for em dashes in prose this branch adds"
  local base="${PR_BASE:-main}" hits
  hits="$(cd "$REPO_ROOT" && git diff "$base"...HEAD -- '*.md' '*.ts' '*.tsx' '*.py' 2>/dev/null \
          | grep -E '^\+' | grep -c '—' || true)"
  if [[ "${hits:-0}" -eq 0 ]]
  then pass "no em dashes added"
  else fail "this branch adds $hits line(s) containing an em dash"
  fi
}

main() {
  preflight

  # Cheap gates first. A loop that ticks every 10 minutes must not spend 25 of
  # them installing a scientific Python stack to discover a typo.
  gate_no_em_dashes_in_new_prose
  gate_typecheck
  gate_js_tests

  # The expensive half. The engine and test gates are meaningless if the real
  # stack is absent: they would be measuring the fallbacks. Skip and say so,
  # rather than emit a green that means nothing.
  assert_real_stack
  if [[ "$FAILURES" != *"stack"* ]]; then
    assert_no_silent_degrade
    gate_pytest
  else
    log "  SKIP  engine + pytest gates: the real stack is unusable, a pass here would be meaningless"
  fi

  echo
  if [[ -z "$FAILURES" ]]; then
    log "ALL GATES PASSED"
    exit 0
  fi
  printf '[pr-verify] FAILED GATES:\n%s' "$FAILURES"
  exit 1
}

main "$@"
