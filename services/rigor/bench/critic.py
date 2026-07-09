"""The critic: the LLM half of the Redline arm's "four checks + critic" pipeline.

Each deterministic check can raise a flag. The critic reviews that flag against
the actual re-run evidence and decides whether the evidence supports it, vetoing
weak or borderline flags so the pipeline never cries wolf. The critic can only
REMOVE a flag, never add one, so it can lower detection or the false-positive
rate but never inflate detection. It runs on the same model as the baseline, so
the arms differ only in scaffolding.

The critic is deliberately conservative: it keeps a flag unless the evidence
clearly fails to support it. A strong re-run result (a p-value that stays
significant only at the cell level, markers that collapse out of sample, a
near-1 Cramer's V, a state present in a narrow resolution window) is upheld; a
borderline result is where it earns its keep.
"""

from __future__ import annotations

import json
from typing import Any

from . import llm, spec

SYSTEM_PROMPT = """\
You are the adversarial critic in a single-cell rigor auditor. A deterministic
check has raised a flag for a statistical error, and it has handed you the actual
re-run evidence behind that flag. Your job is to decide whether that evidence
genuinely supports the flag, or whether the flag is weak and should be dropped so
the tool does not cry wolf.

You do not recompute anything. You judge whether the numbers in the evidence
support the specific error being flagged. Uphold a flag when the evidence is
clear. Veto it when the evidence is borderline or does not actually show the
error. Vetoing a well-supported flag is as bad as upholding a spurious one.

Guidance per error class:
- pseudoreplication: supported when a cell-level test is significant but the
  test on the true replicate units (pseudobulk) is not. If both are significant
  the effect is real and the flag should be vetoed.
- double_dipping: supported when the claimed markers separate the state on the
  discovery data but collapse toward chance (AUC near 0.5) on a held-out split.
  If they still separate out of sample, veto.
- fragility: supported when the state is present in only a small fraction of
  clustering resolutions. If it is present across most of the sweep, veto.
- confounding: supported when Cramer's V between the comparison and the technical
  variable is at or near 1. If it is low, the design is separable, so veto.

Return ONLY this JSON object, no prose:
{"supported": true|false, "reason": "one sentence grounded in the evidence numbers"}
"""


def _prompt(pillar_key: str, finding: dict) -> str:
    check_id, name, desc = spec.PILLARS[pillar_key]
    ev = finding.get("evidence", {})
    lines = "\n".join(f"  {k}: {v}" for k, v in ev.items())
    return (f"Flagged error class: {name} ({desc}).\n"
            f"Check headline: {finding.get('headline')}\n\n"
            f"Re-run evidence:\n{lines}\n\n"
            f"Does this evidence support flagging {name} for this analysis?")


def review(case_id: str, pillar_key: str, finding: dict, model: str | None = None) -> dict[str, Any]:
    raw = llm.call(SYSTEM_PROMPT, _prompt(pillar_key, finding), model=model,
                   tag=f"critic:{case_id}:{pillar_key}")
    try:
        parsed = llm.extract_json(raw)
        supported = bool(parsed.get("supported", True))
        reason = parsed.get("reason", "")
    except Exception as exc:
        # if the critic's output is unusable, keep the deterministic flag (the
        # check already found positive evidence); do not silently drop it
        supported, reason = True, f"unparseable critic output, flag kept ({exc})"
    return {"supported": supported, "reason": reason}
