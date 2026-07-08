"""Orchestrate the detection benchmark end to end.

  python -m bench.run --replay          reproduce the frozen number from the
                                        committed transcripts (no credentials)
  python -m bench.run --live            call Bedrock on cache misses and record
  python -m bench.run --generate        rebuild the case set first
  python -m bench.run --live --model us.anthropic.claude-sonnet-4-6

Phase 1 runs the four deterministic checks on every case (fast, local, no model).
Phase 2 runs the LLM calls (one baseline call per case, one critic call per raw
flag) concurrently, through the record/replay cache. Phase 3 scores and writes
results.json, report.md, a figure, and a per-case detail file.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor

from . import artifact, baseline, critic, generate, llm, redline_arm, score, spec


def _load_cases() -> tuple[dict, dict]:
    if not (os.path.exists(spec.MANIFEST_PATH) and os.path.exists(spec.LABELS_PATH)):
        print("cases not found; generating...", file=sys.stderr)
        generate.write_all()
    manifest = json.load(open(spec.MANIFEST_PATH))
    labels = json.load(open(spec.LABELS_PATH))
    return manifest, labels


def _redline_phase(manifest: dict) -> dict:
    """Run the four checks on every case (local, deterministic, no model)."""
    findings: dict = {}
    t0 = time.time()
    for c in manifest["cases"]:
        cid = c["case_id"]
        path = os.path.join(spec.CASES_DIR, c["filename"])
        out = redline_arm.run_case(path, c["claim"])
        findings[cid] = out
    print(f"[phase 1] redline checks: {len(manifest['cases'])} cases in "
          f"{time.time() - t0:.0f}s", file=sys.stderr)
    return findings


def _llm_phase(manifest: dict, labels: dict, findings: dict, model: str) -> dict:
    """Run baseline + critic LLM calls concurrently through the cache."""
    baseline_out: dict = {}
    evidence_out: dict = {}
    critic_out: dict = {}
    tasks = []

    for c in manifest["cases"]:
        cid = c["case_id"]
        art = artifact.render(c, labels[cid]["stats"])
        ev = artifact.render_evidence(findings[cid]["per_pillar"])
        tasks.append(("baseline", cid, art, None))
        tasks.append(("baseline_evidence", cid, ev, None))
        for pk, pillar in findings[cid]["per_pillar"].items():
            if pillar["state"] == "flagged":
                tasks.append(("critic", cid, pk, pillar))

    def _run(task):
        kind = task[0]
        if kind == "baseline":
            _, cid, art, _ = task
            return ("baseline", cid, None, baseline.run_case(cid, art, model=model))
        if kind == "baseline_evidence":
            _, cid, ev, _ = task
            return ("baseline_evidence", cid, None, baseline.run_case_evidence(cid, ev, model=model))
        _, cid, pk, pillar = task
        return ("critic", cid, pk, critic.review(cid, pk, pillar, model=model))

    t0 = time.time()
    with ThreadPoolExecutor(max_workers=spec.LLM_CONCURRENCY) as pool:
        for kind, cid, pk, result in pool.map(_run, tasks):
            if kind == "baseline":
                baseline_out[cid] = result
            elif kind == "baseline_evidence":
                evidence_out[cid] = result
            else:
                critic_out.setdefault(cid, {})[pk] = result
    s = llm.stats()
    print(f"[phase 2] llm calls: {len(tasks)} tasks in {time.time() - t0:.0f}s "
          f"(cache hits={s['hits']}, live={s['live_calls']}, "
          f"tokens in/out={s['in_tokens']}/{s['out_tokens']})", file=sys.stderr)
    return {"baseline": baseline_out, "baseline_evidence": evidence_out, "critic": critic_out}


def _assemble(manifest: dict, labels: dict, findings: dict, llm_out: dict) -> dict:
    per_case: dict = {}
    for c in manifest["cases"]:
        cid = c["case_id"]
        raw = findings[cid]["raw_detected"]
        crit = llm_out["critic"].get(cid, {})
        redline_critic = {k: bool(raw[k] and crit.get(k, {}).get("supported", True))
                          for k in spec.PILLAR_KEYS}
        per_case[cid] = {
            "family": c["family"],
            "truth": labels[cid]["truth"],
            "arms": {
                "baseline": {"detected": llm_out["baseline"][cid]["detected"],
                             "judgment": llm_out["baseline"][cid].get("judgment", {})},
                "baseline_evidence": {"detected": llm_out["baseline_evidence"][cid]["detected"],
                                      "judgment": llm_out["baseline_evidence"][cid].get("judgment", {})},
                "redline_raw": {"detected": dict(raw)},
                "redline_critic": {"detected": redline_critic,
                                   "critic": crit},
            },
            "redline_states": {k: v["state"] for k, v in findings[cid]["per_pillar"].items()},
        }
    return per_case


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="bench.run")
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--live", action="store_true", help="call Bedrock on cache misses and record")
    mode.add_argument("--replay", action="store_true", help="serve every LLM call from the transcript (default)")
    ap.add_argument("--generate", action="store_true", help="rebuild the case set first")
    ap.add_argument("--score-only", action="store_true",
                    help="recompute the headline from the committed results.json (no compute, no model)")
    ap.add_argument("--model", default=spec.DEFAULT_MODEL, help="Bedrock model id for both arms")
    args = ap.parse_args(argv)

    if args.score_only:
        frozen = json.load(open(spec.RESULTS_PATH))
        results = score.score(frozen["per_case"])
        print(results["headline"]["sentence"])
        old = frozen["results"]["headline"]["sentence"]
        print("matches committed results.json" if old == results["headline"]["sentence"]
              else f"MISMATCH vs committed: {old}")
        return 0

    llm.set_mode("live" if args.live else "replay")
    if args.generate:
        info = generate.write_all()
        print(f"generated {info['n_cases']} cases "
              f"({info['n_label_mismatches']} label mismatches)", file=sys.stderr)

    manifest, labels = _load_cases()
    findings = _redline_phase(manifest)
    try:
        llm_out = _llm_phase(manifest, labels, findings, args.model)
    except RuntimeError as exc:
        print(f"\nERROR: {exc}", file=sys.stderr)
        if not args.live:
            print("Hint: run once with --live to record the transcript, then --replay reproduces it.",
                  file=sys.stderr)
        return 2

    per_case = _assemble(manifest, labels, findings, llm_out)
    results = score.score(per_case)

    n_present = sum(1 for r in per_case.values() for k in spec.PILLAR_KEYS if r["truth"][k])
    n_absent = sum(1 for r in per_case.values() for k in spec.PILLAR_KEYS if not r["truth"][k])
    meta = {"model": args.model, "mode": "live" if args.live else "replay",
            "n_present_pairs": n_present, "n_absent_pairs": n_absent,
            "engine_backend": redline_arm.engine_backend(),
            "llm_stats": llm.stats()}
    results["meta"] = meta

    os.makedirs(spec.RESULTS_DIR, exist_ok=True)
    with open(spec.RESULTS_PATH, "w", encoding="utf-8") as fh:
        json.dump({"results": results, "per_case": per_case}, fh, indent=2)
    with open(spec.REPORT_PATH, "w", encoding="utf-8") as fh:
        fh.write(score.render_report(results, meta))
    fig_path = os.path.join(spec.RESULTS_DIR, "detection_by_class.png")
    made = score.make_figure(results, fig_path)

    print("\n" + "=" * 72)
    print(results["headline"]["sentence"])
    print("=" * 72)
    print(f"results  -> {spec.RESULTS_PATH}")
    print(f"report   -> {spec.REPORT_PATH}")
    if made:
        print(f"figure   -> {fig_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
