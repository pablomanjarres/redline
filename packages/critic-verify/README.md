# @redline/critic-verify

The actor-critic acceptance harness. It proves the critic (Add-on 1) is a real,
non-decorative second pass: it confirms genuine flags, vetoes over-fired flags on
the clean case (never cry wolf), and downgrades an underpowered double-dipping
split, with a real model call per finding.

## What it grades

Candidate findings come in three kinds (`src/cases.ts`):

- **genuine** flags lifted from the committed oracle answer key over the Case A and
  Case B foils. The critic must **confirm** them.
- **over-fire** flags injected on the clean Case C foil (the actor wrongly flags a
  finding whose numbers are clean). The critic must **veto** each, which produces
  green on the never-cry-wolf case.
- an **underpowered** double-dipping split (held-out half of only 14 cells). The
  critic must **downgrade** it, since the collapse is a power artifact.

## Two layers of proof

- **Offline (`pnpm --filter @redline/critic-verify test`).** Rule-based and
  rubber-stamp stand-in critics drive the runner and gate with no network. This
  proves the mechanics: correct rulings yield green, over-fires flip to clean, the
  underpowered split downgrades, and a rubber-stamp critic is caught. Stand-ins
  never stand in for the product's critic; they test the harness.
- **Live (`pnpm --filter @redline/critic-verify verify`).** A real Bedrock (or
  Claude API) reasoner rules on every candidate. This proves the real model is a
  genuine skeptic. It writes `apps/web/src/verifications/latest-critic-run.json`
  for the `/verifications` page and exits non-zero if the run is not ready.

  ```sh
  AWS_REGION=us-east-1 \
  REDLINE_BEDROCK_MODEL_ID=us.anthropic.claude-opus-4-5-20251101-v1:0 \
  pnpm --filter @redline/critic-verify verify
  ```

## Readiness

A run is READY when every finding is graded correctly, the clean case is green (all
over-fires vetoed), a real model call fired per finding, and both self-honesty foils
are caught (a rubber-stamp critic is rejected; a failed critic call fails safe toward
showing the finding).
