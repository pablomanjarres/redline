'use client';

import { Panel } from '@redline/ui';
import { useSession } from '@/state/session';
import { ReportItem } from '@/components/report/ReportItem';

export default function ReportPage() {
  const { report } = useSession();
  const ds = report.dataset;
  const cells = ds.cells.toLocaleString('en-US');

  const onExport = () => {
    if (typeof window !== 'undefined') window.print();
  };

  return (
    <div style={{ maxWidth: 1040, margin: '0 auto', padding: '40px 48px 72px' }}>
      {/* header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 24,
        }}
      >
        <div>
          <div
            style={{
              font: '600 11px/1 var(--mono)',
              letterSpacing: '.16em',
              color: 'var(--ink3)',
              textTransform: 'uppercase',
            }}
          >
            Audit report
          </div>
          <h1
            style={{
              margin: '12px 0 0',
              font: '500 27px/1.18 var(--serif)',
              letterSpacing: '-.01em',
              color: 'var(--ink)',
              maxWidth: 620,
            }}
          >
            {ds.title}
          </h1>
          <p style={{ margin: '9px 0 0', font: '400 13.5px/1.5 var(--sans)', color: 'var(--ink3)' }}>
            {cells} cells · {ds.replicates} {ds.replicateLabel} · from the analysis
          </p>
        </div>
        <button
          type="button"
          onClick={onExport}
          className="rl-no-print"
          style={{
            flex: 'none',
            font: '600 13px/1 var(--sans)',
            color: 'var(--ink)',
            background: 'var(--panel)',
            border: '1px solid var(--line2)',
            padding: '12px 18px',
            borderRadius: 9,
            cursor: 'pointer',
          }}
        >
          Export PDF
        </button>
      </div>

      {/* summary card */}
      <Panel style={{ marginTop: 26, padding: '22px 24px', display: 'flex', alignItems: 'center', gap: 28 }}>
        <div style={{ display: 'flex', gap: 22 }}>
          <SummaryStat value={report.flagged} label="flagged" color="var(--red-deep)" />
          <SummaryStat value={report.clean} label="verified" color="var(--pass)" />
          <SummaryStat value={report.needInput} label="need input" color="var(--amber)" />
        </div>
        <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--line2)' }} />
        <p style={{ margin: 0, flex: 1, font: '500 15px/1.5 var(--serif)', color: 'var(--ink)' }}>
          {report.verdict}
        </p>
      </Panel>

      {/* per-check findings */}
      <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {report.results.map((r) => (
          <ReportItem key={r.checkId} result={r} />
        ))}
      </div>

      {/* closing note: auditor, not corrector */}
      <p
        style={{
          margin: '22px 4px 0',
          font: '400 13px/1.6 var(--serif)',
          color: 'var(--ink3)',
          maxWidth: 640,
        }}
      >
        Redline reports evidence and flags. Except where noted, it does not overwrite your analysis.
        The rewritten conclusions above are the defensible version of each claim, for you to accept.
      </p>
    </div>
  );
}

function SummaryStat({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div>
      <div style={{ font: '600 30px/1 var(--mono)', color }}>{value}</div>
      <div style={{ marginTop: 4, font: '400 11.5px/1.2 var(--sans)', color: 'var(--ink3)' }}>
        {label}
      </div>
    </div>
  );
}
