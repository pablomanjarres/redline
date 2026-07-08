'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ScenarioId } from '@redline/contracts';
import { useSession } from '@/state/session';
import { fmt } from '@/lib/format';

/**
 * Intake. Its own full-screen chrome (the pipeline shell begins at design
 * resolution). The scientist brings in the data they analyzed and the analysis
 * they ran, picks a built-in scenario, then begins the audit. Nothing is tested
 * here; the first real work happens once fields are confirmed.
 */
// Marson and Ketamine are the demo scenarios (locked fixtures), kept first. The
// last three are verification foils: they only produce numbers on the real
// `local` compute target (each reads its foil .h5ad), never the fixture path.
const SCENARIOS: { id: ScenarioId; label: string }[] = [
  { id: 'marson', label: 'Marson' },
  { id: 'ketamine', label: 'Ketamine' },
  { id: 'pfc', label: 'PFC' },
  { id: 'clean', label: 'Clean' },
  { id: 'nocounts', label: 'No counts' },
];

export default function IntakePage() {
  const { scenarioId, dataset, claims, loadScenario, resolveFields } = useSession();
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const target = process.env.NEXT_PUBLIC_REDLINE_COMPUTE_TARGET;
  const computeTargetAvailable = !!target && target !== 'fixture';

  async function onBegin() {
    if (pending) return;
    setPending(true);
    try {
      await resolveFields();
      router.push('/fields');
    } finally {
      setPending(false);
    }
  }

  const stats = [
    { v: fmt(dataset.cells), l: 'cells' },
    { v: fmt(dataset.genes), l: 'genes' },
    { v: `${dataset.replicates}`, l: dataset.replicateLabel },
    { v: `${dataset.fieldCount}`, l: 'fields' },
  ];

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* top strip */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, height: 62, padding: '0 34px', borderBottom: '1px solid var(--edge)' }}>
        <span style={{ position: 'relative' }}>
          <span style={{ font: '900 20px/1 var(--display)', letterSpacing: '-.03em', color: 'var(--ink)' }}>REDLINE</span>
          <span style={{ position: 'absolute', left: -2, right: -2, top: '54%', height: 2.5, background: 'var(--red)', borderRadius: 2, boxShadow: '0 0 8px rgba(229,72,77,.35)' }} />
        </span>
        <span style={{ font: '500 9.5px/1 var(--mono)', letterSpacing: '.22em', color: 'var(--ink-3)', border: '1px solid var(--edge-2)', padding: '5px 9px', borderRadius: 5 }}>
          STATISTICAL AUDITOR
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ font: '500 9px/1 var(--mono)', letterSpacing: '.16em', color: 'var(--ink-4)' }}>SCENARIO</span>
          <div role="group" aria-label="Choose scenario" style={{ display: 'flex', gap: 2, padding: 2, background: 'var(--panel-2)', border: '1px solid var(--edge-2)', borderRadius: 8 }}>
            {SCENARIOS.map((s) => {
              const active = scenarioId === s.id;
              return (
                <button key={s.id} type="button" aria-pressed={active} onClick={() => loadScenario(s.id)}
                  style={{ font: '600 10px/1 var(--mono)', letterSpacing: '.08em', textTransform: 'uppercase', padding: '7px 12px', borderRadius: 6, cursor: 'pointer', border: 'none', background: active ? 'var(--signal)' : 'transparent', color: active ? 'var(--surface)' : 'var(--ink-3)' }}>
                  {s.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* hero */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', maxWidth: 1080, width: '100%', margin: '0 auto', padding: '48px 40px' }}>
        <div style={{ font: '600 10px/1 var(--mono)', letterSpacing: '.24em', textTransform: 'uppercase', color: 'var(--red)' }}>Built with Claude · Life Sciences</div>
        <h1 style={{ margin: '20px 0 0', font: '900 56px/1.02 var(--display)', letterSpacing: '-.03em', color: 'var(--ink)', maxWidth: 900 }}>
          Break your own analysis<br />before Reviewer 2 does.
        </h1>
        <p style={{ margin: '20px 0 0', maxWidth: 640, font: '400 15.5px/1.6 var(--sans)', color: 'var(--ink-2)' }}>
          Drop in the data you analyzed and the analysis you ran. Redline re-runs the load-bearing statistics itself, then marks the false discoveries on your own figures, before they become a paper.
        </p>

        {/* two slabs */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginTop: 40 }}>
          {/* dataset */}
          <div style={{ background: 'var(--panel)', border: '1px solid var(--edge)', borderRadius: 14, padding: 22 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ font: '700 11px/1 var(--mono)', color: 'var(--red)' }}>01</span>
              <span style={{ font: '700 12px/1 var(--sans)', letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink)' }}>Dataset</span>
            </div>
            <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 12, background: 'var(--panel-2)', border: '1px solid var(--edge)', borderRadius: 10, padding: '13px 14px' }}>
              <span style={{ width: 34, height: 34, flex: 'none', borderRadius: 7, background: 'var(--void)', border: '1px solid var(--edge-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', font: '600 9px/1 var(--mono)', color: 'var(--signal)' }}>h5ad</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ font: '500 12.5px/1.2 var(--mono)', color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dataset.file}</div>
                <div style={{ marginTop: 3, font: '400 11px/1 var(--mono)', color: 'var(--ink-4)' }}>{dataset.sizeGB} GB · loaded</div>
              </div>
              {/* Non-actionable by design: there is no upload handler in this build, so
                  render a disabled, labelled control rather than a pointer-cursor span. */}
              <button type="button" disabled
                aria-label={computeTargetAvailable ? 'Upload .h5ad (not available in this build)' : 'Connect a compute target to audit your own data'}
                title={computeTargetAvailable ? 'Upload is not available in this build' : 'connect a compute target to audit your own data'}
                style={{ marginLeft: 'auto', font: '500 10px/1.3 var(--mono)', color: computeTargetAvailable ? 'var(--signal)' : 'var(--ink-4)', textAlign: 'right', cursor: 'not-allowed', background: 'none', border: 'none', padding: 0 }}>
                {computeTargetAvailable ? 'Upload .h5ad' : 'connect a compute\ntarget for your own'}
              </button>
            </div>
            <div style={{ marginTop: 16, display: 'flex', flexWrap: 'wrap', gap: '14px 26px' }}>
              {stats.map((s) => (
                <div key={s.l}>
                  <div style={{ font: '700 20px/1 var(--mono)', color: 'var(--ink)' }}>{s.v}</div>
                  <div style={{ marginTop: 5, font: '400 9.5px/1 var(--mono)', letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>{s.l}</div>
                </div>
              ))}
            </div>
          </div>

          {/* analysis */}
          <div style={{ background: 'var(--panel)', border: '1px solid var(--edge)', borderRadius: 14, padding: 22 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ font: '700 11px/1 var(--mono)', color: 'var(--red)' }}>02</span>
              <span style={{ font: '700 12px/1 var(--sans)', letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink)' }}>Analysis</span>
            </div>
            <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 12, background: 'var(--panel-2)', border: '1px solid var(--edge)', borderRadius: 10, padding: '13px 14px' }}>
              <span style={{ width: 34, height: 34, flex: 'none', borderRadius: 7, background: 'var(--void)', border: '1px solid var(--edge-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', font: '600 8px/1 var(--mono)', color: 'var(--signal)' }}>ipynb</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ font: '500 12.5px/1.2 var(--mono)', color: 'var(--ink)' }}>de_analysis.ipynb</div>
                <div style={{ marginTop: 3, font: '400 11px/1 var(--mono)', color: 'var(--ink-4)' }}>31 cells · read</div>
              </div>
            </div>
            <div style={{ marginTop: 16, font: '400 10px/1 var(--mono)', letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
              {claims.length} load-bearing claims to audit
            </div>
            <div style={{ marginTop: 11, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {claims.map((c) => (
                <div key={c.id} style={{ display: 'flex', gap: 9, font: '400 12px/1.4 var(--sans)', color: 'var(--ink-2)' }}>
                  <span style={{ font: '600 10px/1.5 var(--mono)', color: 'var(--red)', flex: 'none' }}>0{c.check}</span>
                  <span>“{c.text}”</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* begin */}
        <div style={{ marginTop: 34, display: 'flex', alignItems: 'center', gap: 20 }}>
          <button type="button" onClick={onBegin} disabled={pending}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 10, font: '800 13px/1 var(--sans)', letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--surface)', background: 'var(--signal)', padding: '16px 26px', borderRadius: 10, border: 'none', cursor: pending ? 'default' : 'pointer', opacity: pending ? 0.7 : 1, boxShadow: '0 10px 24px -8px rgba(37,99,235,.45)' }}>
            {pending ? 'Resolving fields' : 'Begin audit'}
            <span style={{ fontSize: 15 }}>→</span>
          </button>
          <span style={{ font: '400 12px/1.5 var(--sans)', color: 'var(--ink-4)', maxWidth: 320 }}>
            First you confirm what each field means. Nothing is tested until you do.
          </span>
        </div>
      </div>
    </div>
  );
}
