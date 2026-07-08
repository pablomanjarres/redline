# Redline detection benchmark — results

**Redline catches 100% of planted errors at a 0% false-positive rate; a single Claude call catches 100% at 74%.**

- Model (both arms' LLM calls): `us.anthropic.claude-opus-4-6-v1`
- Cases: 46 (30 planted-error pillar-instances, 154 clean pillar-instances)
- Ground truth: independent numpy/scipy labeler (`bench/labeler.py`)
- Reproduce from committed transcripts: `python -m bench.run --replay`

## Overall

| Arm | Detection | False-positive rate | Precision | F1 | Youden's J |
|---|---|---|---|---|---|
| Single Claude call (baseline) | 100% | 74% | 21% | 34% | 0.26 |
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
| Single Claude call (baseline) | 4/4 | 75% |
| Redline checks (no critic) | 0/4 | 0% |
| Redline checks + critic | 0/4 | 0% |

The critic can only remove flags, never add them, so it lowers the false-positive rate without inflating detection. The gap between the arms is the value of re-running the statistics instead of reasoning over the write-up: the baseline cannot distinguish a real effect from a pseudoreplication artifact, or real markers from double-dipped ones, without running the test, so it must either miss or cry wolf.
