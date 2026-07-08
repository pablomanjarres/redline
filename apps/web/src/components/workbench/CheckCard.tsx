'use client';

import Link from 'next/link';
import type { CheckId } from '@redline/contracts';
import { Badge, C, stateColor } from '@redline/ui';
import { useSession } from '@/state/session';
import { MiniChart } from '@/components/charts';

/**
 * Static pillar names + subtitles. Each names the statistical failure mode a
 * check tests for, so they hold across every scenario (the specific claim a
 * check audits comes from the loaded scenario, via the session). Exported as
 * the single source the check panel reuses.
 */
export const CHECK_META: Record<CheckId, { name: string; sub: string }> = {
  1: { name: 'Fake significance', sub: 'Non-independent data inflating a p-value' },
  2: { name: 'Fake groups', sub: "Clusters that don't replicate out of sample" },
  3: { name: 'Fragile conclusions', sub: 'Results that hinge on an arbitrary parameter' },
  4: { name: 'Confounded comparison', sub: "Two variables that can't be separated" },
};

/**
 * One workbench card: a whole-card link into the check panel. The top bar and
 * number take the verdict color, the badge shows the state, and a mini chart
 * previews the finding once the check has run.
 */
export function CheckCard({ checkId }: { checkId: CheckId }) {
  const { results, running, claims } = useSession();
  const result = results[checkId];
  const isRunning = running[checkId];
  const meta = CHECK_META[checkId];
  const claim = claims.find((c) => c.check === checkId)?.text ?? '';
  const col = isRunning ? C.accent : stateColor(result ? result.state : 'ready');
  const headline = result
    ? result.headline
    : isRunning
      ? 'Re-running…'
      : 'Not run yet. Open to run this check.';
  const error = result?.error ?? '';

  return (
    <Link
      href={`/checks/${checkId}`}
      aria-label={`Open check ${checkId}: ${meta.name}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        textAlign: 'left',
        textDecoration: 'none',
        color: 'var(--ink)',
        background: 'var(--panel)',
        border: '1px solid var(--line2)',
        borderRadius: 13,
        overflow: 'hidden',
        minHeight: 326,
      }}
    >
      <div style={{ height: 3, background: col }} />
      <div style={{ padding: '20px 22px 22px', display: 'flex', flexDirection: 'column', flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <span style={{ font: '600 12px/1 var(--mono)', color: col }}>0{checkId}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ font: '600 16px/1.2 var(--sans)', color: 'var(--ink)' }}>{meta.name}</div>
            <div style={{ marginTop: 3, font: '400 12.5px/1.35 var(--sans)', color: 'var(--ink3)' }}>
              {meta.sub}
            </div>
          </div>
          <Badge state={result ? result.state : 'ready'} running={isRunning} />
        </div>

        <div style={{ marginTop: 14, font: '400 13px/1.45 var(--serif)', color: 'var(--ink2)' }}>
          Auditing: “{claim}”
        </div>

        <div
          style={{
            marginTop: 14,
            background: 'var(--panel2)',
            border: '1px solid var(--line)',
            borderRadius: 9,
            height: 132,
            padding: '12px 14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {result ? <MiniChart checkId={checkId} result={result} /> : null}
        </div>

        <div style={{ marginTop: 14, display: 'flex', alignItems: 'flex-start', flex: 1 }}>
          <div>
            <div style={{ font: '500 13.5px/1.4 var(--sans)', color: 'var(--ink)' }}>{headline}</div>
            {error ? (
              <div
                style={{
                  marginTop: 5,
                  font: '400 11.5px/1.3 var(--mono)',
                  color: 'var(--red-deep)',
                }}
              >
                {error}
              </div>
            ) : null}
          </div>
        </div>

        <div
          style={{
            marginTop: 14,
            paddingTop: 13,
            borderTop: '1px solid var(--line)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span style={{ font: '500 12px/1 var(--sans)', color: 'var(--accent)' }}>Open &amp; operate →</span>
        </div>
      </div>
    </Link>
  );
}
