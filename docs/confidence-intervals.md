# Repeat intervals on the stochastic checks

Two of the four checks contain randomness. Check 2 (double dipping) splits the
counts with Poisson thinning; Check 3 (fragility) re-clusters under a random
seed. A single run of either could be lucky. So Redline does not report one
number from one run. It repeats each stochastic check many times and reports the
distribution: a median with a 95% interval and the repetition count behind it.

This closes the sharpest statistics critique a judge can make, "your one split
could be luck," before it is asked.

## What this interval is, and what it is not

It is the 2.5th to 97.5th percentile of the estimate across repeated runs of the
**algorithm's own randomness** on a **fixed dataset**. It quantifies one thing:
how much the answer moves when only the split seed or the clustering seed moves.

It is **not a confidence interval**. It carries none of the sampling variability
of the data. Resampling the donors would produce a much wider interval, and on a
four-donor study it would dominate. Nothing here estimates a population
parameter, and the interval has no coverage guarantee.

Redline audits people for calling one number more certain than it is, so it does
not name this a confidence interval. The surfaces say "95% interval over N
splits" and the repetition count is always shown beside it. Read a tight interval
as "the seed did not matter," never as "the effect is certain."

## What repeats, and what does not

| Check | Stochastic step | Repeats | Reported as a distribution |
|---|---|---|---|
| 1 — pseudoreplication | none (Welch t, ICC) | 1 | no, it is deterministic |
| 2 — double dipping | Poisson count-split + re-cluster | 200 (default) | held-out AUC, discovery AUC, markers holding |
| 3 — fragility | Leiden resolution sweep | 40 (default) | stability fraction; per-setting presence |
| 4 — confounding | none (Cramér's V, rank) | 1 | no, it is deterministic |

The repetition counts are knobs (`repeats` in the check config), clamped so a
runaway job cannot spin forever. The claim under test and the markers are
resolved once, so every repeat grades the same thing; only the stochastic step
varies. The seeds are a deterministic stream off the base seed, so the interval
is reproducible: same seed in, same interval out.

## Where the interval lives

- **The engine.** `redline.pillars.interval(samples, level)` aggregates the
  per-run values into `{median, lo, hi, level, n, samples}` (the `Interval`
  shape in `@redline/contracts`, mirrored in `redline.contracts`). The double
  dipping and fragility pillars run the repeat loop and attach the interval to
  the chart (`holdAUCDist`, `discAUCDist`, `markersHoldingDist`, `stabilityDist`)
  and to the relevant `StatReadout` (`interval`). Check 3 also carries a
  per-setting `presence` probability on each `FragilityStep`.
- **The metric cards.** Each stat tile shows the median value, its 95% interval,
  the repetition count, and a small `DistributionStrip` (the samples as ticks,
  the interval as a band, the median as a mark).
- **The figures.** Check 2 draws a held-out interval band on the AUC axis; Check 3
  shades each presence tile by the fraction of runs the group is present there.
- **The finding text and the rewritten conclusion.** The curated fallback weaves
  the interval into `corrected` ("AUC 0.57 (95% interval 0.54-0.61 over 200 splits),
  near chance"). The LLM path gets the interval bounds and the repetition count
  as evidence keys and is instructed to cite them (`prompts.ts`).
- **The report.** Both the on-screen `ReportRow` and the downloadable PDF carry
  the interval, the strip, and the repetition count, not just the point.

## Honesty

The interval is emitted only when a check actually repeated its stochastic step.
It is never fabricated around a point estimate. On the real compute target the
numbers are genuinely computed from the repeated runs.

The demo runs on the locked fixtures, which cannot run the 1.7 TB matrix, so the
fixture interval values are illustrative reference figures, the same status as
the point estimates they surround (see `docs/dataset.md`). Their widths are
calibrated to a real reference run, never invented, and the Environment page
states plainly what is real versus reference.

## Reproduce it

The capability runs on a small, fully seeded reference foil, so no expression
matrix is needed to prove it is real:

```bash
cd services/rigor
# print the real intervals the checks compute (median, 95% interval, repetition count)
python data/build_ci_reference.py --c2-reps 200 --c3-reps 40

# the acceptance proof: same seed => byte-identical interval; well formed; and a
# robust real group has a tighter, higher held-out interval than a weak one
python -m pytest tests/test_ci_intervals.py -q
```

The reference foil (`redline.oracle.reference`) plants a real Naive program (holds
out, tight interval) and a spurious Effector group (weak, wide interval), the same
honesty discipline as the Marson naive foil: the spurious group carries no real
program by construction.
