# Redline: Add-on 1: Actor-Critic finding verification (build contract)

This is the authoritative spec for the actor-critic layer. It sits between a check
producing a candidate finding and that finding reaching the user. Read `INTERFACES.md`,
`VERIFICATION.md`, and the Zod types in `packages/contracts/src/*` first; this doc adds
to that contract, it never redefines a shape.

## What it is

A finding is never shown on the strength of one pass. After a check (the **actor**, the
deterministic compute layer) produces a candidate finding with its numbers attached, a
separate Claude call (the **critic**, via Bedrock) independently re-examines it and can
confirm, downgrade, or veto it. Only a finding the critic confirms surfaces as FLAGGED.
This makes "never cry wolf" a mechanism rather than a claim, and it is genuine multi-agent
use: two independent Claude-scale judgments, the second adversarial to the first.

## Precondition and scope (honest status)

The add-on's precondition is that the four base checks read WIRED on `/verifications`.
That full self-verification page harness (Playwright driver, comparator, reporter, the
`/verifications` page) is a separate base deliverable specced in `VERIFICATION.md` and
built on the `verify-harness` branch; as of this add-on it is contract + oracle + foils,
not a live page. This add-on therefore ships:

1. the critic wired into the **real finding path** (`/api/audit/check`), gated on the
   live reasoning backend, so every genuine flag is second-guessed by a real Bedrock call;
2. an **independent critic acceptance harness** (`packages/critic-verify`) that proves the
   critic can veto and downgrade, not just confirm, over the four seeded foils plus
   adversarial injections; and
3. a minimal **`/verifications` critic surface** that renders the harness run, structured
   so the base page harness absorbs it when it lands.

Nothing here fakes the base page. The critic slice is real, wired, and self-verified.

## Flow

1. **Actor** (existing): a check runs its deterministic computation and produces a
   `ComputeResult` with `state` and the load-bearing numbers (`chart` + `stats`).
2. **Critic** (new, `reasoner.critique`): fires only when `state === 'flagged'` and a
   reasoning backend is configured. It receives the candidate finding, the numbers, the
   resolved design, the method that ran, and the check's own reasoning. Its job is
   adversarial: is this flag warranted, or is the check over-firing. It returns strict
   JSON `{ verdict, keys_on, justification, confidence }`, `verdict ∈ confirm|downgrade|veto`.
3. **Gate** (`applyCriticGate`, `@redline/engine`):
   - `confirm` -> the finding stays FLAGGED.
   - `downgrade` -> the finding stays visible but is marked a soft advisory, with the
     critic's reason attached. It is lowered, not suppressed.
   - `veto` -> the finding is suppressed; the check reports `clean` (Verified) for that
     item and the narrative is regenerated clean.
   - parse failure / no backend -> **fail safe toward showing**: the finding stays FLAGGED
     and is marked `critic-unverified`. Never fail toward hiding a real problem.

## The critic's remit (per check)

- **Pseudoreplication (1):** is the corrected test the right one for this design, is n
  truly the replicate count, is the effect genuinely gone or just under threshold. Veto if
  the deterministic step mis-identified the replicate (a significant honest/pseudobulk p
  means the effect survives the replicate-level test, so it is not pseudoreplication).
- **Double dipping (2):** is the held-out drop real separation loss or an underpowered
  split (too few held-out cells), which would make the collapse an artifact of the test,
  not the data. Downgrade if the split is underpowered.
- **Fragility (3):** is the group's instability meaningful or is the sweep range
  unreasonable, is a boundary-only cluster actually the claim being made.
- **Confounding (4):** is the collinearity total or partial, and does partial overlap
  still permit a qualified conclusion (downgrade for partial, confirm for total).

## Structured contract (`packages/contracts/src/critic.ts`)

- `CriticJudgment`: the strict JSON the model returns:
  `{ verdict: 'confirm'|'downgrade'|'veto', keys_on: string, justification: string, confidence: 'high'|'medium'|'low' }`.
- `CriticRequest`: what the critic sees: `checkId`, `computeState`, `claim`,
  `datasetTitle`, `evidence` (the numbers), and optional `method` / `design` / `checkReasoning`.
- `CriticAssessment`: what is attached to a finding and logged: the resolved verdict,
  `keysOn`, `justification`, `confidence`, `unverified` (fail-safe flag), and `source`
  (`bedrock`|`anthropic`|`curated`).
- `CheckResult` gains `critic?: CriticAssessment` and `computeState?: CheckState` (the
  pre-gate verdict, preserved for audit). Its top-level `state` is the effective post-gate
  verdict.
- `verification.ts` gains `CriticFindingOutcome`, `CriticSelfTest`, and `CriticVerification`,
  and `VerificationRun` gains `critic?: CriticVerification`.

Parse defensively: on a parse failure the critic is unavailable, the caller marks the
finding `critic-unverified`, and the finding is still shown.

## Where it shows

- Each finding card gains a small "Critic: confirmed / downgraded / vetoed" line with the
  critic's one-sentence reason. This is visible proof the tool second-guesses itself.
- The critic verdict and justification are logged into the harness run, which the
  `/verifications` surface renders, so a real critic call can be asserted per finding.

## Acceptance (the harness enforces this)

- A real Bedrock call fires for the critic on every candidate finding.
- Fed a borderline case (an underpowered double-dipping split), the critic **downgrades**
  rather than confirming.
- On the clean case (Case C), an over-fired flag is **vetoed**, producing green. This is
  the mechanism behind never-cry-wolf.
- The critic can veto: a self-honesty injection runs a rubber-stamp critic (always
  confirm) over the adversarial cases and the harness must report it NOT READY. A critic
  that cannot veto is decorative and worse than none.

## Honesty

The critic is prompted to look for reasons the flag is wrong, and it is graded on whether
it can veto and downgrade, not only confirm. The offline harness proves the gate and the
run mechanics deterministically; the live harness proves the real model is a genuine
skeptic. No green is fabricated. All copy obeys `honesty-rules.md` and the no-em-dash voice
gate.

## Compute

Roughly doubles Claude calls per flagged finding (one narrate, one critique). The critic
prompt is tight: it reasons over numbers already computed, so its context is small.

## Build order

1. Contracts: `critic.ts` + `CheckResult`/`verification.ts` extensions + barrel export.
2. Reasoner: `buildCriticPrompt` + `reasoner.critique` + an injectable backend seam for
   deterministic tests; unit tests.
3. Gate: `applyCriticGate` in `@redline/engine`; unit tests.
4. Finding path: wire the gate into `/api/audit/check`; narrate for the effective state.
5. UI: the critic line on the finding card; a `/verifications` nav entry.
6. Harness `packages/critic-verify`: oracle-derived candidates + adversarial injections,
   the runner, the self-honesty rubber-stamp injection, offline tests, and the live entry
   that writes `apps/web/src/verifications/latest-critic-run.json`.
7. The `/verifications` critic page.
8. Docs.

Commit granularly, one logical step per commit, no `Co-Authored-By` lines.
