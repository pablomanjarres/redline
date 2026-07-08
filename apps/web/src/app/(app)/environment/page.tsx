import Link from 'next/link';

/**
 * The "Redline is an engine" route: a quiet, secondary surface on the dark
 * instrument, showing that the same four checks run outside this workbench.
 * Static content, no session state. The only bright element is the terminal
 * block, and even that stays on the dark --void so the workbench keeps its
 * one lightbox plate as the sole white surface.
 */

// syntax tints for the terminal — keywords cool, strings warm, comments dim,
// the two subjects (report / audit) brightened to read as the actors.
const KW = 'var(--signal)';
const STR = 'var(--amber)';
const COM = 'var(--ink-4)';
const ID = 'var(--ink)';

export default function EnvironmentPage() {
  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '48px 40px 72px' }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span
          style={{ width: 6, height: 6, borderRadius: 2, background: 'var(--signal)', boxShadow: '0 0 8px var(--signal)', flex: 'none' }}
        />
        <span style={{ font: '600 10px/1 var(--mono)', letterSpacing: '.2em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
          Beyond this workbench
        </span>
      </div>
      <h1 style={{ margin: '16px 0 0', font: '800 28px/1.14 var(--display)', letterSpacing: '-.02em', color: 'var(--ink)', maxWidth: 640 }}>
        Redline is an engine. This workbench is one way to drive it.
      </h1>
      <p style={{ margin: '14px 0 0', maxWidth: 640, font: '400 14.5px/1.6 var(--sans)', color: 'var(--ink-2)' }}>
        The same four checks run wherever your analysis lives: a notebook cell, a pipeline step, or a gate on every commit.
        Same findings, same citations, no interface required.
      </p>

      {/* terminal block — void body, raised title bar, like the reasoning console */}
      <div
        style={{
          marginTop: 30,
          background: 'var(--void)',
          border: '1px solid var(--edge)',
          borderRadius: 12,
          overflow: 'hidden',
          boxShadow: '0 24px 60px -30px rgba(0,0,0,.75)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '11px 16px',
            borderBottom: '1px solid var(--edge)',
            background: 'var(--panel)',
          }}
        >
          <span aria-hidden style={{ display: 'flex', gap: 6 }}>
            <span style={{ width: 9, height: 9, borderRadius: 9, background: 'var(--edge-hi)' }} />
            <span style={{ width: 9, height: 9, borderRadius: 9, background: 'var(--edge-hi)' }} />
            <span style={{ width: 9, height: 9, borderRadius: 9, background: 'var(--edge-hi)' }} />
          </span>
          <span style={{ marginLeft: 6, font: '500 11px/1 var(--mono)', letterSpacing: '.08em', color: 'var(--ink-3)' }}>python</span>
        </div>
        <div className="rl-scroll" style={{ padding: '20px 22px', overflowX: 'auto' }}>
          <pre style={{ margin: 0, font: '400 13px/1.8 var(--mono)', color: 'var(--ink-2)', whiteSpace: 'pre' }}>
            <span style={{ color: KW }}>from</span>
            {' redline '}
            <span style={{ color: KW }}>import</span>
            {' audit\n\n'}
            <span style={{ color: ID }}>report</span>
            {' = '}
            <span style={{ color: ID }}>audit</span>
            {'(\n    data='}
            <span style={{ color: STR }}>{'"pfc_ketamine_scRNAseq.h5ad"'}</span>
            {',\n    analysis='}
            <span style={{ color: STR }}>{'"de_analysis.ipynb"'}</span>
            {',\n)\n\n'}
            <span style={{ color: ID }}>report</span>
            {'.flags            '}
            <span style={{ color: COM }}># 2 flagged · 1 verified · 1 needs input</span>
            {'\n'}
            <span style={{ color: ID }}>report</span>
            {'.assert_clean()   '}
            <span style={{ color: COM }}># raises; fails the build if anything is flagged</span>
          </pre>
        </div>
      </div>

      {/* three places it runs */}
      <section aria-label="Where Redline runs">
        <div style={{ marginTop: 34, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{ width: 6, height: 6, borderRadius: 2, background: 'var(--signal)', boxShadow: '0 0 8px var(--signal)', flex: 'none' }}
          />
          <span style={{ font: '700 10px/1 var(--mono)', letterSpacing: '.18em', color: 'var(--ink)' }}>WHERE IT RUNS</span>
        </div>
        <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
          <EnvCard title="In the notebook" body="An inline audit beside the cell that made the claim." />
          <EnvCard title="In the pipeline" body="A step that re-checks results before they are written." />
          <EnvCard title="On every commit" body="Block a merge when a load-bearing result is fragile." />
        </div>
      </section>

      <div style={{ marginTop: 32 }}>
        <Link
          href="/workbench"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, font: '600 12.5px/1 var(--sans)', color: 'var(--signal)' }}
        >
          <span aria-hidden style={{ font: '600 13px/1 var(--mono)' }}>
            ←
          </span>
          Back to the workbench
        </Link>
      </div>
    </div>
  );
}

function EnvCard({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ background: 'var(--panel)', border: '1px solid var(--edge)', borderRadius: 12, padding: '16px 18px' }}>
      <span
        style={{ display: 'block', width: 9, height: 9, borderRadius: 2, background: 'var(--signal)', boxShadow: '0 0 8px var(--signal)' }}
      />
      <h2 style={{ margin: '14px 0 0', font: '700 14px/1.2 var(--sans)', letterSpacing: '-.01em', color: 'var(--ink)' }}>{title}</h2>
      <p style={{ margin: '6px 0 0', font: '400 12.5px/1.5 var(--sans)', color: 'var(--ink-3)' }}>{body}</p>
    </div>
  );
}
