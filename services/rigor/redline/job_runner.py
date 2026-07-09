"""Redline Cloud Run / RemoteTarget job runner.

Reads a job spec as JSON (from ``--spec FILE`` or stdin), runs one rigor check
over an ``.h5ad``, and prints the resulting ``ComputeResult`` as camelCase JSON
to stdout. Wired as the ``redline-job`` entry point (see ``pyproject.toml``).

Job spec shape (matches the TS ``ComputeInput`` the web app sends)::

    {"h5ad": "...", "checkId": 1, "config": {...}, "fields": [ ... ]}

``fields`` is optional; when it is absent the runner resolves the obs columns
first via the foundation step. Only the final ``ComputeResult`` JSON is written
to stdout (one line, no trailing noise), so a caller can ``JSON.parse`` stdout
directly. Everything else (warnings, engine chatter) is routed to stderr.

This module also holds the shared engine bridge used by ``mcp_server`` so the
load-AnnData / resolve-engine / JSON-normalize logic lives in exactly one place
and the Cloud Run image never has to pull in the MCP SDK.
"""

from __future__ import annotations

import argparse
import contextlib
import importlib
import json
import math
import os
import sys
import threading
from dataclasses import asdict, is_dataclass
from typing import Any

try:  # numpy is a base dependency, but stay importable if it is ever missing.
    import numpy as _np
except Exception:  # pragma: no cover - defensive
    _np = None


# ── stdout hygiene ────────────────────────────────────────────────────────────
# The engine may print. On the job runner that would corrupt the single JSON
# line a caller parses; on the MCP server it would corrupt the stdio protocol.
# We divert stdout to stderr around every engine call. A reentrant lock keeps
# the process-global swap safe when tools run on worker threads (and lets the
# nested load_adata call re-enter without deadlocking).
_QUIET_LOCK = threading.RLock()


@contextlib.contextmanager
def _quiet_stdout():
    with _QUIET_LOCK:
        saved = sys.stdout
        sys.stdout = sys.stderr
        try:
            yield
        finally:
            sys.stdout = saved


# ── engine resolution (lazy, tolerant of small naming differences) ────────────
_ENGINE_RUN: Any = None
_ENGINE_FIELDS: Any = None


def _engine_run_check():
    """Locate ``redline.audit.run_check(check_id, adata_or_path, config, fields)``."""
    global _ENGINE_RUN
    if _ENGINE_RUN is not None:
        return _ENGINE_RUN
    candidates: list[Any] = []
    try:
        audit_mod = importlib.import_module("redline.audit")
    except ImportError:
        audit_mod = None
    if audit_mod is not None:
        candidates += [getattr(audit_mod, n, None) for n in ("run_check", "audit", "run", "check")]
        if callable(audit_mod):
            candidates.append(audit_mod)
    try:
        pkg = importlib.import_module("redline")
        candidates += [getattr(pkg, n, None) for n in ("run_check", "audit")]
    except ImportError:
        pass
    for fn in candidates:
        if callable(fn):
            _ENGINE_RUN = fn
            return fn
    raise RuntimeError(
        "Could not find the rigor run-check entry point. Expected "
        "redline.audit.run_check(check_id, adata_or_path, config, fields)."
    )


def _engine_resolve_fields():
    """Locate ``redline.foundation.resolve_fields(adata_or_path)``."""
    global _ENGINE_FIELDS
    if _ENGINE_FIELDS is not None:
        return _ENGINE_FIELDS
    candidates: list[Any] = []
    try:
        found_mod = importlib.import_module("redline.foundation")
    except ImportError:
        found_mod = None
    if found_mod is not None:
        candidates += [
            getattr(found_mod, n, None)
            for n in ("resolve_fields", "infer_fields", "resolve", "fields")
        ]
        if callable(found_mod):
            candidates.append(found_mod)
    try:
        pkg = importlib.import_module("redline")
        candidates += [getattr(pkg, n, None) for n in ("resolve_fields", "infer_fields")]
    except ImportError:
        pass
    for fn in candidates:
        if callable(fn):
            _ENGINE_FIELDS = fn
            return fn
    raise RuntimeError(
        "Could not find the foundation field resolver. Expected "
        "redline.foundation.resolve_fields(adata_or_path)."
    )


