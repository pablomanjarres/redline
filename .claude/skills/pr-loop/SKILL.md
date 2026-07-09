---
name: pr-loop
description: Review one pull request to convergence. Verify it, attack its central claim, investigate every failure to root cause, fix, re-verify, improve the architecture, and repeat until two consecutive passes find nothing new. Then merge, or stop and say why not. Use when a PR needs a real review rather than a skim, when `scripts/pr-watch.sh` hands you a PR number, or when the user says "review PR N", "run the loop on N", or invokes `/pr-loop N`.
---

# The PR loop

Take one pull request from "opened" to "merged, and I can defend every line of it".

This is a **goal-based loop**. It runs until a machine-checkable done-condition,
capped at a named number of passes. It is not a checklist you walk once.

## The iron rules

| Rule | How this loop satisfies it |
|---|---|
| Stop condition | Two consecutive passes produce zero new confirmed findings, **and** `scripts/pr-verify.sh` exits 0. Capped at `PR_LOOP_MAX_PASSES` (default 4). |
| Verification | `scripts/pr-verify.sh`. An exit code, not a feeling. |
| Failure alert | `notify.sh -c pr-loop -m "..."` on abort, on cap-exhaustion, and on any merge refusal. |

Named caps, greppable, never in prose:

```
PR_LOOP_MAX_PASSES=4      # give up and alert rather than churn
PR_LOOP_DRY_PASSES=2      # consecutive findings-free passes required to converge
PR_LOOP_MERGE=0           # default OFF. Merging writes to the outside world.
```

## Before you touch anything

Invoke **superpowers:using-git-worktrees**. Review and fix in an isolated worktree.

**Create your own. Never adopt an existing one.** A sibling worktree may belong to
a human, or hold a half-resolved merge, or carry uncommitted work. Running
`git reset --hard` or `git checkout` in it destroys that silently.

```bash
git worktree add -b review/pr-<n> ../redline-pr-<n> origin/<head-branch>
```

If you must touch an existing worktree, read `git status` **first** and stop if it
is not clean. `needs merge` in the output means a merge is in progress and someone
was resolving it. That is not yours to discard.

Then read, in order: `CLAUDE.md`, `docs/honesty-rules.md`, `docs/architecture.md`,
and whatever doc the PR touches. The honesty rules are the acceptance criteria. A
PR that passes CI and violates them is not mergeable.

## The pass

Each pass is six steps. Run them in order. Do not skip step 2 because step 1 was
green: a green suite is evidence the suite ran, not that the code is right.

### 1. Verify

Run `scripts/pr-verify.sh`. It installs the **real** dependency stack and asserts
it imports before running a single test.

> The reason this exists: `[stats]` once shipped scanpy without `leidenalg`.
> scanpy imports it lazily inside `sc.tl.leiden`, a bare `except Exception:`
> swallowed the `ModuleNotFoundError`, and every clustering call silently ran
> KMeans. Three real bugs hid behind that, and the test named
> `test_pillar3_runs_real_leiden_sweep` passed for months without running Leiden.
>
> **A suite that runs against fallbacks verifies the fallbacks.** Install the real
> thing, assert it is the thing that ran, and only then believe a passing test.

### 2. Attack the PR's own central claim

Read the PR title and body. Find the sentence that makes the strongest claim, then
try to falsify it with evidence, not with reasoning.

- "real compute" -> trace the call path to the process that does the arithmetic.
- "oracle-graded" -> check whether the oracle imports the code it grades. If it
  does, the grade is worthless.
- "100% detection" -> ask what fraction of the positives are true by construction.
- "the critic catches over-fires" -> diff the arms. Does removing it change a number?
- "reproduces exactly" -> run the reproduce command and read the exit code.

Fan out. Spawn one subagent per independent claim or per dimension of the diff
(correctness, honesty invariants, contracts, security, performance), using
**superpowers:subagent-driven-development**. Give each one the PR's own words and
tell it to refute them. Then verify each finding adversarially before you believe
it: a plausible finding that does not reproduce wastes more time than no finding.

