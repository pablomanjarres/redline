'use client';

import { AttachField } from './AttachField';
import { EXAMPLE_FILENAME, EXAMPLE_NOTEBOOK, EXAMPLE_PROSE } from '@/lib/example-analysis';

/**
 * Intake slab 02: the optional attach points. The dataset alone already audits,
 * so both fields here are optional. They let the scientist add the analysis they
 * ran (a notebook or script) and what they concluded (claims or prose), so the
 * extracted claims read in their own words. Both are text, paste or upload, so
 * they feed the model directly and work in every compute mode, fixture included.
 *
 * "Load example" fills both fields with the demo's naive analysis, so a judge can
 * test the flow without writing one. "Download sample" hands back the same file,
 * to try the upload path.
 */
export function AnalysisSlab({
  notebook,
  prose,
  onNotebook,
  onProse,
}: {
  notebook: string;
  prose: string;
  onNotebook: (t: string) => void;
  onProse: (t: string) => void;
}) {
  function loadExample() {
    onNotebook(EXAMPLE_NOTEBOOK);
    onProse(EXAMPLE_PROSE);
  }

  function downloadSample() {
    if (typeof window === 'undefined') return;
    const url = URL.createObjectURL(new Blob([EXAMPLE_NOTEBOOK], { type: 'text/x-python' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = EXAMPLE_FILENAME;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div
      data-tour="intake.analysis"
      style={{ background: 'var(--panel)', border: '1px solid var(--edge)', borderRadius: 14, padding: 22 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ font: '700 11px/1 var(--mono)', color: 'var(--red)' }}>02</span>
        <span style={{ font: '700 12px/1 var(--sans)', letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink)' }}>
          Analysis
        </span>
        <span
          style={{
            marginLeft: 'auto',
            font: '600 9px/1 var(--mono)',
            letterSpacing: '.14em',
            textTransform: 'uppercase',
            color: 'var(--ink-4)',
            border: '1px solid var(--edge-2)',
            padding: '4px 7px',
            borderRadius: 5,
          }}
        >
          optional
        </span>
      </div>
      <p style={{ margin: '13px 0 12px', maxWidth: 440, font: '400 12.5px/1.55 var(--sans)', color: 'var(--ink-2)' }}>
        Redline can audit the dataset on its own. Add the analysis you ran, by paste or upload, so the claims read in your own words.
      </p>

      {/* Judges (and anyone testing) can fill both fields with the demo's naive
          analysis in one click, or download the same file to try the upload. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, margin: '0 0 16px' }}>
        <button
          type="button"
          onClick={loadExample}
          style={{
            font: '700 10.5px/1 var(--mono)',
            letterSpacing: '.08em',
            textTransform: 'uppercase',
            color: 'var(--signal)',
            background: 'var(--signal-soft)',
            border: '1px solid var(--signal)',
            padding: '8px 12px',
            borderRadius: 7,
            cursor: 'pointer',
          }}
        >
          Load example
        </button>
        <button
          type="button"
          onClick={downloadSample}
          style={{
            font: '600 10.5px/1 var(--mono)',
            letterSpacing: '.04em',
            color: 'var(--ink-4)',
            background: 'transparent',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            textDecoration: 'underline',
          }}
        >
          Download sample .py
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <AttachField
          label="Notebook or script"
          hint="Paste or upload your analysis code so the claims match the tests you actually ran."
          placeholder="# de_analysis.ipynb, or a script..."
          value={notebook}
          onChange={onNotebook}
          accept=".ipynb,.py,.r,.txt,.md"
          maxChars={200_000}
        />
        <AttachField
          label="Claims or prose"
          hint="Paste or upload an abstract, figure captions, or a plain description of what you found."
          placeholder="e.g. IL2RA knockdown significantly upregulates FOXP3 (p < 0.001)..."
          value={prose}
          onChange={onProse}
          accept=".txt,.md"
          maxChars={100_000}
        />
      </div>
    </div>
  );
}
