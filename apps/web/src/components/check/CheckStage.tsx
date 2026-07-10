'use client';

import type { Check3Config, CheckId, CheckResult } from '@redline/contracts';
import { checkMeta, checkRecord } from '@redline/contracts';
import type { RunKey } from '@redline/engine';
import { signalColor, stateLabel } from '@redline/ui';
import { useSession } from '@/state/session';
import { DistributionStrip, renderChart } from '@/components/charts';
import { ciLabel } from '@/lib/format';
import { InstrumentRail } from '@/components/check/InstrumentRail';
import { ReasoningConsole } from '@/components/check/ReasoningConsole';
import { VerdictReadout } from '@/components/check/VerdictReadout';
import { CorrectedCodeBlock } from '@/components/check/CorrectedCodeBlock';
import { Recommendations } from '@/components/check/Recommendations';
import { BeforeAfter } from '@/components/check/BeforeAfter';

/** Name + sub for every check, keyed by id for the workbench tile and the report
 *  row (both import this). Derived from the contract registry so all eight checks
 *  (four core + four rigor) live in exactly one place. */
export const CHECK_META: Record<CheckId, { name: string; sub: string }> = checkRecord(
  (id) => ({ name: checkMeta(id).name, sub: checkMeta(id).sub }),
);

/** Slug a stat label into a stable kebab-case test id: lowercase, runs of
 *  non-alphanumerics collapse to a single dash, no leading/trailing dash.
 *  e.g. "Honest p (donor-level)" -> "honest-p-donor-level". */
function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** The repeated-run distribution behind a stat, when the check actually repeated. */
function StatInterval({ s }: { s: CheckResult['stats'][number] }) {
  if (!s.interval) return null;
  return (
    <div style={{ marginTop: 10 }}>
      <DistributionStrip iv={s.interval} accent={s.bad ? 'var(--red-2)' : s.good ? 'var(--green)' : 'var(--ink-3)'} />
      <div style={{ marginTop: 5, font: '400 9px/1.3 var(--mono)', color: 'var(--ink-4)' }}>
        {ciLabel(s.interval, s.value)} · {s.interval.n} runs
      </div>
    </div>
  );
}

/** The audit stage for one (claim, check) RUN: figure on a lightbox plate (the
 *  hero), the verdict, the corrected code, the recommendations, the before/after
 *  preview, and the instrument + console rail. The run's claim and its check both
 *  come from one run descriptor, so the named target and the audited target can
 *  never disagree (honesty rule 2). Every correction section renders from this
 *  run's result and only when the finding carries that half. */
