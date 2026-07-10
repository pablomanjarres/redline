'use client';

import type { CSSProperties, ReactNode } from 'react';
import type { Check1Config, Check2Config, Check3Config, Check4Config } from '@redline/contracts';
import type { RunKey } from '@redline/engine';
import { useSession } from '@/state/session';
import { knobsFor } from '@/lib/knobs';

/* The instrument rail: the knobs for one (claim, check) RUN, as a dark control
   panel. Every knob writes through useSession().setRunCfg(runKey, ...), which
   edits THIS run's effective config and re-runs just this run. The Check 3 scrub
   is the one live control that moves the figure without re-running. Two runs on
   the same check keep separate knobs, because each edits its own runCfg entry. */

const label: CSSProperties = { font: '600 10px/1.3 var(--mono)', letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink-2)' };
const desc: CSSProperties = { margin: '7px 0 10px', font: '400 11px/1.5 var(--sans)', color: 'var(--ink-4)' };
const val: CSSProperties = { font: '600 11px/1 var(--mono)', color: 'var(--signal)' };

function Head({ children, value }: { children: ReactNode; value?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <span style={label}>{children}</span>
      {value && <span style={val}>{value}</span>}
    </div>
  );
}

export function InstrumentRail({ runKey }: { runKey: RunKey }) {
  const { runs, runCfg, scenarioId, setRunCfg } = useSession();
  const knobs = knobsFor(scenarioId);
  const run = runs.find((r) => r.key === runKey);
  const checkId = run?.checkId;
  const cfg = runCfg[runKey];

  // No such run (or its config): nothing to configure. The route guards this, but
  // the rail stays honest rather than rendering knobs for a run that is not there.
  if (!cfg || !checkId) return null;

  // The run's config is the union of the four check configs; within each
  // checkId branch it is exactly that check's shape, so narrow with a cast.
  const c1 = cfg as Check1Config;
  const c2 = cfg as Check2Config;
  const c3 = cfg as Check3Config;
  const c4 = cfg as Check4Config;

  return (
    <section data-tour="check.instruments" style={{ background: 'var(--panel)', border: '1px solid var(--edge)', borderRadius: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '13px 16px', borderBottom: '1px solid var(--edge)' }}>
        <span style={{ width: 6, height: 6, borderRadius: 2, background: 'var(--signal)', boxShadow: '0 0 8px var(--signal)' }} />
        <span style={{ font: '700 10px/1 var(--mono)', letterSpacing: '.18em', color: 'var(--ink)' }}>INSTRUMENTS</span>
      </div>
      <div style={{ padding: '18px 16px 20px', display: 'flex', flexDirection: 'column', gap: 20 }}>
        {checkId === 1 && (
          <>
            <div>
              <Head>Independent unit</Head>
              <div style={desc}>The field that is one true replicate. Cells nested inside it are not independent.</div>
              <select data-testid="knob-unit" data-tour="check1.unit" value={c1.unit} onChange={(e) => setRunCfg(runKey, { unit: e.target.value })} style={{ width: '100%' }} aria-label="Independent unit">
                {knobs.units.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <Head value={`α = ${c1.alpha.toFixed(2)}`}>Significance threshold</Head>
              <div style={desc}>The α below which a p-value is called significant.</div>
              <input data-testid="knob-alpha" type="range" min={0.01} max={0.1} step={0.01} value={c1.alpha} onChange={(e) => setRunCfg(runKey, { alpha: parseFloat(e.target.value) })} style={{ width: '100%' }} aria-label="Significance threshold" />
            </div>
          </>
        )}
        {checkId === 2 && (
          <>
            <div>
              <Head value={`${Math.round(c2.split * 100)}% held out`}>Held-out split</Head>
              <div style={desc}>Fraction of cells reserved to re-test the markers on data they never saw. Below 15% is too small to validate.</div>
              <input data-testid="knob-split" data-tour="check2.split" type="range" min={0.05} max={0.5} step={0.05} value={c2.split} onChange={(e) => setRunCfg(runKey, { split: parseFloat(e.target.value) })} style={{ width: '100%' }} aria-label="Held-out split" />
            </div>
            <div>
              <Head>Grouping</Head>
              <div style={{ ...desc, marginBottom: 0 }}>
                Testing the cluster labels in <span style={{ fontFamily: 'var(--mono)', color: 'var(--ink-2)' }}>{c2.grouping}</span> against the 4 claimed markers.
              </div>
            </div>
          </>
        )}
        {checkId === 3 && (
          <>
            <div>
              <Head>Group to track</Head>
              <div style={desc}>Which cluster to test for stability across settings.</div>
              <select data-testid="knob-track" data-tour="check3.track" value={c3.track} onChange={(e) => setRunCfg(runKey, { track: e.target.value })} style={{ width: '100%' }} aria-label="Group to track">
                {knobs.tracks.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <Head value={`${c3.min.toFixed(1)} – ${c3.max.toFixed(1)}`}>Resolution range</Head>
              <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                <input data-testid="knob-min" type="range" min={0.2} max={1} step={0.2} value={c3.min} onChange={(e) => setRunCfg(runKey, { min: parseFloat(e.target.value) })} style={{ flex: 1 }} aria-label="Resolution minimum" />
                <input data-testid="knob-max" type="range" min={1} max={2.5} step={0.2} value={c3.max} onChange={(e) => setRunCfg(runKey, { max: parseFloat(e.target.value) })} style={{ flex: 1 }} aria-label="Resolution maximum" />
              </div>
            </div>
            <div>
              <Head value={`step ${c3.step.toFixed(1)}`}>Step</Head>
              <input data-testid="knob-step" type="range" min={0.1} max={0.5} step={0.1} value={c3.step} onChange={(e) => setRunCfg(runKey, { step: parseFloat(e.target.value) })} style={{ width: '100%', marginTop: 8 }} aria-label="Step" />
            </div>
            <div style={{ background: 'var(--signal-soft)', border: '1px solid color-mix(in srgb, var(--signal) 30%, transparent)', borderRadius: 10, padding: '13px 14px' }}>
              <Head value={`res ${c3.scrub.toFixed(2)}`}>Scrub · live</Head>
              <div style={{ ...desc, color: 'var(--ink-3)' }}>Drag to watch the group appear and vanish. Does not re-run the test.</div>
              <input data-testid="knob-scrub" data-tour="check3.scrub" type="range" min={c3.min} max={c3.max} step={0.05} value={c3.scrub} onChange={(e) => setRunCfg(runKey, { scrub: parseFloat(e.target.value) }, { rerun: false })} style={{ width: '100%' }} aria-label="Scrub resolution" />
            </div>
          </>
        )}
        {checkId === 4 && (
          <>
            <div>
              <Head>Comparison of interest</Head>
              <div style={desc}>The contrast you want to interpret.</div>
              <span style={{ display: 'inline-flex', font: '500 12px/1 var(--mono)', padding: '9px 13px', borderRadius: 8, border: '1px solid var(--edge-2)', background: 'var(--panel-2)', color: 'var(--ink)' }}>{c4.interest}</span>
            </div>
            <div>
              <Head>Nuisance variables</Head>
              <div style={desc}>Technical fields to test against the comparison for confounding.</div>
              <div data-tour="check4.nuisance" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {knobs.nuisance.map((n) => {
                  const on = c4.nuisance.indexOf(n.value) !== -1;
                  return (
                    <button
                      key={n.value}
                      data-testid={`knob-nuisance-${n.value}`}
                      onClick={() => {
                        const cur = c4.nuisance;
                        setRunCfg(runKey, { nuisance: on ? cur.filter((x) => x !== n.value) : cur.concat([n.value]) });
                      }}
                      aria-pressed={on}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 8,
                        cursor: 'pointer',
                        font: '500 12px/1 var(--mono)',
                        padding: '9px 12px',
                        borderRadius: 8,
                        border: `1px solid ${on ? 'var(--signal)' : 'var(--edge-2)'}`,
                        background: on ? 'var(--signal-soft)' : 'var(--panel-2)',
                        color: on ? 'var(--signal)' : 'var(--ink-3)',
                      }}
                    >
                      <span style={{ width: 12, height: 12, borderRadius: 3, border: `1.5px solid ${on ? 'var(--signal)' : 'var(--ink-4)'}`, background: on ? 'var(--signal)' : 'transparent' }} />
                      {n.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
