"""Scoring for the detection benchmark.

Every metric is computed against the INDEPENDENT labeler's per-pillar ground
truth (``labels.json``), for three arms:

  baseline        one Claude call over the analysis write-up
  redline_raw     the four deterministic checks, no critic
  redline_critic  the four checks plus the LLM critic (the shipped pipeline)

For each arm we report, per error class and overall: detection rate (recall on
present errors), false-positive rate (flags on genuinely-clean pillars), and
balanced summaries (precision, F1, Youden's J). The false-positive rate is
reported as prominently as detection, and separately on the clean-control cases,
because a tool that flags everything scores high on detection and fails there.
"""

from __future__ import annotations

import json
from typing import Any

from . import spec

ARMS = ["baseline", "redline_raw", "redline_critic"]


def _confusion(per_case: dict, arm: str, pillar: str | None) -> dict[str, int]:
    tp = fp = fn = tn = 0
    for cid, rec in per_case.items():
        truth = rec["truth"]
        det = rec["arms"][arm]["detected"]
        keys = [pillar] if pillar else spec.PILLAR_KEYS
        for k in keys:
            t, d = bool(truth[k]), bool(det.get(k, False))
            if t and d:
                tp += 1
            elif t and not d:
                fn += 1
            elif not t and d:
                fp += 1
            else:
                tn += 1
    return {"tp": tp, "fp": fp, "fn": fn, "tn": tn}


def _rates(c: dict[str, int]) -> dict[str, Any]:
    tp, fp, fn, tn = c["tp"], c["fp"], c["fn"], c["tn"]
    pos, neg = tp + fn, fp + tn
    detection = tp / pos if pos else None
    fp_rate = fp / neg if neg else None
    precision = tp / (tp + fp) if (tp + fp) else None
    recall = detection
    f1 = (2 * precision * recall / (precision + recall)
          if precision and recall and (precision + recall) else (0.0 if pos else None))
    specificity = tn / neg if neg else None
    youden = (recall + specificity - 1) if (recall is not None and specificity is not None) else None
    return {
        **c, "n_pos": pos, "n_neg": neg,
        "detection": detection, "fp_rate": fp_rate,
        "precision": precision, "f1": f1, "youden_j": youden,
    }


def _clean_control_fp(per_case: dict, arm: str) -> dict[str, Any]:
    """False positives specifically on the fully-clean control cases."""
    n_pairs = flagged_pairs = 0
    n_cases = cases_with_flag = 0
    for cid, rec in per_case.items():
        if rec.get("family") != "clean_control":
            continue
        n_cases += 1
        det = rec["arms"][arm]["detected"]
        any_flag = False
        for k in spec.PILLAR_KEYS:
            n_pairs += 1
            if det.get(k):
                flagged_pairs += 1
                any_flag = True
        if any_flag:
            cases_with_flag += 1
    return {
        "n_control_cases": n_cases,
        "cases_with_any_flag": cases_with_flag,
        "case_fp_rate": cases_with_flag / n_cases if n_cases else None,
        "pair_fp_rate": flagged_pairs / n_pairs if n_pairs else None,
    }


def score(per_case: dict) -> dict[str, Any]:
    out: dict[str, Any] = {"arms": {}, "n_cases": len(per_case)}
    for arm in ARMS:
        overall = _rates(_confusion(per_case, arm, None))
        by_pillar = {k: _rates(_confusion(per_case, arm, k)) for k in spec.PILLAR_KEYS}
        clean = _clean_control_fp(per_case, arm)
        out["arms"][arm] = {"overall": overall, "by_pillar": by_pillar,
                            "clean_controls": clean}
    b = out["arms"]["baseline"]["overall"]
    r = out["arms"]["redline_critic"]["overall"]
    out["headline"] = {
        "redline_detection": r["detection"], "redline_fp_rate": r["fp_rate"],
        "baseline_detection": b["detection"], "baseline_fp_rate": b["fp_rate"],
        "redline_youden_j": r["youden_j"], "baseline_youden_j": b["youden_j"],
        "sentence": _headline_sentence(r, b),
    }
    return out


def _pct(x: float | None) -> str:
    return "n/a" if x is None else f"{x * 100:.0f}%"


def _headline_sentence(r: dict, b: dict) -> str:
    return (f"Redline catches {_pct(r['detection'])} of planted errors at a "
            f"{_pct(r['fp_rate'])} false-positive rate; a single Claude call catches "
            f"{_pct(b['detection'])} at {_pct(b['fp_rate'])}.")