# ── AnnData loading (single-slot cache, keyed by path + mtime + size) ─────────
_ADATA_CACHE: dict[str, Any] = {}


def load_adata(h5ad: str) -> Any:
    """Read an ``.h5ad`` into an AnnData, reusing the last one loaded in-process.

    The cache holds a single object so the four pillar calls in one session do
    not re-read a multi-gigabyte file, without pinning several of them in memory.
    """
    import anndata  # lazy; heavy import

    path = os.path.abspath(os.path.expanduser(str(h5ad)))
    if not os.path.isfile(path):
        raise FileNotFoundError(f"h5ad file not found: {path}")
    stat = os.stat(path)
    key = f"{path}:{stat.st_mtime_ns}:{stat.st_size}"
    with _quiet_stdout():
        cached = _ADATA_CACHE.get("entry")
        if cached is not None and cached[0] == key:
            return cached[1]
        adata = anndata.read_h5ad(path)
        _ADATA_CACHE["entry"] = (key, adata)
        return adata


def _prepare_source(h5ad: str) -> Any:
    """A local ``.h5ad`` becomes a loaded AnnData; anything else (a remote URI)
    is handed to the engine untouched so it can open it however it opens it."""
    candidate = os.path.expanduser(str(h5ad))
    if os.path.isfile(candidate):
        return load_adata(candidate)
    return h5ad


# ── JSON normalization ────────────────────────────────────────────────────────
def _denumpy(obj: Any) -> Any:
    if _np is not None:
        if isinstance(obj, _np.generic):
            return obj.item()
        if isinstance(obj, _np.ndarray):
            return obj.tolist()
    return obj


def _jsonable(obj: Any) -> Any:
    """Coerce an engine return value into JSON-safe primitives.

    Passes plain dicts through (the engine is expected to emit camelCase dicts),
    unwraps numpy scalars/arrays, dataclasses, and pydantic models, and turns any
    non-finite float into ``null`` so the output is valid JSON (JS ``JSON.parse``
    rejects ``NaN``/``Infinity``; the contract makes such values nullable).
    """
    obj = _denumpy(obj)
    if obj is None or isinstance(obj, (str, bool, int)):
        return obj
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    dump = getattr(obj, "model_dump", None)  # pydantic v2
    if callable(dump):
        try:
            return _jsonable(dump(by_alias=True))
        except TypeError:
            return _jsonable(dump())
    if is_dataclass(obj) and not isinstance(obj, type):
        return _jsonable(asdict(obj))
    if isinstance(obj, dict):
        return {str(k): _jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple, set)):
        return [_jsonable(v) for v in obj]
    for meth in ("to_dict", "asdict"):
        conv = getattr(obj, meth, None)
        if callable(conv):
            try:
                return _jsonable(conv())
            except TypeError:
                pass
    return obj


def to_json(payload: Any) -> str:
    """Canonical, compact, single-line JSON. ``allow_nan=False`` asserts the
    sanitizer ran (JS ``JSON.parse`` rejects ``NaN``/``Infinity``)."""
    return json.dumps(
        _jsonable(payload), ensure_ascii=False, allow_nan=False, separators=(",", ":")
    )


# ── public compute helpers (shared with the MCP server) ───────────────────────
def resolve_fields(h5ad: str) -> list[Any]:
    """Run the foundation step for an ``.h5ad`` and return ``FieldSpec[]`` as
    JSON-safe dicts."""
    with _quiet_stdout():
        source = _prepare_source(h5ad)
        fields = _engine_resolve_fields()(source)
    return _jsonable(fields)


