'use client';

import { useMemo } from 'react';
import type { CorrectedBundle } from '@redline/contracts';
import { checkMeta } from '@redline/contracts';
import { buildBundle } from '@redline/engine';
import { useSession } from '@/state/session';
import { highlightPython } from '@/components/check/CorrectedCodeBlock';
import { downloadTextFile } from '@/lib/download';

/**
 * The corrected-analysis bundle: the artifact that outlasts the week. Every
 * flagged finding's honest re-analysis, as a script you can run. Download each
 * .py, the consolidated notebook, or the README that says what was wrong and how
 * to run each fix. The scientist leaves with the fixed pipeline, not only a
 * critique.
 */
export default function CorrectedPage() {
  const { report, dataset } = useSession();

  const bundle: CorrectedBundle | null = useMemo(() => {
    try {
      return buildBundle(report, dataset);
    } catch {
      return null;
    }
  }, [report, dataset]);

  const scripts = bundle?.scripts ?? [];

  return (
    <div style={{ maxWidth: 1060, margin: '0 auto', padding: '32px 40px 80px' }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ font: '600 12px/1 var(--mono)', letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--red)' }}>
            Corrected analysis
          </div>
          <h1 style={{ margin: '13px 0 0', font: '800 30px/1.05 var(--display)', letterSpacing: '-.02em', color: 'var(--ink)', maxWidth: 720 }}>
            The fixed pipeline, ready to run.
          </h1>
          <p style={{ margin: '12px 0 0', maxWidth: 660, font: '400 13.5px/1.6 var(--sans)', color: 'var(--ink-3)' }}>
            One script per flagged finding. Each takes <code style={inlineCode}>--h5ad PATH</code>, reproduces Redline&apos;s honest
            re-analysis, and prints the corrected result. Download a single file, the consolidated notebook, or the README.
          </p>
        </div>
        {bundle && (
          <div data-tour="corrected.download" style={{ display: 'flex', gap: 8, flex: 'none', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => downloadTextFile('redline_corrected.ipynb', bundle.notebook, 'application/x-ipynb+json')}
              aria-label="Download the consolidated notebook"
              style={primaryBtn}
            >
              Download notebook
            </button>
            <button
              type="button"
              onClick={() => downloadTextFile('README.md', bundle.readme, 'text/markdown')}
              aria-label="Download the README"
              style={ghostBtn}
            >
              README
            </button>
          </div>
        )}
      </div>

      {/* scripts */}
      {scripts.length > 0 ? (
        <div data-tour="corrected.bundle" style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {scripts.map((s) => {
            const meta = checkMeta(s.checkId);
            const num = s.checkId < 10 ? `0${s.checkId}` : String(s.checkId);
            return (
              <section
                key={s.checkId}
                aria-label={`Corrected script for check ${num}, ${meta.name}`}
                style={{ background: 'var(--void)', border: '1px solid var(--edge)', borderRadius: 12, overflow: 'hidden' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px', borderBottom: '1px solid var(--edge)', background: 'var(--panel)', flexWrap: 'wrap' }}>
                  <span style={{ font: '600 12px/1 var(--mono)', color: 'var(--red)', flex: 'none' }}>{num}</span>
                  <span style={{ font: '700 14px/1.2 var(--sans)', color: 'var(--ink)' }}>{s.title}</span>
                  <span style={{ font: '500 11px/1 var(--mono)', color: 'var(--ink-3)' }}>{s.filename}</span>
                  <button
                    type="button"
                    onClick={() => downloadTextFile(s.filename, s.code, 'text/x-python')}
                    aria-label={`Download ${s.filename}`}
                    style={{ ...ghostBtn, marginLeft: 'auto' }}
                  >
                    Download .py
                  </button>
                </div>
                <div className="rl-scroll" style={{ padding: '16px 18px', overflowX: 'auto', maxHeight: 460, overflowY: 'auto' }}>
                  <pre style={{ margin: 0, font: '400 12.5px/1.7 var(--mono)', color: 'var(--ink-2)', whiteSpace: 'pre' }}>
                    <code>{highlightPython(s.code)}</code>
                  </pre>
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div
          style={{
            marginTop: 24,
            border: '1px dashed var(--edge-2)',
            borderRadius: 12,
            padding: '30px 24px',
            textAlign: 'center',
            font: '400 12.5px/1.6 var(--mono)',
            color: 'var(--ink-4)',
          }}
        >
          No corrected scripts yet. Run the checks, and every flagged finding gets a runnable fix here. A clean run leaves this
          empty, which is the honest outcome.
        </div>
      )}
    </div>
  );
}

const inlineCode = {
  font: '500 12px/1 var(--mono)',
  color: 'var(--ink-3)',
  background: 'var(--panel-2)',
  border: '1px solid var(--edge)',
  borderRadius: 4,
  padding: '1px 5px',
};

const primaryBtn = {
  font: '700 11px/1 var(--sans)',
  letterSpacing: '.06em',
  textTransform: 'uppercase' as const,
  color: 'var(--surface)',
  background: 'var(--signal)',
  border: '1px solid var(--signal)',
  padding: '11px 16px',
  borderRadius: 10,
  cursor: 'pointer',
};

const ghostBtn = {
  font: '700 11px/1 var(--sans)',
  letterSpacing: '.06em',
  textTransform: 'uppercase' as const,
  color: 'var(--ink)',
  background: 'var(--panel-2)',
  border: '1px solid var(--edge-2)',
  padding: '11px 16px',
  borderRadius: 10,
  cursor: 'pointer',
};
