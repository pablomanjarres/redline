'use client';

import type { CheckId } from '@redline/contracts';
import { CHECK_IDS, CHECK_REGISTRY } from '@redline/contracts';
import type { PreparedRun } from '@redline/engine';
import { useSession } from '@/state/session';
import { RunTile } from '@/components/workbench/RunTile';

/**
 * Workbench: the audit board. One dark tile per (claim, check) RUN, each a live
 * instrument you open and operate. The founding core checks read as the spine,
 * then the rigor checks sit under a quiet subhead — but on the run model a group
 * holds every RUN whose check belongs to it, so two claims routed to the same
 * check appear as two tiles, each auditing its own claim, neither silently
 * dropped. "Re-run routed checks" fires every run a confirmed claim produced, and
 * only those. When no claim routes to any check there are no runs, so the board is
 * empty and says why rather than inventing tiles (honesty rules 1, 13); the re-run
 * button is then disabled.
 */
const boardStyle = {
  marginTop: 16,
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
  gap: 20,
} as const;

function GroupHead({ label, count }: { label: string; count: number }) {
  return (
    <div style={{ marginTop: 34, display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ width: 6, height: 6, borderRadius: 2, background: 'var(--ink-4)', flex: 'none' }} />
      <span style={{ font: '600 10px/1 var(--mono)', letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
        {label}
      </span>
      <span style={{ font: '500 10px/1 var(--mono)', color: 'var(--ink-4)' }}>{count}</span>
      <span aria-hidden style={{ flex: 1, height: 1, background: 'var(--edge)' }} />
    </div>
  );
}

function RunGroup({ label, runs }: { label: string; runs: PreparedRun[] }) {
  if (runs.length === 0) return null;
  return (
    <>
      <GroupHead label={label} count={runs.length} />
      <div style={boardStyle}>
        {runs.map((run) => (
          <RunTile key={run.key} run={run} />
        ))}
      </div>
    </>
  );
}

const groupOf = (id: CheckId) => CHECK_REGISTRY[id].group;

export default function WorkbenchPage() {
  const { runAll, runs } = useSession();
  const noneRouted = runs.length === 0;

  // Split the runs by their check's group. The registry, not a literal, decides
  // which checks are core vs rigor, so a new rigor check joins its band for free.
  const coreRuns = runs.filter((run) => groupOf(run.checkId) === 'core');
  const rigorRuns = runs.filter((run) => groupOf(run.checkId) === 'rigor');

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', padding: '36px 40px 72px' }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ font: '600 11px/1 var(--mono)', letterSpacing: '.22em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
            Workbench
          </div>
          <h1 style={{ margin: '14px 0 0', font: '800 30px/1.05 var(--display)', letterSpacing: '-.02em', color: 'var(--ink)' }}>
            {CHECK_IDS.length} checks. Operate each one.
          </h1>
          <p style={{ margin: '12px 0 0', maxWidth: 640, font: '400 13.5px/1.6 var(--sans)', color: 'var(--ink-3)' }}>
            Each check is an independent instrument with its own knobs.{' '}
            <span style={{ color: 'var(--red)', fontWeight: 600 }}>Red</span> flags a problem,{' '}
            <span style={{ color: 'var(--green)', fontWeight: 600 }}>green</span> verifies it holds,{' '}
            <span style={{ color: 'var(--amber)', fontWeight: 600 }}>amber</span> needs your input.
          </p>
        </div>
        <button
          data-tour="workbench.rerun"
          onClick={() => runAll()}
          disabled={noneRouted}
          aria-label={
            noneRouted
              ? 'No claim routes to any check yet, so there is nothing to re-run'
              : 'Re-run the routed checks'
          }
          title={noneRouted ? 'No claim routes to any check yet. Route a claim on the Claims step first.' : undefined}
          style={{
            flex: 'none',
            font: '700 11px/1 var(--sans)',
            letterSpacing: '.08em',
            textTransform: 'uppercase',
            color: 'var(--ink)',
            background: 'var(--panel-2)',
            border: '1px solid var(--edge-2)',
            padding: '12px 18px',
            borderRadius: 10,
            cursor: noneRouted ? 'not-allowed' : 'pointer',
            opacity: noneRouted ? 0.5 : 1,
          }}
        >
          Re-run routed checks
        </button>
      </div>

      {/* audit board: the founding spine then the rigor checks, one tile per run,
          or an honest empty state when nothing routes */}
      {noneRouted ? (
        <div
          data-tour="workbench.board"
          style={{
            marginTop: 30,
            border: '1px dashed var(--edge-2)',
            borderRadius: 14,
            padding: '40px 28px',
            textAlign: 'center',
          }}
        >
          <div style={{ font: '600 13px/1.5 var(--mono)', color: 'var(--ink-3)' }}>No claim routes to any check.</div>
          <div style={{ margin: '10px auto 0', maxWidth: 440, font: '400 12.5px/1.6 var(--sans)', color: 'var(--ink-4)' }}>
            Redline only audits the claims you ratified, so there is nothing to run yet. Route a claim to a check on the Claims step to bring it into the audit.
          </div>
        </div>
      ) : (
        <div data-tour="workbench.board">
          <RunGroup label="Core checks" runs={coreRuns} />
          <RunGroup label="Rigor checks" runs={rigorRuns} />
        </div>
      )}
    </div>
  );
}
