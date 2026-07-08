'use client';

import type { CSSProperties, ReactNode } from 'react';
import type { CheckId } from '@redline/contracts';
import { useSession } from '@/state/session';
import { knobsFor } from '@/lib/knobs';

/* The per-check knob rail. Every knob writes through useSession().setCfg, which
   re-runs the check and re-marks the chart. The one exception is Check 3's scrub
   slider, a live view that updates the figure without re-running the test. Knob
   options that vary by dataset (the unit choices, the tracked group, the nuisance
   candidates) come from knobsFor(scenarioId). */

const labelStyle: CSSProperties = { font: '600 12px/1 var(--sans)', color: 'var(--ink)' };
const descStyle: CSSProperties = {
  margin: '6px 0 9px',
  font: '400 11.5px/1.4 var(--sans)',
  color: 'var(--ink3)',
};
const valStyle: CSSProperties = { font: '600 12px/1 var(--mono)', color: 'var(--accent)' };

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <span style={labelStyle}>{label}</span>
      <span style={valStyle}>{value}</span>
    </div>
  );
}

function Group({ children }: { children: ReactNode }) {
  return <div>{children}</div>;
}

export function KnobRail({ checkId }: { checkId: CheckId }) {
  const { cfg, scenarioId, setCfg } = useSession();
  const knobs = knobsFor(scenarioId);

  return (
    <div
      style={{
        width: 322,
        flex: 'none',
        background: 'var(--panel)',
        border: '1px solid var(--line2)',
        borderRadius: 13,
        padding: '20px 20px 22px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 9, height: 9, borderRadius: 2, background: 'var(--accent)' }} />
        <span
          style={{
            font: '600 10.5px/1 var(--mono)',
            letterSpacing: '.14em',
            color: 'var(--ink)',
            textTransform: 'uppercase',
          }}
        >
          Knobs
        </span>
      </div>
      <div style={{ marginTop: 5, font: '400 11.5px/1.4 var(--sans)', color: 'var(--ink3)' }}>
        Turn a knob and the check re-runs and re-marks your chart.
      </div>

      <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 22 }}>
        {checkId === 1 ? (
          <>
            <Group>
              <div style={labelStyle}>Independent unit</div>
              <div style={descStyle}>
                The field that is one true replicate. Cells nested inside it are not independent.
              </div>
              <select
                value={cfg[1].unit}
                onChange={(e) => setCfg(1, { unit: e.target.value })}
                style={{ width: '100%' }}
                aria-label="Independent unit"
              >
                {knobs.units.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Group>
            <Group>
              <Row label="Significance threshold" value={`α = ${cfg[1].alpha.toFixed(2)}`} />
              <div style={descStyle}>The α below which a p-value is called significant.</div>
              <input
                type="range"
                min={0.01}
                max={0.1}
                step={0.01}
                value={cfg[1].alpha}
                onChange={(e) => setCfg(1, { alpha: parseFloat(e.target.value) })}
                style={{ width: '100%' }}
                aria-label="Significance threshold"
              />
            </Group>
          </>
        ) : null}

        {checkId === 2 ? (
          <>
            <Group>
              <Row
                label="Held-out split"
                value={`${Math.round(cfg[2].split * 100)}% held out`}
              />
              <div style={descStyle}>
                Fraction of cells reserved to re-test the markers on data they never saw. Below 15%
                is too small to validate.
              </div>
              <input
                type="range"
                min={0.05}
                max={0.5}
                step={0.05}
                value={cfg[2].split}
                onChange={(e) => setCfg(2, { split: parseFloat(e.target.value) })}
                style={{ width: '100%' }}
                aria-label="Held-out split"
              />
            </Group>
            <Group>
              <div style={labelStyle}>Grouping</div>
              <div style={{ ...descStyle, marginBottom: 0 }}>
                Testing the cluster labels in{' '}
                <span style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{cfg[2].grouping}</span>{' '}
                against the 4 claimed markers.
              </div>
            </Group>
          </>
        ) : null}

        {checkId === 3 ? (
          <>
            <Group>
              <div style={labelStyle}>Group to track</div>
              <div style={descStyle}>Which cluster to test for stability across settings.</div>
              <select
                value={cfg[3].track}
                onChange={(e) => setCfg(3, { track: e.target.value })}
                style={{ width: '100%' }}
                aria-label="Group to track"
              >
                {knobs.tracks.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Group>
            <Group>
              <Row
                label="Resolution range"
                value={`${cfg[3].min.toFixed(1)} – ${cfg[3].max.toFixed(1)}`}
              />
              <div style={descStyle}>The clustering-parameter sweep to test over.</div>
              <div style={{ display: 'flex', gap: 10 }}>
                <input
                  type="range"
                  min={0.2}
                  max={1}
                  step={0.2}
                  value={cfg[3].min}
                  onChange={(e) => setCfg(3, { min: parseFloat(e.target.value) })}
                  style={{ flex: 1 }}
                  aria-label="Resolution range minimum"
                />
                <input
                  type="range"
                  min={1}
                  max={2.5}
                  step={0.2}
                  value={cfg[3].max}
                  onChange={(e) => setCfg(3, { max: parseFloat(e.target.value) })}
                  style={{ flex: 1 }}
                  aria-label="Resolution range maximum"
                />
              </div>
            </Group>
            <Group>
              <Row label="Step" value={`step ${cfg[3].step.toFixed(1)}`} />
              <input
                type="range"
                min={0.1}
                max={0.5}
                step={0.1}
                value={cfg[3].step}
                onChange={(e) => setCfg(3, { step: parseFloat(e.target.value) })}
                style={{ width: '100%', marginTop: 8 }}
                aria-label="Step"
              />
            </Group>
            <div style={{ background: 'var(--accent-soft)', borderRadius: 9, padding: '13px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ font: '600 12px/1 var(--sans)', color: 'var(--accent)' }}>
                  Scrub resolution
                </span>
                <span style={valStyle}>{`res ${cfg[3].scrub.toFixed(2)}`}</span>
              </div>
              <div style={{ margin: '6px 0 10px', font: '400 11.5px/1.4 var(--sans)', color: 'var(--ink2)' }}>
                A live view. Drag to watch the group appear and vanish. It does not re-run the test.
              </div>
              <input
                type="range"
                min={cfg[3].min}
                max={cfg[3].max}
                step={0.05}
                value={cfg[3].scrub}
                onChange={(e) => setCfg(3, { scrub: parseFloat(e.target.value) }, { rerun: false })}
                style={{ width: '100%' }}
                aria-label="Scrub resolution"
              />
            </div>
          </>
        ) : null}

        {checkId === 4 ? (
          <>
            <Group>
              <div style={labelStyle}>Comparison of interest</div>
              <div style={descStyle}>The contrast you want to interpret.</div>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  font: '500 12.5px/1 var(--mono)',
                  padding: '9px 13px',
                  borderRadius: 8,
                  border: '1px solid var(--line2)',
                  background: 'var(--panel2)',
                  color: 'var(--ink)',
                }}
              >
                {cfg[4].interest}
              </div>
            </Group>
            <Group>
              <div style={labelStyle}>Nuisance variables</div>
              <div style={descStyle}>
                Technical fields to test against the comparison for confounding.
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {knobs.nuisance.map((n) => {
                  const on = cfg[4].nuisance.indexOf(n.value) !== -1;
                  return (
                    <button
                      key={n.value}
                      onClick={() => {
                        const cur = cfg[4].nuisance;
                        const next = on ? cur.filter((x) => x !== n.value) : cur.concat([n.value]);
                        setCfg(4, { nuisance: next });
                      }}
                      aria-pressed={on}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 8,
                        cursor: 'pointer',
                        font: '500 12.5px/1 var(--mono)',
                        padding: '9px 13px',
                        borderRadius: 8,
                        border: `1px solid ${on ? 'var(--accent)' : 'var(--line2)'}`,
                        background: on ? 'var(--accent-soft)' : 'var(--panel)',
                        color: on ? 'var(--accent)' : 'var(--ink2)',
                      }}
                    >
                      <span
                        style={{
                          width: 14,
                          height: 14,
                          borderRadius: 4,
                          border: `1.5px solid ${on ? 'var(--accent)' : 'var(--ink4)'}`,
                          background: on ? 'var(--accent)' : 'transparent',
                        }}
                      />
                      {n.label}
                    </button>
                  );
                })}
              </div>
            </Group>
          </>
        ) : null}
      </div>
    </div>
  );
}