### 3. Investigate every failure to root cause

Invoke **superpowers:systematic-debugging**. A failing check is a symptom.

The rule that matters, and the one that is hardest to follow:

> **Never loosen a check to make it pass.** If a comparison fails, the default
> hypothesis is that the code is wrong, not that the tolerance is tight. Widen a
> tolerance only after you can explain, in numbers, why the two quantities are not
> estimating the same thing. On the day this loop was written, a harness check
> failed on `holdAUC 0.5105` vs an oracle's `0.5778`. Loosening the tolerance would
> have "fixed" it. The actual cause was that the clustering embedding was driven by
> sequencing depth, and fixing that moved the engine to `0.5447`, inside the
> original tolerance, and fixed four other things at once.

When you find a bug, invoke **superpowers:test-driven-development**: write the test
that reproduces it *first*, watch it fail, then fix it.

### 4. Fix, at the root

Fix the cause, in the earliest PR in the stack that owns the code. A fix applied
downstream leaves the bug live for everyone upstream.

Commit granularly. One logical step per commit, with a message that says what was
wrong and why the fix is right. A reviewer six months from now reads the message,
not the diff.

### 5. Re-verify

`scripts/pr-verify.sh` again, plus anything the fix could plausibly have broken.
Changing an engine changes every consumer of it. Re-run the downstream suites,
not just the one you touched.

Invoke **superpowers:verification-before-completion**. Evidence before assertions,
always. Never write "fixed" next to a command you did not run.

### 6. Check direction

Step back and ask the two questions a staff engineer would ask:

1. **Is this still the right shape?** If the fix revealed that a module conflates
   two concepts (a flag meaning "the test ran" reused as "the test failed"), fix the
   concept, not the symptom.
2. **Does the PR still claim what it delivers?** Engine fixes move numbers. A body
   that said "2% false positives, the critic clears them" is false once the checks
   raise none. Rewrite the body. A PR that lies about itself is a bug in the PR.

If a finding would change the product's direction rather than its correctness,
**stop and ask the user**. Examples: a benchmark headline that no longer holds; a
feature whose only evidence says it does nothing. Those are theirs to decide.

## Convergence

After each pass, record: gates passed, findings confirmed, findings fixed.

- **Converged** when `PR_LOOP_DRY_PASSES` consecutive passes confirm zero new
  findings AND `pr-verify.sh` exits 0 AND CI is green on the head commit.
- **Not converged** and passes < `PR_LOOP_MAX_PASSES`: run another pass.
- **Cap exhausted**: stop. Alert. Write what is still broken. Do not merge.

Churn is a signal. If pass 3 finds as much as pass 1, the PR needs a rewrite, not
another loop.

## Before merging

Merging is the only irreversible step. It requires all of:

- [ ] `scripts/pr-verify.sh` exits 0
- [ ] CI green on the head commit (`gh pr checks`)
- [ ] Zero unresolved blocker findings
- [ ] The honesty rules hold, in code and in copy
- [ ] The PR body describes what the PR now does
- [ ] `PR_LOOP_MERGE=1`

If any box is unchecked, **do not merge**. Post the review, alert, and stop. A PR
that sits for a day costs nothing. A wrong merge costs a revert and the trust of
whoever reads the number it published.

When merging a stack, merge parents first, and re-verify the composed tree before
pushing. Conflicts that do not exist pairwise appear in sequence. Resolve them by
reading both sides: `-X theirs` silently drops the other side's imports.

Ask for a second opinion on judgement calls with **superpowers:requesting-code-review**,
or run the `codex` skill so a different model argues with the conclusion.

## Encode the fix

A fix that lives only in a transcript runs zero times. Before you close the loop:

1. If a bug class is machine-detectable, add a gate to `scripts/pr-verify.sh`.
2. If a review missed something, add the question to step 2 of this file.
3. Write the lesson to auto-memory so the next session starts already knowing it.
