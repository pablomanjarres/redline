# Add-on 5 — Detection Benchmark (plan)

Measure how well Redline (four deterministic checks + an LLM critic) detects planted
statistical errors in single-cell analyses, against a single-shot Claude baseline given
the same analysis. Headline: "Redline catches X% of planted errors at Y% false-positive
rate; single-shot Claude catches P% at Q%."

## Methodology (integrity)
- [ ] Ground truth = construction, VALIDATED by an INDEPENDENT numpy/scipy labeler that
      scores all four pillars per case. Cases tuned against the LABELER, never the engine
      or the baseline. Both arms evaluated blind. (No tautology: label != engine output.)
- [ ] Baseline sees the scientist's own write-up (claim + naive stats + methods) and must
      find the problems. Redline re-runs the statistics on the data. Same info, diff method.
- [ ] Same strong model (Opus 4.6) powers baseline AND critic -> only variable = scaffolding.
- [ ] Record/replay every LLM call -> frozen number reproducible with zero credentials.
- [ ] Deterministic engine path (Welch-on-donor-means, leiden-via-igraph seeded, no PyDESeq2).

## Cases (bench/cases/)
- [ ] Single-error foil generator: per pillar, positive (error) + negative (clean, same
      method) cases; plus fully-clean whole-analysis controls. ~52 cases, distinct seeds.
- [ ] P2/P3 negatives are indistinguishable-from-write-up (the crying-wolf trap).

## Harness (bench/)
- [ ] spec.py, generate.py, labeler.py, artifact.py, llm.py (record/replay),
      redline_arm.py, critic.py, baseline.py, score.py, run.py, __main__.py
- [ ] Self-tests: labeler catches injected errors; scorer math; determinism; harness-can-fail.

## Deliverables
- [ ] Frozen results.json + report.md + figure(s) + README (open-source).
- [ ] Per-class + overall detection, FP rate, balanced score, headline number.

## Verify
- [ ] Adversarial workflow: circularity, baseline fairness, labeler independence,
      scoring correctness, reproducibility, honesty invariants.
- [ ] Commit granularly, push, draft PR.
