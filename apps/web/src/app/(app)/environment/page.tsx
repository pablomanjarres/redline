import Link from 'next/link';

/**
 * The "Redline is an engine" route: a quiet, secondary surface showing that the
 * same four checks run outside this workbench. Static content, no session state.
 */
export default function EnvironmentPage() {
  return (
    <div style={{ maxWidth: 840, margin: '0 auto', padding: '52px 48px 64px' }}>
      <div
        style={{
          font: '600 11px/1 var(--mono)',
          letterSpacing: '.16em',
          color: 'var(--ink3)',
          textTransform: 'uppercase',
        }}
      >
        Beyond this workbench
      </div>
      <h1
        style={{
          margin: '12px 0 0',
          font: '500 26px/1.18 var(--serif)',
          letterSpacing: '-.01em',
          color: 'var(--ink)',
          maxWidth: 600,
        }}
      >
        Redline is an engine. This workbench is one way to drive it.
      </h1>
      <p
        style={{
          margin: '11px 0 0',
          maxWidth: 610,
          font: '400 14.5px/1.55 var(--sans)',
          color: 'var(--ink2)',
        }}
      >
        The same four checks run wherever your analysis lives: a notebook cell, a pipeline step, or a
        gate on every commit. Same findings, same citations, no interface required.
      </p>

      {/* dark code block */}
      <div
        style={{
          marginTop: 28,
          background: '#211F1B',
          borderRadius: 12,
          padding: '22px 24px',
          overflow: 'auto',
        }}
      >
        <pre style={{ margin: 0, font: '400 13px/1.75 var(--mono)', color: '#E7E3D9', whiteSpace: 'pre' }}>
          <span style={{ color: '#B0AA9C' }}>from</span>
          {' redline '}
          <span style={{ color: '#B0AA9C' }}>import</span>
          {' audit\n\nreport = audit(\n    data='}
          <span style={{ color: '#D6C29A' }}>&quot;pfc_ketamine_scRNAseq.h5ad&quot;</span>
          {',\n    analysis='}
          <span style={{ color: '#D6C29A' }}>&quot;de_analysis.ipynb&quot;</span>
          {',\n)\n\nreport.flags            '}
          <span style={{ color: '#8C887D' }}># 2 flagged · 1 verified · 1 needs input</span>
          {'\nreport.assert_clean()   '}
          <span style={{ color: '#8C887D' }}># raises; fails the build if anything is flagged</span>
        </pre>
      </div>

      {/* three cards */}
      <div
        style={{
          marginTop: 22,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: 14,
        }}
      >
        <EnvCard title="In the notebook" body="An inline audit beside the cell that made the claim." />
        <EnvCard title="In the pipeline" body="A step that re-checks results before they are written." />
        <EnvCard title="On every commit" body="Block a merge when a load-bearing result is fragile." />
      </div>

      <Link
        href="/workbench"
        style={{
          display: 'inline-block',
          marginTop: 26,
          font: '500 13px/1 var(--sans)',
          color: 'var(--accent)',
          padding: '6px 0',
        }}
      >
        ← Back to the workbench
      </Link>
    </div>
  );
}

function EnvCard({ title, body }: { title: string; body: string }) {
  return (
    <div
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--line2)',
        borderRadius: 11,
        padding: '16px 18px',
      }}
    >
      <span
        style={{
          display: 'block',
          width: 9,
          height: 9,
          borderRadius: 2,
          background: 'var(--ink3)',
        }}
      />
      <div style={{ marginTop: 12, font: '600 13px/1.2 var(--sans)', color: 'var(--ink)' }}>
        {title}
      </div>
      <div style={{ marginTop: 5, font: '400 12px/1.45 var(--sans)', color: 'var(--ink3)' }}>
        {body}
      </div>
    </div>
  );
}
