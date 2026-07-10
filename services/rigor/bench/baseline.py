"""The baseline arm: one Claude call given the analysis write-up, asked to find
the statistical problems. Same model as the Redline critic, so the only
difference between the arms is the scaffolding (deterministic re-runs + critic)
versus a single reasoning pass over the write-up.

The prompt is deliberately strong and fair (honesty requirement): it names and
defines all four error classes, cites the fixing method for each, asks for a
per-class present/absent judgment with a rationale, and explicitly asks the model
to neither miss real problems nor invent ones. A weak or leading prompt would rig
the comparison; this does not.
"""

from __future__ import annotations

import json
from typing import Any

from . import llm, spec

SYSTEM_PROMPT = """\
You are a rigorous statistical reviewer for single-cell RNA-seq analyses. A
scientist gives you their analysis write-up before it becomes a paper. Your job
is to find the load-bearing statistical errors, the ones that turn into false
discoveries, and to do it without crying wolf. A clean analysis is a real answer.

Judge the analysis for each of these four error classes, independently:

1. pseudoreplication - cells from a few donors are treated as independent
   samples, inflating significance. The fix is to aggregate to the biological
   replicate (pseudobulk) or use a mixed model (Squair et al. 2021). A p-value
   from a cell-level test on data from a handful of donors is the warning sign.

2. double_dipping - the same cells are used first to define a cluster/state and
   then to test the markers that define it, which inflates the markers'
   apparent separation. The fix is selective-inference-aware testing: count
   splitting / data thinning, or ClusterDE (Neufeld et al. 2024; Song et al. 2023).

3. fragility - a "state" or subcluster exists only at one arbitrary clustering
   resolution and disappears at neighboring resolutions, so the biological claim
   rides on an unjustified parameter (Luecken and Theis 2019).

4. confounding - the biological comparison is collinear with a technical variable
   (batch, lane, run), so the two effects cannot be separated (Hicks et al. 2018).

Reason carefully about what the write-up does and does not establish. Some errors
can be judged from the write-up; some cannot be settled from the write-up alone,
in which case weigh how likely the error is given the design and the method
described. Do not flag an error class when the analysis handled it correctly, and
do not miss one that is present.

Return ONLY a JSON object, no prose around it, of exactly this shape:
{
  "pseudoreplication": {"present": true|false, "confidence": 0.0-1.0, "reason": "one sentence"},
  "double_dipping":    {"present": true|false, "confidence": 0.0-1.0, "reason": "one sentence"},
  "fragility":         {"present": true|false, "confidence": 0.0-1.0, "reason": "one sentence"},
  "confounding":       {"present": true|false, "confidence": 0.0-1.0, "reason": "one sentence"}
}
"present" is true if that specific error is present in this analysis.
"""


# The evidence baseline: the SAME model, but handed the re-run diagnostic numbers
# instead of the write-up. The gap between this and the write-up baseline isolates
# the value of re-running the statistics from the value of reasoning: if this arm
# scores well where the write-up baseline cries wolf, the false positives were the
# cost of not re-running, which is exactly what Redline provides.
EVIDENCE_SYSTEM_PROMPT = SYSTEM_PROMPT.replace(
    "A scientist gives you their analysis write-up before it becomes a paper.",
    "You are given the re-run diagnostic statistics for an analysis (the numbers "
    "that only re-running the load-bearing tests produces).",
).replace(
    "Reason carefully about what the write-up does and does not establish. Some errors\n"
    "can be judged from the write-up; some cannot be settled from the write-up alone,\n"
    "in which case weigh how likely the error is given the design and the method\n"
    "described.",
    "Judge each error class directly from the diagnostic numbers. A cell-level p-value\n"
    "that survives pseudobulk aggregation is a real effect (no pseudoreplication);\n"
    "markers whose held-out AUC stays high are real (no double dipping); a state present\n"
    "across most resolutions is stable (no fragility); a low Cramer's V is separable\n"
    "(no confounding).",
)


def _parse(raw: str) -> dict[str, Any]:
    try:
        parsed = llm.extract_json(raw)
    except Exception as exc:
        return {"detected": {k: False for k in spec.PILLAR_KEYS},
                "judgment": {}, "parse_error": str(exc), "raw": raw}
    detected, judgment = {}, {}
    for k in spec.PILLAR_KEYS:
        entry = parsed.get(k) or {}
        present = bool(entry.get("present", False)) if isinstance(entry, dict) else bool(entry)
        detected[k] = present
        judgment[k] = entry if isinstance(entry, dict) else {"present": present}
    return {"detected": detected, "judgment": judgment}


def run_case(case_id: str, artifact_text: str, model: str | None = None) -> dict[str, Any]:
    """The write-up baseline: one call over the analysis write-up (Reviewer 2)."""
    raw = llm.call(SYSTEM_PROMPT, artifact_text, model=model, tag=f"baseline:{case_id}")
    return _parse(raw)


def run_case_evidence(case_id: str, evidence_text: str, model: str | None = None) -> dict[str, Any]:
    """The evidence baseline: one call over the re-run diagnostic numbers."""
    raw = llm.call(EVIDENCE_SYSTEM_PROMPT, evidence_text, model=model,
                   tag=f"baseline_evidence:{case_id}")
    return _parse(raw)
