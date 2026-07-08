'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ScenarioId } from '@redline/contracts';
import { useSession } from '@/state/session';
import { IntakePanels } from '@/components/intake/IntakePanels';

/**
 * Step 1 of 3, Intake. Its own chrome (a 58px header, not the app shell). The
 * scientist brings in the data they analyzed and the analysis they ran, picks a
 * built-in scenario, then resolves fields. Pixel-faithful to the Intake block in
 * Redline.dc.html. Nothing is tested here; the first real work happens once
 * fields are confirmed.
 */

const SCENARIOS: { id: ScenarioId; label: string }[] = [
  { id: 'marson', label: 'Marson' },
  { id: 'ketamine', label: 'Ketamine' },
];

export default function IntakePage() {
  const { scenarioId, dataset, claims, loadScenario, resolveFields } = useSession();
  const router = useRouter();
  const [pending, setPending] = useState(false);

  // A real compute target has to be wired before we can audit an uploaded file.
  // The fixture demo runs without one, so the upload affordance stays honestly
  // disabled unless NEXT_PUBLIC_REDLINE_COMPUTE_TARGET names a real target.
  const target = process.env.NEXT_PUBLIC_REDLINE_COMPUTE_TARGET;
  const computeTargetAvailable = !!target && target !== 'fixture';

  async function onResolve() {
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
    // Intake carries its own full-height chrome: it renders under the root layout
    // only (the topbar/sidebar shell belongs to the (app) route group). This div
    // is the design source's outer wrapper (height:100vh clipped flex column).
    <div
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: 'var(--desk)',
      }}
    >
      {/* header (own chrome) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '0 26px',
          height: 58,
          borderBottom: '1px solid var(--line)',
          background: 'var(--panel)',
          flex: 'none',
        }}
      >
        <span style={{ font: '600 16px/1 var(--sans)', letterSpacing: '-.01em', color: 'var(--ink)' }}>
          Redline
        </span>
        <span
          style={{
            font: '500 10.5px/1 var(--mono)',
            letterSpacing: '.14em',
            color: 'var(--ink3)',
            textTransform: 'uppercase',
            border: '1px solid var(--line2)',
            padding: '5px 8px',
            borderRadius: 20,
          }}
        >
          Statistical auditor
        </span>

        {/* scenario switch */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 9 }}>
          <span
            style={{
              font: '500 10px/1 var(--mono)',
              letterSpacing: '.12em',
              color: 'var(--ink4)',
              textTransform: 'uppercase',
            }}
          >
            Scenario
          </span>
          <div
            role="group"
            aria-label="Choose scenario"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              padding: 2,
              background: 'var(--panel2)',
              border: '1px solid var(--line2)',
              borderRadius: 20,
            }}
          >
            {SCENARIOS.map((s) => {
              const active = scenarioId === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => loadScenario(s.id)}
                  style={{
                    font: '600 10.5px/1 var(--mono)',
                    letterSpacing: '.08em',
                    textTransform: 'uppercase',
                    padding: '6px 11px',
                    borderRadius: 16,
                    cursor: 'pointer',
                    border: `1px solid ${active ? 'var(--line2)' : 'transparent'}`,
                    background: active ? 'var(--panel)' : 'transparent',
                    color: active ? 'var(--ink)' : 'var(--ink3)',
                  }}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
        </div>

        <span style={{ font: '400 12.5px/1 var(--sans)', color: 'var(--ink3)' }}>
          Step 1 of 3 · Intake
        </span>
      </div>

      {/* body */}
      <div style={{ flex: 1, overflow: 'auto', display: 'flex' }} className="rl-scroll">
        <div
          style={{
            flex: 1,
            maxWidth: 920,
            margin: '0 auto',
            padding: '64px 48px 56px',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <h1
            style={{
              margin: 0,
              font: '500 34px/1.12 var(--serif)',
              letterSpacing: '-.01em',
              color: 'var(--ink)',
            }}
          >
            Bring in the work you want checked.
          </h1>
          <p
            style={{
              margin: '14px 0 0',
              maxWidth: 620,
              font: '400 16px/1.55 var(--sans)',
              color: 'var(--ink2)',
            }}
          >
            Two things: the data you analyzed and the analysis you ran. Redline reads both, then asks
            you to confirm what each field means before it tests anything.
          </p>

          <IntakePanels
            dataset={dataset}
            claims={claims}
            computeTargetAvailable={computeTargetAvailable}
          />

          <div style={{ marginTop: 40, display: 'flex', alignItems: 'center', gap: 18 }}>
            <button
              type="button"
              onClick={onResolve}
              disabled={pending}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 9,
                font: '600 14px/1 var(--sans)',
                color: '#fff',
                background: 'var(--accent)',
                padding: '15px 24px',
                borderRadius: 10,
                border: 'none',
                cursor: pending ? 'default' : 'pointer',
                opacity: pending ? 0.7 : 1,
              }}
            >
              {pending ? 'Resolving fields' : 'Resolve fields'}
              <span style={{ fontSize: 15 }}>→</span>
            </button>
            <span
              style={{
                font: '400 12.5px/1.45 var(--sans)',
                color: 'var(--ink3)',
                maxWidth: 340,
              }}
            >
              Next you confirm what each field means. Nothing is tested until you do.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
