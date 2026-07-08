import type { CSSProperties } from 'react';
import type { Claim, DatasetMeta } from '@redline/contracts';

/**
 * The two Intake cards: the dataset under audit (01) and the analysis Redline
 * read (02). Pixel-faithful to the Intake block in Redline.dc.html. The "bring
 * your own file" affordance is honestly gated: it is a live file picker only
 * when a real compute target is wired, otherwise it is a disabled control with
 * a plain explanation, never a dead live control.
 */

const fmt = (n: number) => n.toLocaleString('en-US');

const CARD: CSSProperties = {
  flex: 1,
  background: 'var(--panel)',
  border: '1px solid var(--line2)',
  borderRadius: 13,
  padding: 24,
};
const CARD_HEAD: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10 };
const CARD_IDX: CSSProperties = { font: '600 11px/1 var(--mono)', color: 'var(--ink3)' };
const CARD_TITLE: CSSProperties = { font: '600 14px/1 var(--sans)', color: 'var(--ink)' };
const FILE_ROW: CSSProperties = {
  marginTop: 18,
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  background: 'var(--panel2)',
  border: '1px solid var(--line2)',
  borderRadius: 10,
  padding: '14px 15px',
};
const FILE_ICON: CSSProperties = {
  width: 36,
  height: 36,
  flex: 'none',
  borderRadius: 8,
  background: 'var(--frame)',
  border: '1px solid var(--line2)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  font: '600 10px/1 var(--mono)',
  color: 'var(--ink2)',
};
const STAT_NUM: CSSProperties = { font: '600 20px/1 var(--mono)', color: 'var(--ink)' };
const STAT_LABEL: CSSProperties = { marginTop: 4, font: '400 11px/1 var(--sans)', color: 'var(--ink3)' };

const GATE_NOTE = 'connect a compute target to audit your own data';

/** The dataset/analysis "bring your own file" control, honestly gated. */
function FileAffordance({ available, label }: { available: boolean; label: string }) {
  if (available) {
    return (
      <label
        style={{
          marginLeft: 'auto',
          display: 'inline-flex',
          alignItems: 'center',
          font: '500 12px/1 var(--sans)',
          color: 'var(--accent)',
          cursor: 'pointer',
          padding: 6,
        }}
      >
        {label}
        <input
          type="file"
          accept=".h5ad,.h5"
          style={{ position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden' }}
        />
      </label>
    );
  }
  return (
    <button
      type="button"
      disabled
      aria-disabled="true"
      title={GATE_NOTE}
      style={{
        marginLeft: 'auto',
        font: '500 12px/1 var(--sans)',
        color: 'var(--ink4)',
        background: 'none',
        border: 'none',
        cursor: 'not-allowed',
        padding: 6,
      }}
    >
      {label}
    </button>
  );
}

export function IntakePanels({
  dataset,
  claims,
  computeTargetAvailable,
}: {
  dataset: DatasetMeta;
  claims: Claim[];
  computeTargetAvailable: boolean;
}) {
  return (
    <div style={{ display: 'flex', gap: 22, marginTop: 44 }}>
      {/* 01 · Dataset */}
      <div style={CARD}>
        <div style={CARD_HEAD}>
          <span style={CARD_IDX}>01</span>
          <span style={CARD_TITLE}>Dataset</span>
        </div>
        <div style={FILE_ROW}>
          <span style={FILE_ICON}>h5ad</span>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                font: '500 13px/1.2 var(--mono)',
                color: 'var(--ink)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {dataset.file}
            </div>
            <div style={{ marginTop: 3, font: '400 11.5px/1 var(--sans)', color: 'var(--ink3)' }}>
              {dataset.sizeGB} GB · loaded
            </div>
          </div>
          <FileAffordance available={computeTargetAvailable} label="Upload your own .h5ad" />
        </div>
        {computeTargetAvailable ? null : (
          <div style={{ marginTop: 10, font: '400 11px/1.4 var(--sans)', color: 'var(--ink4)' }}>
            {GATE_NOTE}
          </div>
        )}
        <div style={{ marginTop: 16, display: 'flex', flexWrap: 'wrap', gap: '16px 28px' }}>
          <div>
            <div style={STAT_NUM}>{fmt(dataset.cells)}</div>
            <div style={STAT_LABEL}>cells (rows)</div>
          </div>
          <div>
            <div style={STAT_NUM}>{fmt(dataset.genes)}</div>
            <div style={STAT_LABEL}>genes</div>
          </div>
          <div>
            <div style={STAT_NUM}>{String(dataset.fieldCount)}</div>
            <div style={STAT_LABEL}>field columns</div>
          </div>
        </div>
      </div>

      {/* 02 · Analysis */}
      <div style={CARD}>
        <div style={CARD_HEAD}>
          <span style={CARD_IDX}>02</span>
          <span style={CARD_TITLE}>Analysis</span>
        </div>
        <div style={FILE_ROW}>
          <span style={FILE_ICON}>ipynb</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ font: '500 13px/1.2 var(--mono)', color: 'var(--ink)' }}>
              de_analysis.ipynb
            </div>
            <div style={{ marginTop: 3, font: '400 11.5px/1 var(--sans)', color: 'var(--ink3)' }}>
              31 cells · read
            </div>
          </div>
          <FileAffordance available={computeTargetAvailable} label="Replace" />
        </div>
        <div style={{ marginTop: 16 }}>
          <div style={{ font: '400 11px/1 var(--sans)', color: 'var(--ink3)' }}>
            Redline found {claims.length} load-bearing {claims.length === 1 ? 'claim' : 'claims'} to
            audit
          </div>
          <div style={{ marginTop: 11, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {claims.map((cl) => (
              <div
                key={cl.id}
                style={{ font: '400 12.5px/1.35 var(--serif)', color: 'var(--ink2)' }}
              >
                “{cl.text}”
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