def compute_result(
    check_id: int, h5ad: str, config: Any, fields: Any | None = None
) -> dict[str, Any]:
    """Load the data, resolve fields if the caller did not supply them, run the
    check, and return the ``ComputeResult`` as a JSON-safe dict."""
    with _quiet_stdout():
        source = _prepare_source(h5ad)
        resolved = fields if fields is not None else _engine_resolve_fields()(source)
        result = _engine_run_check()(int(check_id), source, config, resolved)
    return _jsonable(result)


def inspect_dataset(h5ad: str) -> dict[str, Any]:
    """Thin inspection of an ``.h5ad`` (spec section 3): the obs columns and their
    types, the stored ``uns`` results (marker tables, DE results) with their genes
    and shape, the cluster label fields, and whether raw counts are present.

    Reuses the single-slot AnnData cache and the stdout diversion (``inspect`` is
    the intake step, so it runs before the checks and shares the same loaded
    object), and never loads the full expression matrix. Returns the
    ``DatasetInventory`` as a JSON-safe dict. ``inspect_h5ad`` is imported lazily
    so importing this module stays light for the Cloud Run and contract paths."""
    from redline.inspect import inspect_h5ad

    path = os.path.abspath(os.path.expanduser(str(h5ad)))
    with _quiet_stdout():
        adata = load_adata(h5ad)
        inventory = inspect_h5ad(adata, file=os.path.basename(path))
    return _jsonable(inventory)


# ── CLI ───────────────────────────────────────────────────────────────────────
def _read_spec(spec_path: str | None) -> dict[str, Any]:
    if spec_path and spec_path != "-":
        with open(os.path.expanduser(spec_path), "r", encoding="utf-8") as fh:
            raw = fh.read()
    else:
        raw = sys.stdin.read()
    raw = raw.strip()
    if not raw:
        raise ValueError("empty job spec (pass --spec FILE or pipe JSON on stdin)")
    spec = json.loads(raw)
    if not isinstance(spec, dict):
        raise ValueError("job spec must be a JSON object")
    return spec


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="redline-job",
        description="Run one Redline rigor check over an .h5ad and print the ComputeResult JSON.",
    )
    parser.add_argument(
        "--spec",
        default=None,
        help="Path to a job-spec JSON file. Reads stdin when omitted or set to '-'.",
    )
    args = parser.parse_args(argv)

    try:
        spec = _read_spec(args.spec)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"redline-job: bad job spec: {exc}", file=sys.stderr)
        return 2

    h5ad = spec.get("h5ad") or spec.get("path")
    check_id = spec.get("checkId", spec.get("check_id"))
    config = spec.get("config") or {}
    fields = spec.get("fields")

    if not h5ad:
        print("redline-job: job spec is missing 'h5ad'.", file=sys.stderr)
        return 2

    # The intake 'inspect' op reads the object's metadata (no check, no checkId).
    if spec.get("op") == "inspect":
        try:
            inventory = inspect_dataset(h5ad)
        except Exception as exc:  # surface a clean failure; never emit partial JSON
            print(f"redline-job: {type(exc).__name__}: {exc}", file=sys.stderr)
            return 1
        sys.stdout.write(to_json(inventory) + "\n")
        sys.stdout.flush()
        return 0

    try:
        check_id = int(check_id)
    except (TypeError, ValueError):
        print("redline-job: job spec 'checkId' must be one of 1, 2, 3, 4.", file=sys.stderr)
        return 2
    if check_id not in (1, 2, 3, 4):
        print("redline-job: job spec 'checkId' must be one of 1, 2, 3, 4.", file=sys.stderr)
        return 2

    try:
        result = compute_result(check_id, h5ad, config, fields)
    except Exception as exc:  # surface a clean failure; never emit partial JSON
        print(f"redline-job: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1

    sys.stdout.write(to_json(result) + "\n")
    sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