# ── report + figure ──────────────────────────────────────────────────────────
def render_report(results: dict, meta: dict) -> str:
    h = results["headline"]
    lines = [
        "# Redline detection benchmark — results",
        "",
        f"**{h['sentence']}**",
        "",
        f"- Model (both arms' LLM calls): `{meta.get('model')}`",
        f"- Cases: {results['n_cases']} "
        f"({meta.get('n_present_pairs')} planted-error pillar-instances, "
        f"{meta.get('n_absent_pairs')} clean pillar-instances)",
        f"- Ground truth: independent numpy/scipy labeler (`bench/labeler.py`)",
        f"- Reproduce from committed transcripts: `python -m bench.run --replay`",
        "",
        "## Overall",
        "",
        "| Arm | Detection | False-positive rate | Precision | F1 | Youden's J |",
        "|---|---|---|---|---|---|",
    ]
    names = {"baseline": "Single Claude call (baseline)",
             "redline_raw": "Redline checks (no critic)",
             "redline_critic": "Redline checks + critic"}
    for arm in ARMS:
        o = results["arms"][arm]["overall"]
        lines.append(f"| {names[arm]} | {_pct(o['detection'])} | {_pct(o['fp_rate'])} | "
                     f"{_pct(o['precision'])} | {_pct(o['f1'])} | "
                     f"{o['youden_j']:.2f} |")
    lines += ["", "## Detection by error class", "",
              "| Error class | Redline | Baseline | (n present) |",
              "|---|---|---|---|"]
    for k in spec.PILLAR_KEYS:
        rk = results["arms"]["redline_critic"]["by_pillar"][k]
        bk = results["arms"]["baseline"]["by_pillar"][k]
        lines.append(f"| {spec.PILLARS[k][1]} | {_pct(rk['detection'])} | "
                     f"{_pct(bk['detection'])} | {rk['n_pos']} |")
    lines += ["", "## False-positive rate by error class", "",
              "| Error class | Redline | Baseline | (n clean) |",
              "|---|---|---|---|"]
    for k in spec.PILLAR_KEYS:
        rk = results["arms"]["redline_critic"]["by_pillar"][k]
        bk = results["arms"]["baseline"]["by_pillar"][k]
        lines.append(f"| {spec.PILLARS[k][1]} | {_pct(rk['fp_rate'])} | "
                     f"{_pct(bk['fp_rate'])} | {rk['n_neg']} |")
    lines += ["", "## Clean controls (never cry wolf)", "",
              "| Arm | Control cases with >=1 false flag | Per-pillar FP rate |",
              "|---|---|---|"]
    for arm in ARMS:
        c = results["arms"][arm]["clean_controls"]
        lines.append(f"| {names[arm]} | {c['cases_with_any_flag']}/{c['n_control_cases']} | "
                     f"{_pct(c['pair_fp_rate'])} |")
    lines += ["",
              "The critic can only remove flags, never add them, so it lowers the "
              "false-positive rate without inflating detection. The gap between the "
              "arms is the value of re-running the statistics instead of reasoning "
              "over the write-up: the baseline cannot distinguish a real effect from "
              "a pseudoreplication artifact, or real markers from double-dipped ones, "
              "without running the test, so it must either miss or cry wolf.", ""]
    return "\n".join(lines)


def make_figure(results: dict, path: str) -> bool:
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        import numpy as np
    except Exception:
        return False
    pillars = [spec.PILLARS[k][1] for k in spec.PILLAR_KEYS]
    rd = [results["arms"]["redline_critic"]["by_pillar"][k]["detection"] or 0 for k in spec.PILLAR_KEYS]
    bd = [results["arms"]["baseline"]["by_pillar"][k]["detection"] or 0 for k in spec.PILLAR_KEYS]
    rf = [results["arms"]["redline_critic"]["by_pillar"][k]["fp_rate"] or 0 for k in spec.PILLAR_KEYS]
    bf = [results["arms"]["baseline"]["by_pillar"][k]["fp_rate"] or 0 for k in spec.PILLAR_KEYS]
    x = np.arange(len(pillars))
    w = 0.35
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 4.2))
    red, ink = "#CE2A1E", "#2b2b2b"
    ax1.bar(x - w / 2, [v * 100 for v in rd], w, label="Redline", color=red)
    ax1.bar(x + w / 2, [v * 100 for v in bd], w, label="Single Claude call", color=ink)
    ax1.set_title("Detection rate by error class"); ax1.set_ylabel("%"); ax1.set_ylim(0, 105)
    ax2.bar(x - w / 2, [v * 100 for v in rf], w, label="Redline", color=red)
    ax2.bar(x + w / 2, [v * 100 for v in bf], w, label="Single Claude call", color=ink)
    ax2.set_title("False-positive rate by error class"); ax2.set_ylabel("%"); ax2.set_ylim(0, 105)
    for ax in (ax1, ax2):
        ax.set_xticks(x); ax.set_xticklabels([p.split()[0] for p in pillars], rotation=0)
        ax.legend(); ax.spines[["top", "right"]].set_visible(False)
    fig.tight_layout()
    fig.savefig(path, dpi=130)
    plt.close(fig)
    return True
