'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import type { Check3Config, CheckId, CheckResult } from '@redline/contracts';
import { Badge, StatTile } from '@redline/ui';
import { useSession } from '@/state/session';
import {
  ConfoundChart,
  FragilityChart,
  GroupsChart,
  SignificanceChart,
} from '@/components/charts';
import { CHECK_META } from '@/components/workbench/CheckCard';
import { KnobRail } from '@/components/check/KnobRail';
import { ReasoningStream } from '@/components/check/ReasoningStream';
import { Verdict } from '@/components/check/Verdict';

/** Pick the figure for a finding by its chart kind (the discriminant). */
function renderChart(result: CheckResult, cfg3: Check3Config): ReactNode {
  const chart = result.chart;
  switch (chart.kind) {
    case 'significance':
    case 'hardstop':
      return <SignificanceChart chart={chart} />;
    case 'groups':
      return <GroupsChart chart={chart} />;
    case 'fragility':
      return <FragilityChart chart={chart} cfg={cfg3} />;
    case 'confound':
      return <ConfoundChart chart={chart} />;
    default:
      return null;
  }
}

/**
 * The single-check panel: a header (back, number, name, state, re-run), a MAIN
 * column (claim, figure or running skeleton, stat row, reasoning, verdict), and
 * the knob rail. All state comes from the session.
 */
export function CheckPanel({ checkId }: { checkId: CheckId }) {
  const { results, running, reasoning, reveal, cfg, claims, runCheck } = useSession();
  const result = results[checkId];
  const isRunning = running[checkId];
  const meta = CHECK_META[checkId];
  const claim = claims.find((c) => c.check === checkId)?.text ?? '';
  const revealed = (reasoning[checkId] ?? []).slice(0, reveal[checkId] ?? 0);
  const showChart = !!result && !isRunning;

  return (
    <div style={{ maxWidth: 1240, margin: '0 auto', padding: '26px 40px 64px' }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <Link
          href="/workbench"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            font: '500 12.5px/1 var(--sans)',
            color: 'var(--ink2)',
            textDecoration: 'none',
            background: 'var(--panel)',
            border: '1px solid var(--line2)',
            padding: '9px 13px',
            borderRadius: 8,
          }}
        >
          ← Workbench
        </Link>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <span style={{ font: '600 12px/1 var(--mono)', color: 'var(--ink3)' }}>
              CHECK 0{checkId}
            </span>
            <h1 style={{ margin: 0, font: '600 19px/1.1 var(--sans)', color: 'var(--ink)' }}>
              {meta.name}
            </h1>
          </div>
          <div style={{ marginTop: 3, font: '400 12.5px/1 var(--sans)', color: 'var(--ink3)' }}>
            {meta.sub}
          </div>
        </div>
        {isRunning || result ? (
          <Badge state={result ? result.state : 'ready'} running={isRunning} />
        ) : null}
        <button
          onClick={() => void runCheck(checkId)}
          style={{
            font: '600 12.5px/1 var(--sans)',
            color: '#fff',
            background: 'var(--accent)',
            padding: '10px 15px',
            borderRadius: 8,
            border: 'none',
            cursor: 'pointer',
          }}
        >
          Re-run
        </button>
      </div>

      <div style={{ display: 'flex', gap: 26, marginTop: 22, alignItems: 'flex-start' }}>
        {/* MAIN */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ font: '400 13px/1.5 var(--serif)', color: 'var(--ink3)' }}>
            Auditing your claim: <span style={{ color: 'var(--ink2)' }}>“{claim}”</span>
          </div>

          {/* figure / running */}
          <div
            style={{
              marginTop: 12,
              background: 'var(--panel)',
              border: '1px solid var(--line2)',
              borderRadius: 13,
              padding: '22px 24px',
              minHeight: 430,
              position: 'relative',
            }}
          >
            {showChart && result ? (
              <>
                <div
                  style={{ font: '600 15px/1.35 var(--sans)', color: 'var(--ink)', maxWidth: 640 }}
                >
                  {result.headline}
                </div>
                <div style={{ marginTop: 18 }}>{renderChart(result, cfg[3])}</div>
                <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                  {result.stats.map((s, i) => (
                    <StatTile
                      key={i}
                      label={s.label}
                      value={s.value}
                      tone={s.bad ? 'bad' : s.good ? 'good' : 'neutral'}
                    />
                  ))}
                </div>
              </>
            ) : isRunning ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span
                    style={{
                      width: 9,
                      height: 9,
                      borderRadius: '50%',
                      background: 'var(--accent)',
                      animation: 'rl-pulse 1s infinite',
                    }}
                  />
                  <span style={{ font: '600 13px/1 var(--sans)', color: 'var(--accent)' }}>
                    Re-running check {checkId}…
                  </span>
                </div>
                <div
                  style={{
                    marginTop: 22,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                    maxWidth: 520,
                  }}
                >
                  <div
                    style={{
                      height: 170,
                      borderRadius: 10,
                      background:
                        'linear-gradient(100deg,var(--panel2),var(--frame),var(--panel2))',
                      backgroundSize: '200% 100%',
                      animation: 'rl-pulse 1.4s infinite',
                    }}
                  />
                  <div
                    style={{ height: 12, width: '60%', borderRadius: 4, background: 'var(--panel2)' }}
                  />
                  <div
                    style={{ height: 12, width: '40%', borderRadius: 4, background: 'var(--panel2)' }}
                  />
                </div>
              </>
            ) : null}
          </div>

          {/* reasoning */}
          <ReasoningStream lines={revealed} running={isRunning} />

          {/* verdict */}
          {showChart && result ? <Verdict result={result} checkId={checkId} /> : null}
        </div>

        {/* knob rail */}
        <KnobRail checkId={checkId} />
      </div>
    </div>
  );
}
