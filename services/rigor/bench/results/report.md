# Redline detection benchmark — results

**Redline catches 100% of planted errors at a 0% false-positive rate; a single Claude call catches 100% at 74%.**

- Model (both arms' LLM calls): `us.anthropic.claude-opus-4-6-v1`
- Cases: 46 (30 planted-error pillar-instances, 154 clean pillar-instances)
- Ground truth: independent numpy/scipy labeler (`bench/labeler.py`)
- Reproduce from committed transcripts: `python -m bench.run --replay`

## Overall

| Arm | Detection | False-positive rate | Precision | F1 | Youden's J |
|---|---|---|---|---|---|
| Single Claude call, write-up only (baseline) | 100% | 74% | 21% | 34% | 0.26 |
| Single Claude call, given the re-run numbers | 100% | 0% | 100% | 100% | 1.00 |
| Redline checks (no critic) | 100% | 2% | 91% | 95% | 0.98 |
| Redline checks + critic | 100% | 0% | 100% | 100% | 1.00 |

## Detection by error class

| Error class | Redline | Baseline | (n present) |
|---|---|---|---|
| Pseudoreplication | 100% | 100% | 6 |
| Double dipping | 100% | 100% | 6 |
| Clustering fragility | 100% | 100% | 12 |
| Technical confounding | 100% | 100% | 6 |

## False-positive rate by error class

| Error class | Redline | Baseline | (n clean) |
|---|---|---|---|
| Pseudoreplication | 0% | 100% | 40 |
| Double dipping | 0% | 100% | 40 |
| Clustering fragility | 0% | 100% | 34 |
| Technical confounding | 0% | 0% | 40 |

## Clean controls (never cry wolf)

| Arm | Control cases with >=1 false flag | Per-pillar FP rate |
|---|---|---|
| Single Claude call, write-up only (baseline) | 4/4 | 75% |
| Single Claude call, given the re-run numbers | 0/4 | 0% |
| Redline checks (no critic) | 0/4 | 0% |
| Redline checks + critic | 0/4 | 0% |

## What the three arms isolate

Both LLM arms use the same model. The only difference is the input.

- The **write-up baseline** (74% false positives) reasons over the naive analysis write-up, which is what Reviewer 2 has. It cannot tell a real effect from a pseudoreplication artifact, or real markers from double-dipped ones, without running the test, so it flags the method risk and cries wolf on clean analyses.
- The **evidence baseline** (0% false positives) is the same model given the re-run diagnostic numbers (but not Redline's verdict). It recovers, which shows the write-up baseline's false positives are the cost of not re-running, not of poor reasoning.
- **Redline** is the pipeline that produces those numbers: the four deterministic checks re-run the statistics, and the critic (which can only remove flags, never add them) vetoes borderline flags so the tool does not cry wolf.

So the headline is a precision result, not a recall one: every arm catches the planted errors, but only the arms that see the re-run avoid flagging sound analyses. The Redline arm shares its statistical method and its case selection with the independent labeler (see the benchmark README), so its detection numbers are near-definitional; the load-bearing, fair comparison is the false-positive gap between the write-up baseline and the arms that re-run.
