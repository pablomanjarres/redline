'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ScenarioId } from '@redline/contracts';
import { useSession } from '@/state/session';
import { TourLauncher } from '@/components/tour/TourLauncher';
import { DatasetSlab } from '@/components/intake/DatasetSlab';
import { AnalysisSlab } from '@/components/intake/AnalysisSlab';

/**
 * Intake. Its own full-screen chrome (the pipeline shell begins at design
 * resolution). One clear job: get the analysis in. A required drop for the
 * dataset, and two optional attach points (a notebook / script, and pasted
 * claims / prose) that feed the extraction agent. A single primary action opens
 * design resolution. Nothing is tested here; the first real work happens once
 * fields are confirmed, then Redline reads the analysis and proposes the claims.
 */
const SCENARIOS: { id: ScenarioId; label: string }[] = [
  { id: 'marson', label: 'Marson' },
  { id: 'ketamine', label: 'Ketamine' },
];

export default function IntakePage() {
  const { scenarioId, dataset, notebook, prose, loadScenario, resolveFields, setNotebook, setProse } =
    useSession();
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
          <TourLauncher />
          <span style={{ font: '500 9px/1 var(--mono)', letterSpacing: '.16em', color: 'var(--ink-4)' }}>SCENARIO</span>
          <div data-tour="intake.scenario" role="group" aria-label="Choose scenario" style={{ display: 'flex', gap: 2, padding: 2, background: 'var(--panel-2)', border: '1px solid var(--edge-2)', borderRadius: 8 }}>
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
        <h1 data-tour="intake.hero" style={{ margin: '20px 0 0', font: '900 56px/1.02 var(--display)', letterSpacing: '-.03em', color: 'var(--ink)', maxWidth: 900 }}>
          Break your own analysis<br />before Reviewer 2 does.
        </h1>
        <p style={{ margin: '20px 0 0', maxWidth: 640, font: '400 15.5px/1.6 var(--sans)', color: 'var(--ink-2)' }}>
          Drop in the data you analyzed and the analysis you ran. Redline re-runs the load-bearing statistics itself, then marks the false discoveries on your own figures, before they become a paper.
        </p>

        {/* two slabs: the required dataset, and the optional analysis attach points */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginTop: 40, alignItems: 'start' }}>
          <DatasetSlab dataset={dataset} computeTargetAvailable={computeTargetAvailable} />
          <AnalysisSlab notebook={notebook} prose={prose} onNotebook={setNotebook} onProse={setProse} />
        </div>

        {/* begin */}
        <div style={{ marginTop: 34, display: 'flex', alignItems: 'center', gap: 20 }}>
          <button data-tour="intake.begin" type="button" onClick={onBegin} disabled={pending}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 10, font: '800 13px/1 var(--sans)', letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--surface)', background: 'var(--signal)', padding: '16px 26px', borderRadius: 10, border: 'none', cursor: pending ? 'default' : 'pointer', opacity: pending ? 0.7 : 1, boxShadow: '0 10px 24px -8px rgba(37,99,235,.45)' }}>
            {pending ? 'Resolving fields' : 'Begin audit'}
            <span aria-hidden style={{ fontSize: 15 }}>→</span>
          </button>
          <span style={{ font: '400 12px/1.5 var(--sans)', color: 'var(--ink-4)', maxWidth: 320 }}>
            First you confirm what each field means. Then Redline reads your analysis and proposes the claims. Nothing is tested until you confirm them.
          </span>
        </div>
      </div>
    </div>
  );
}
