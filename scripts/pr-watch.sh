#!/usr/bin/env bash
#
# Watch this repo for pull requests that have not been reviewed yet, alert, and
# hand each one to the self-improving review loop.
#
# Deterministic work only. Every judgement lives in the `pr-loop` skill this
# script invokes. See `.claude/skills/pr-loop/SKILL.md`.
#
# Iron rules (docs: /Users/pablo/.claude/skills/designing-loops/SKILL.md):
#   stop condition  a PR is processed once; the watermark below never re-fires
#   verification    scripts/pr-verify.sh decides done, not this script
#   failure alert   notify.sh on every abort path, and on a loop that fails
#
# Kill switches, read fresh on every tick, never cached at boot:
#   .claude/pr-watch/DISABLED   file exists  -> the watcher does nothing
#   PR_WATCH_RUN_LOOP=1         env          -> spawn the review loop. Default OFF:
#                                               a bare run alerts and enqueues only,
#                                               so no accidental invocation spends
#                                               tokens or touches a PR.
#   PR_LOOP_MERGE=1             env          -> the loop may merge. Default OFF.
#
#   usage: scripts/pr-watch.sh [--dry-run] [--once <pr-number>] [--seed]
#
# --seed marks every currently-open PR as already handled without reviewing any of
# them. Run it once, when installing the watcher on a repo that already has open
# PRs, so the first tick does not stampede.

set -Eeuo pipefail

# launchd gives us almost no PATH, and none of the shell rc files run.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="$REPO_ROOT/.claude/pr-watch"
SEEN="$STATE_DIR/seen"                 # one PR number per line. The watermark.
HEARTBEAT="$STATE_DIR/heartbeat"       # mtime is the liveness signal
LOG_DIR="$STATE_DIR/logs"
NOTIFY="/Users/pablo/Projects/pushover/bin/notify.sh"
MAX_PER_TICK="${PR_WATCH_MAX_PER_TICK:-2}"   # named cap, greppable, never prose
RUN_LOOP="${PR_WATCH_RUN_LOOP:-0}"           # default OFF. Spending is opt-in.
QUEUE="$STATE_DIR/queue"                     # PRs alerted but not yet reviewed

DRY_RUN=0
SEED=0
ONCE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --seed)    SEED=1; shift ;;
    --once)    ONCE="${2:-}"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 64 ;;
  esac
done

mkdir -p "$STATE_DIR" "$LOG_DIR"
touch "$SEEN"

# The reporter is deliberately dumber than the job it reports on: plain bash, no
# jq, no node, no tool paths that rot. A reporter that can crash hides every
# failure after the day it crashes.
alert() {
  printf '[pr-watch] ALERT %s\n' "$*" >&2
  [[ -x "$NOTIFY" ]] && "$NOTIFY" -c pr-loop -m "redline pr-watch: $*" || true
}
# bash 3.2 gives the trap's own line in $LINENO, which is a lie. Report the
# command that actually failed, and preserve its exit code so launchd sees it.
trap 'rc=$?; alert "aborted (exit $rc) running: $BASH_COMMAND"; exit $rc' ERR

log() { printf '[pr-watch] %s\n' "$*"; }

# ── kill switch, read per tick ───────────────────────────────────────────────
if [[ -f "$STATE_DIR/DISABLED" ]]; then
  log "DISABLED file present; doing nothing"
  exit 0
fi

# ── preflight: fail before doing any work ────────────────────────────────────
command -v gh >/dev/null || { alert "gh not on PATH"; exit 2; }
gh auth status >/dev/null 2>&1 || { alert "gh is not authenticated"; exit 2; }

# ── list open PRs. -q keeps jq out of the failure path ───────────────────────
# Distinguish "gh failed" from "genuinely zero PRs". Conflating them (gh ... ||
# true) is how a monitor hides its own outage: a locked keyring or a rate limit
# reads as the happy path forever, which is the exact anti-pattern the loops
# playbook warns against. Capture the exit code, and alert on a real failure.
if [[ -n "$ONCE" ]]; then
  OPEN="$ONCE"
else
  if ! OPEN="$(gh pr list --state open --limit 50 --json number -q '.[].number' 2>/dev/null)"; then
    alert "gh pr list failed (auth, network, or rate limit); cannot see open PRs"
    exit 2
  fi
fi

# The watched thing disappearing is not an error: zero open PRs is the happy path,
# and it is now genuinely distinct from a gh failure (which exited 2 above).
if [[ -z "${OPEN// /}" ]]; then
  log "no open PRs"
  : > "$HEARTBEAT"
  exit 0
fi

new=()
for n in $OPEN; do
  grep -qx "$n" "$SEEN" 2>/dev/null || new+=("$n")
done

if [[ ${#new[@]} -eq 0 ]]; then
  log "no new PRs (${OPEN//$'\n'/ } already seen)"
  : > "$HEARTBEAT"
  exit 0
fi

log "new PRs: ${new[*]}"

if (( SEED )); then
  for n in "${new[@]}"; do echo "$n" >> "$SEEN"; done
  log "seeded ${#new[@]} PR(s) as already handled; none were reviewed"
  : > "$HEARTBEAT"
  exit 0
fi

count=0
for n in "${new[@]}"; do
  if (( count >= MAX_PER_TICK )); then
    log "hit PR_WATCH_MAX_PER_TICK=$MAX_PER_TICK; the rest wait for the next tick"
    break
  fi
  count=$((count + 1))

  title="$(gh pr view "$n" --json title -q .title 2>/dev/null || echo '?')"

  if (( DRY_RUN )); then
    log "DRY RUN: would alert, then run the pr-loop skill on #$n ($title)"
    continue
  fi

  # Claim before doing anything, so a crash cannot re-page every tick. A PR that
  # fails review stays claimed; the alert is what tells a human to look.
  echo "$n" >> "$SEEN"
  echo "$n" >> "$QUEUE"

  [[ -x "$NOTIFY" ]] && "$NOTIFY" -c pr-loop -m "PR #$n opened: $title" || true

  if [[ "$RUN_LOOP" != "1" ]]; then
    log "#$n queued. PR_WATCH_RUN_LOOP is not 1, so nothing is spawned."
    log "  review it with:  claude -p '/pr-loop $n'"
    continue
  fi

  logfile="$LOG_DIR/pr-$n-$(date +%Y%m%dT%H%M%S).log"
  log "handing #$n to the review loop; log: $logfile"

  # The judgement stage. Headless Claude on the Max plan, per the token ladder.
  # The skill owns the loop; this script owns only the trigger and the alert.
  if claude -p "/pr-loop $n" --permission-mode acceptEdits >"$logfile" 2>&1
  then
    log "#$n loop finished; see $logfile"
    # Reviewed: drop it from the queue. The watermark keeps it from re-firing.
    grep -vx "$n" "$QUEUE" > "$QUEUE.tmp" 2>/dev/null || true
    mv -f "$QUEUE.tmp" "$QUEUE" 2>/dev/null || true
  else
    alert "the review loop failed on PR #$n; see $logfile"
  fi
done

: > "$HEARTBEAT"
log "tick complete"
