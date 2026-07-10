'use client';

import { useRef, useState } from 'react';
import type { Check3Config, PreviewArtifact } from '@redline/contracts';
import { renderChart } from '@/components/charts';

/**
 * Fix and preview. One figure plate, two views the reader toggles between: the
 * result the scientist claimed, and the analysis they should have had. The
 * "after" figure is the output of the corrected code, never a decoration.
 *
 * The honesty invariant is structural. When the finding is unsalvageable the
 * preview carries no "after" artifact (the contract refuses one), so the honest
 * view shows the dead end in plain words: the method that was tried, its caveat,
 * and a flat statement that no valid fix exists on this data. It never shows an
 * empty chart pretending to be a result.
 *
 * The toggle is local UI state, like the Check 3 scrub. It moves the figure, it
 * does not re-run anything.
 */

type Tab = 'before' | 'after';

export function BeforeAfter({ preview, cfg3 }: { preview?: PreviewArtifact; cfg3?: Check3Config }) {
  const [tab, setTab] = useState<Tab>('before');
  const beforeRef = useRef<HTMLButtonElement>(null);
  const afterRef = useRef<HTMLButtonElement>(null);
  if (!preview) return null;

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const nextTab: Tab = tab === 'before' ? 'after' : 'before';
      setTab(nextTab);
      (nextTab === 'before' ? beforeRef : afterRef).current?.focus();
    }
  };

  return (
    <section
      data-tour="check.beforeafter"
      aria-label="Before and after: the claimed result and the honest analysis"
      style={{ marginTop: 18, background: 'var(--panel)', border: '1px solid var(--edge)', borderRadius: 12, overflow: 'hidden' }}
    >
      {/* header + tablist */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderBottom: '1px solid var(--edge)', flexWrap: 'wrap' }}>
        <span style={{ font: '700 10px/1 var(--mono)', letterSpacing: '.18em', color: 'var(--ink)' }}>BEFORE / AFTER</span>
        <div role="tablist" aria-label="Choose the claimed result or the honest analysis" onKeyDown={onKey} style={{ marginLeft: 'auto', display: 'inline-flex', gap: 4, background: 'var(--panel-2)', border: '1px solid var(--edge-2)', borderRadius: 9, padding: 3 }}>
          <Tab id="before" label="What you claimed" active={tab === 'before'} onSelect={setTab} btnRef={beforeRef} />
          <Tab id="after" label="The honest analysis" active={tab === 'after'} onSelect={setTab} btnRef={afterRef} />
        </div>
      </div>

      {/* method label always shown */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--edge)', flexWrap: 'wrap' }}>
        <span style={{ font: '600 9px/1 var(--mono)', letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>Method</span>
        <span style={{ font: '500 12px/1.4 var(--mono)', color: 'var(--ink-2)' }}>{preview.methodLabel}</span>
      </div>

      {/* the panel */}
      {tab === 'before' ? (
        <div role="tabpanel" aria-label="What you claimed" style={{ padding: '16px 18px' }}>
          <Plate label="What you claimed" tone="var(--red)">{renderChart(preview.before, cfg3)}</Plate>
        </div>
      ) : (
        <div role="tabpanel" aria-label="The honest analysis" style={{ padding: '16px 18px' }}>
          {preview.unsalvageable || preview.after === null ? (
            <DeadEnd methodLabel={preview.methodLabel} caveat={preview.caveat} />
          ) : (
            <>
              <Plate label="The honest analysis" tone="var(--green)">{renderChart(preview.after, cfg3)}</Plate>
              {preview.caveat && (
                <p style={{ margin: '12px 2px 0', font: '400 12px/1.55 var(--sans)', color: 'var(--ink-3)' }}>
                  <span style={{ font: '600 9px/1 var(--mono)', letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--amber)', marginRight: 8 }}>Caveat</span>
                  {preview.caveat}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

function Tab({
  id,
  label,
  active,
  onSelect,
  btnRef,
}: {
  id: Tab;
  label: string;
  active: boolean;
  onSelect: (t: Tab) => void;
  btnRef: React.RefObject<HTMLButtonElement | null>;
}) {
  return (
    <button
      ref={btnRef}
      role="tab"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      onClick={() => onSelect(id)}
      style={{
        font: '700 10px/1 var(--sans)',
        letterSpacing: '.05em',
        textTransform: 'uppercase',
        color: active ? 'var(--ink)' : 'var(--ink-3)',
        background: active ? 'var(--panel)' : 'transparent',
        border: active ? '1px solid var(--edge-2)' : '1px solid transparent',
        padding: '7px 11px',
        borderRadius: 7,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

function Plate({ label, tone, children }: { label: string; tone: string; children: React.ReactNode }) {
  return (
    <div style={{ borderRadius: 12, background: 'var(--plate)', boxShadow: 'var(--plate-glow)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--plate-line)' }}>
        <span style={{ width: 6, height: 6, borderRadius: 6, background: tone, flex: 'none' }} />
        <span style={{ font: '600 9px/1 var(--mono)', letterSpacing: '.16em', textTransform: 'uppercase', color: '#8792a3' }}>{label}</span>
      </div>
      <div style={{ padding: '18px 20px' }}>{children}</div>
    </div>
  );
}

function DeadEnd({ methodLabel, caveat }: { methodLabel: string; caveat?: string }) {
  return (
    <div
      style={{
        borderRadius: 12,
        border: '1px solid color-mix(in srgb, var(--red) 34%, transparent)',
        background: 'var(--red-soft)',
        padding: '22px 24px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span style={{ width: 9, height: 9, borderRadius: 2, background: 'var(--red-deep)', boxShadow: '0 0 8px var(--red)' }} />
        <span style={{ font: '700 10px/1 var(--mono)', letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--red-deep)' }}>No valid fix</span>
      </div>
      <p style={{ margin: '13px 0 0', font: '500 15px/1.5 var(--sans)', color: 'var(--ink)' }}>
        There is no honest corrected result to show. This claim cannot be rescued from this data, so Redline shows no "after" figure rather than inventing one.
      </p>
      <p style={{ margin: '11px 0 0', font: '400 12.5px/1.55 var(--sans)', color: 'var(--ink-3)' }}>
        <span style={{ font: '600 9px/1 var(--mono)', letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink-4)', marginRight: 8 }}>Tried</span>
        {methodLabel}
      </p>
      {caveat && (
        <p style={{ margin: '9px 0 0', font: '400 12.5px/1.55 var(--sans)', color: 'var(--ink-3)' }}>
          <span style={{ font: '600 9px/1 var(--mono)', letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--amber)', marginRight: 8 }}>Caveat</span>
          {caveat}
        </p>
      )}
    </div>
  );
}