export function CheckStage({ runKey }: { runKey: RunKey }) {
  const { runs, runCfg, results, running, reasoning, reveal, cfg, runOne } = useSession();
  const run = runs.find((r) => r.key === runKey);
  const checkId: CheckId = run?.checkId ?? 1; // the route guards the no-run case
  const claim = run?.claimText ?? '';
  const result = results[runKey];
  const isRunning = running[runKey];
  const meta = CHECK_META[checkId];
  const revealed = (reasoning[runKey] ?? []).slice(0, reveal[runKey] ?? 0);
  const state = isRunning ? 'running' : result ? result.state : 'ready';
  const light = signalColor(state);
  const showFigure = !!result && !isRunning;
  // The fragility figure needs this run's live Check-3 config (the scrub); other
  // checks never read it, so fall back to the base for a non-3 run.
  const cfg3: Check3Config = checkId === 3 && runCfg[runKey] ? (runCfg[runKey] as Check3Config) : cfg[3];

  return (
    <div style={{ maxWidth: 1360, margin: '0 auto', padding: '30px 40px 72px' }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 24 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ font: '600 12px/1 var(--mono)', color: 'var(--red)' }}>CHECK 0{checkId}</span>
            <span style={{ width: 5, height: 5, borderRadius: 5, background: 'var(--edge-hi)' }} />
            <span style={{ font: '500 10px/1 var(--mono)', letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
              {meta.sub}
            </span>
          </div>
          <h1 style={{ margin: '12px 0 0', font: '800 34px/1 var(--display)', letterSpacing: '-.02em', color: 'var(--ink)' }}>
            {meta.name}
          </h1>
          <div style={{ marginTop: 12, font: '400 12.5px/1.5 var(--mono)', color: 'var(--ink-3)', maxWidth: 720 }}>
            <span style={{ color: 'var(--ink-4)' }}>AUDITING: </span>
            <span style={{ color: 'var(--ink-2)' }}>“{claim}”</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 'none' }}>
          {(isRunning || result) && (
            <span
              data-testid="check-verdict"
              data-tour="check.badge"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                font: '700 11px/1 var(--sans)',
                letterSpacing: '.08em',
                textTransform: 'uppercase',
                color: state === 'ready' ? 'var(--ink-3)' : light,
                border: `1px solid ${state === 'ready' ? 'var(--edge-2)' : light}`,
                background: state === 'ready' ? 'transparent' : `color-mix(in srgb, ${light} 12%, transparent)`,
                padding: '9px 13px',
                borderRadius: 8,
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: 8, background: light, boxShadow: `0 0 8px ${light}`, animation: isRunning ? 'rl-pulse 1s infinite' : undefined }} />
              {isRunning ? 'Running' : stateLabel(result!.state)}
            </span>
          )}
          <button
            data-testid="rerun-check"
            data-tour="check.rerun"
            onClick={() => void runOne(runKey)}
            style={{
              font: '700 11px/1 var(--sans)',
              letterSpacing: '.06em',
              textTransform: 'uppercase',
              color: 'var(--surface)',
              background: 'var(--signal)',
              padding: '11px 16px',
              borderRadius: 8,
              border: 'none',
              cursor: 'pointer',
            }}
          >
            Re-run
          </button>
        </div>
      </div>

      {/* split: lightbox + verdict / instruments + console */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.7fr) 356px', gap: 22, marginTop: 26, alignItems: 'start' }}>
        <div style={{ minWidth: 0 }}>
          {/* lightbox plate */}
          <div data-tour="check.figure" style={{ position: 'relative', borderRadius: 16, background: 'var(--plate)', boxShadow: 'var(--plate-glow)', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '13px 18px', borderBottom: '1px solid var(--plate-line)' }}>
              <span style={{ width: 7, height: 7, borderRadius: 7, background: showFigure ? light : 'var(--plate-line)' }} />
              <span style={{ font: '600 9.5px/1 var(--mono)', letterSpacing: '.18em', textTransform: 'uppercase', color: '#8792a3' }}>Figure</span>
              {showFigure && (
                <span style={{ marginLeft: 8, font: '600 13px/1.35 var(--sans)', color: 'var(--plate-ink)' }}>{result!.headline}</span>
              )}
            </div>
            <div style={{ padding: '22px 24px 24px', minHeight: 360, display: 'flex', alignItems: 'center' }}>
              {showFigure ? (
                <div style={{ width: '100%' }}>{renderChart(result!.chart, cfg3)}</div>
              ) : (
                <div style={{ width: '100%' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 8, background: '#2563EB', animation: 'rl-pulse 1s infinite' }} />
                    <span style={{ font: '600 12px/1 var(--mono)', color: '#2563EB', letterSpacing: '.06em' }}>RUNNING CHECK {checkId}…</span>
                  </div>
                  <div style={{ marginTop: 20, height: 220, borderRadius: 12, background: 'linear-gradient(100deg,#f1f4f8,#ffffff,#f1f4f8)', backgroundSize: '200% 100%', animation: 'rl-sweep 1.3s linear infinite' }} />
                </div>
              )}
            </div>
          </div>

          {/* stat strip */}
          {showFigure && result!.stats.length > 0 && (
            <div data-tour="check.stats" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 14 }}>
              {result!.stats.map((s, i) => (
                <div key={i} data-testid={`stat-${slug(s.label)}`} style={{ flex: 1, minWidth: 130, background: 'var(--panel)', border: '1px solid var(--edge)', borderRadius: 10, padding: '13px 15px' }}>
                  <div style={{ font: '700 19px/1 var(--mono)', color: s.bad ? 'var(--red-2)' : s.good ? 'var(--green)' : 'var(--ink)' }}>{s.value}</div>
                  <div style={{ marginTop: 6, font: '400 9.5px/1.2 var(--mono)', letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>{s.label}</div>
                  <StatInterval s={s} />
                </div>
              ))}
            </div>
          )}

          {showFigure && (
            <div data-tour="check.verdict">
              <VerdictReadout result={result!} checkId={checkId} />
            </div>
          )}

          {/* The correction layer: the code that reproduces the honest analysis,
              what to do next, and the corrected result rendered beside the claim.
              Each renders only when this run's finding carries that half. */}
          {showFigure && <CorrectedCodeBlock code={result!.correctedCode} />}
          {showFigure && <Recommendations items={result!.recommendations} />}
          {showFigure && <BeforeAfter preview={result!.preview} cfg3={cfg3} />}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <InstrumentRail runKey={runKey} />
          <ReasoningConsole lines={revealed} running={isRunning} />
        </div>
      </div>
    </div>
  );
}
