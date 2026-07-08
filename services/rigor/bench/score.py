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

ARMS = ["baseline", "baseline_evidence", "redline_raw", "redline_critic"]


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
    names = {"baseline": "Single Claude call, write-up only (baseline)",
             "baseline_evidence": "Single Claude call, given the re-run numbers",
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
    be = results["arms"]["baseline_evidence"]["overall"]
    lines += ["", "## What the three arms isolate", "",
              "Both LLM arms use the same model. The only difference is the input.",
              "",
              f"- The **write-up baseline** ({_pct(results['arms']['baseline']['overall']['fp_rate'])} "
              "false positives) reasons over the naive analysis write-up, which is what "
              "Reviewer 2 has. It cannot tell a real effect from a pseudoreplication "
              "artifact, or real markers from double-dipped ones, without running the "
              "test, so it flags the method risk and cries wolf on clean analyses.",
              f"- The **evidence baseline** ({_pct(be['fp_rate'])} false positives) is the "
              "same model given the re-run diagnostic numbers (but not Redline's "
              "verdict). It recovers, which shows the write-up baseline's false "
              "positives are the cost of not re-running, not of poor reasoning.",
              "- **Redline** is the pipeline that produces those numbers: the four "
              "deterministic checks re-run the statistics, and the critic (which can "
              "only remove flags, never add them) vetoes borderline flags so the tool "
              "does not cry wolf.",
              "",
              "So the headline is a precision result, not a recall one: every arm "
              "catches the planted errors, but only the arms that see the re-run avoid "
              "flagging sound analyses. The Redline arm shares its statistical method "
              "and its case selection with the independent labeler (see the benchmark "
              "README), so its detection numbers are near-definitional; the load-bearing, "
              "fair comparison is the false-positive gap between the write-up baseline "
              "and the arms that re-run.", ""]
    return "\n".join(lines)


def make_figure(results: dict, path: str) -> bool:
    """The false-positive story: every arm detects ~100%, so the figure shows the
    thing that actually differs. Left: overall FP across the three LLM conditions
    (same model, different input). Right: FP by error class, write-up baseline vs
    the Redline pipeline."""
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        import numpy as np
    except Exception:
        return False
    red, ink, grey = "#CE2A1E", "#2b2b2b", "#9a9a9a"
    A = results["arms"]

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 4.4),
                                   gridspec_kw={"width_ratios": [1, 1.35]})

    # left: overall FP for the three LLM-differentiated conditions
    labels = ["write-up\nbaseline", "same model +\nre-run numbers", "Redline\n(checks+critic)"]
    vals = [(A["baseline"]["overall"]["fp_rate"] or 0) * 100,
            (A["baseline_evidence"]["overall"]["fp_rate"] or 0) * 100,
            (A["redline_critic"]["overall"]["fp_rate"] or 0) * 100]
    bars = ax1.bar(labels, vals, color=[ink, grey, red], width=0.62)
    ax1.set_title("False-positive rate\n(same model, different input)", fontsize=11)
    ax1.set_ylabel("false-positive rate (%)"); ax1.set_ylim(0, 100)
    for b, v in zip(bars, vals):
        ax1.text(b.get_x() + b.get_width() / 2, v + 2, f"{v:.0f}%", ha="center", fontsize=10)

    # right: FP by error class, write-up baseline vs Redline
    pillars = [spec.PILLARS[k][1] for k in spec.PILLAR_KEYS]
    bf = [(A["baseline"]["by_pillar"][k]["fp_rate"] or 0) * 100 for k in spec.PILLAR_KEYS]
    rf = [(A["redline_critic"]["by_pillar"][k]["fp_rate"] or 0) * 100 for k in spec.PILLAR_KEYS]
    x = np.arange(len(pillars)); w = 0.38
    ax2.bar(x - w / 2, bf, w, label="write-up baseline", color=ink)
    ax2.bar(x + w / 2, rf, w, label="Redline (checks+critic)", color=red)
    ax2.set_title("False-positive rate by error class", fontsize=11)
    ax2.set_ylabel("false-positive rate (%)"); ax2.set_ylim(0, 105)
    ax2.set_xticks(x); ax2.set_xticklabels([p.split()[0] for p in pillars])
    ax2.legend(frameon=False, fontsize=9)

    for ax in (ax1, ax2):
        ax.spines[["top", "right"]].set_visible(False)
    fig.suptitle("Every arm detects ~100% of planted errors. Only re-running avoids crying wolf.",
                 fontsize=12, y=1.02)
    fig.tight_layout()
    fig.savefig(path, dpi=130, bbox_inches="tight")
    plt.close(fig)
    return True
