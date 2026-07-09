# The PR loop

Every pull request opened on this repo gets found, alerted, reviewed to
convergence, and merged only when it can defend itself.

Three pieces, in the order they run:

| Piece | What it is | Where judgement lives |
|---|---|---|
| `scripts/pr-watch.sh` | A launchd tick. Finds PRs it has not seen, pages, enqueues. | None. Pure bash. |
| `.claude/skills/pr-loop/SKILL.md` | The self-improving review loop. | All of it. |
| `scripts/pr-verify.sh` | The machine-checkable done-condition. | None. Exit codes. |

## Why it exists

Six PRs merged into this repo on 2026-07-09. Reviewing them found three engine
bugs that every test suite had been passing over for months:

1. Pillar 2 flagged clean analyses, because Leiden was never handed the `k` the
   claim implied.
2. The clustering embedding was driven by sequencing depth, so Redline missed 5 of
   6 continuum fragility cases.
3. Pillar 4 pseudoreplicated, feeding 1140 individual cells to PyDESeq2 as if they
   were replicates. The tool that exists to catch pseudoreplication was committing
   it, and reporting the result to the scientist.

All three hid behind one missing dependency. The `[stats]` extra shipped scanpy
without `leidenalg`. scanpy imports it lazily inside `sc.tl.leiden`, a bare
`except Exception:` swallowed the `ModuleNotFoundError`, and every clustering call
silently ran KMeans. The test named `test_pillar3_runs_real_leiden_sweep` passed the
whole time without ever running Leiden.

**A test suite that runs against fallbacks verifies the fallbacks.** That is the
lesson this loop is built to never forget, which is why `pr-verify.sh` installs the
real stack and asserts `sc.tl.leiden` partitions a graph before it believes a single
passing test.

## The iron rules

| Rule | Where |
|---|---|
| Stop condition | `PR_LOOP_DRY_PASSES` consecutive findings-free passes, and `pr-verify.sh` exits 0. Capped at `PR_LOOP_MAX_PASSES`. |
| Verification | `scripts/pr-verify.sh`. An exit code, not a feeling. |
| Failure alert | `notify.sh -c pr-loop` on every abort path. |

## Switches, all default OFF

Read fresh on every tick, never cached at boot.

| Switch | Stops | How to flip |
|---|---|---|
| `.claude/pr-watch/DISABLED` | the whole watcher | `touch .claude/pr-watch/DISABLED` |
| `PR_WATCH_RUN_LOOP` | spawning the review loop. Off: the watcher only pages and enqueues. | `PR_WATCH_RUN_LOOP=1` in the plist |
| `PR_LOOP_MERGE` | merging. Off: the loop reviews and fixes, then stops. | `PR_LOOP_MERGE=1` |

Merging writes to the outside world, so it is opt-in. A bare `./scripts/pr-watch.sh`
cannot spend tokens or touch a PR.

## Install

**Install it after this PR merges, not before.** The plist runs
`redline/scripts/pr-watch.sh` from the main checkout. Bootstrap it while the
scripts live only on a feature branch and every tick exits 127 into a log nobody
reads, which is the failure mode this loop exists to prevent.

```bash
# Prime the watermark so an existing backlog does not stampede on the first tick.
./scripts/pr-watch.sh --seed

cp scripts/com.pablo.redline-pr-watch.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.pablo.redline-pr-watch.plist
launchctl list | grep redline-pr-watch      # prove it, do not claim it
```

Interval is **600s**, set in the plist and nowhere else. PRs land a few times a day,
so a review lags an open by at most one cycle. Timers do not fire while the Mac
sleeps; a PR can wait.

Run one tick now:

```bash
launchctl kickstart -k gui/$(id -u)/com.pablo.redline-pr-watch
```

## Operate

```bash
./scripts/pr-watch.sh --dry-run     # what would it do? pages nobody.
./scripts/pr-watch.sh --once 11     # consider exactly one PR
claude -p "/pr-loop 11"             # run the review loop by hand

./scripts/pr-verify.sh              # the done-condition, on the current worktree
./scripts/pr-verify.sh --skip-slow  # same, without the 14-minute foil suite
```

State lives in `.claude/pr-watch/` and is gitignored: `seen` is the watermark,
`queue` is what has been paged but not reviewed, `heartbeat` is the liveness signal,
`logs/` holds one file per loop run.

## Failure modes

| Symptom | Cause | Response |
|---|---|---|
| Watcher runs, nothing happens | every open PR is already in `seen` | `grep -vx <n> seen > t && mv t seen` to re-arm one |
| Same PR paged every tick | the watermark is unwritable | check permissions on `.claude/pr-watch/seen`; the trap alerts on this |
| Loop starts and never finishes | a Bedrock call hung, or a suite is genuinely slow | read `logs/pr-<n>-*.log`; the loop caps at `PR_LOOP_MAX_PASSES` |
| `pr-verify.sh` exits 2 | the box cannot judge (no `uv`, no `pnpm`) | fix the box. Exit 2 is not a failing PR |
| Green CI, wrong answer | the suite ran against fallbacks | that is what `assert_real_stack` exists to prevent. If it passed anyway, add a gate |

## Encode the fix

A fix that lives only in a transcript runs zero times. When the loop misses
something:

1. Machine-detectable? Add a gate to `scripts/pr-verify.sh`.
2. A question a reviewer should have asked? Add it to step 2 of the skill.
3. Either way, write the lesson to auto-memory.
