'use client';

import { useState } from 'react';
import { AttachField } from './AttachField';
import { NotebookField } from './NotebookField';
import { EXAMPLE_CELLS, EXAMPLE_FILENAME, EXAMPLE_NOTEBOOK, EXAMPLE_PROSE } from '@/lib/example-analysis';
import { cellsToIpynb, scriptToCells, type NotebookCell } from '@/lib/notebook';

const NOTEBOOK_MAX = 200_000;

interface NotebookView {
  cells: NotebookCell[] | null;
  name: string | null;
  notice: string | null;
  error: string | null;
}

/**
 * Intake slab 02: the optional attach points. The dataset alone already audits,
 * so both fields here are optional. Upload a notebook or script (a `.ipynb`
 * renders as a real notebook) or paste it, add what you concluded (claims or
 * prose), and the extracted claims read in your own words. Everything is text
 * fed to the model, so it works in every compute mode, fixture included.
 *
 * "Load example" fills both fields with the demo's naive analysis, so a judge can
 * test the flow without writing one. "Download sample" hands back the same
 * `.ipynb`, to try the upload path.
 *
 * This slab owns the notebook's display state (parsed cells, filename, notice,
 * error), so every path keeps the rendered notebook, header, and messages in
 * step. The flattened `notebook` text is what the parent persists and sends on.
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
  // Seed the preview from any persisted text, so a remount shows a notebook
  // rather than dumping the text into the paste box.
  const [nb, setNb] = useState<NotebookView>(() => ({
    cells: notebook ? scriptToCells(notebook) : null,
    name: null,
    notice: null,
    error: null,
  }));

  function onNotebookLoad(r: { text: string; cells: NotebookCell[]; name: string; truncated: boolean }) {
    onNotebook(r.text);
    setNb({
      cells: r.cells,
      name: r.name,
      notice: r.truncated
        ? `Showing the full notebook. The first ${NOTEBOOK_MAX.toLocaleString()} characters are sent to extraction.`
        : null,
      error: null,
    });
  }

  function onNotebookPaste(text: string) {
    onNotebook(text);
    setNb({ cells: null, name: null, notice: null, error: null });
  }

  function onNotebookClear() {
    onNotebook('');
    setNb({ cells: null, name: null, notice: null, error: null });
  }

  function loadExample() {
    onNotebook(EXAMPLE_NOTEBOOK);
    setNb({ cells: EXAMPLE_CELLS, name: EXAMPLE_FILENAME, notice: null, error: null });
    onProse(EXAMPLE_PROSE);
  }

  function downloadSample() {
    if (typeof window === 'undefined') return;
    const url = URL.createObjectURL(new Blob([cellsToIpynb(EXAMPLE_CELLS)], { type: 'application/x-ipynb+json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = EXAMPLE_FILENAME;
    // Append before click and defer the revoke, so the download starts across
    // browsers before the object URL is invalidated.
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
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
        Redline can audit the dataset on its own. Upload or paste the analysis you ran so the claims read in your own words.
      </p>

      {/* Judges (and anyone testing) can fill both fields with the demo's naive
          analysis in one click, or download the same notebook to try the upload. */}
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
          Download sample .ipynb
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <NotebookField
          value={notebook}
          cells={nb.cells}
          name={nb.name}
          notice={nb.notice}
          error={nb.error}
          onLoad={onNotebookLoad}
          onError={(message) => setNb((s) => ({ ...s, error: message }))}
          onPaste={onNotebookPaste}
          onClear={onNotebookClear}
          maxChars={NOTEBOOK_MAX}
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
