'use client';

import { useRef, useState, type CSSProperties, type DragEvent } from 'react';
import { fmt } from '@/lib/format';
import { MAX_ANALYSIS_FILE_BYTES } from '@/lib/read-analysis-file';
import { readNotebookFile, type NotebookCell } from '@/lib/notebook';
import { NotebookPreview } from './NotebookPreview';

/**
 * The notebook / script attach point. Upload a file (drag-and-drop or click) and
 * a `.ipynb` renders as an actual notebook; a script renders as one code cell.
 * Paste still works for anyone who would rather type. The flattened text is what
 * feeds the extraction agent, so this needs no compute in any mode.
 *
 * Controlled: the parent owns the parsed `cells`, the `name`, the `notice`, and
 * any `error`, so every path that changes the field (upload, paste, Clear, or a
 * parent-driven "Load example") keeps the header, notice, and error in step.
 */
export function NotebookField({
  value,
  cells,
  name,
  notice,
  error,
  onLoad,
  onError,
  onPaste,
  onClear,
  maxChars = 200_000,
}: {
  value: string;
  cells: NotebookCell[] | null;
  name: string | null;
  notice: string | null;
  error: string | null;
  onLoad: (r: { text: string; cells: NotebookCell[]; name: string; truncated: boolean }) => void;
  onError: (message: string) => void;
  onPaste: (text: string) => void;
  onClear: () => void;
  maxChars?: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [focused, setFocused] = useState(false);

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_ANALYSIS_FILE_BYTES) {
      onError('That file is too large. Paste the relevant part instead.');
    } else {
      try {
        onLoad(await readNotebookFile(file, maxChars));
      } catch {
        onError('Could not read that notebook. Paste the text instead.');
      }
    }
    if (inputRef.current) inputRef.current.value = ''; // let the same file be re-picked
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDrag(false);
    void onFile(e.dataTransfer.files?.[0]);
  }

  const showNotebook = cells !== null && cells.length > 0;
  const cellCount = cells?.length ?? 0;
  const status = showNotebook ? `Loaded ${name ?? 'notebook'}, ${cellCount} ${cellCount === 1 ? 'cell' : 'cells'}` : '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
        <span style={labelStyle}>Notebook or script</span>
        <span style={{ font: '400 10px/1 var(--mono)', color: 'var(--ink-4)' }}>
          {value.length === 0 ? 'optional' : `${fmt(value.length)} characters`}
        </span>
      </div>

      {showNotebook ? (
        <div style={{ border: '1px solid var(--edge-2)', borderRadius: 10, overflow: 'hidden', background: 'var(--panel-2)' }}>
          <div style={notebookBarStyle}>
            <span style={{ font: '600 11px/1 var(--mono)', color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {name ?? 'notebook'}
            </span>
            <span style={{ font: '400 10px/1 var(--mono)', color: 'var(--ink-4)' }}>
              {cellCount} {cellCount === 1 ? 'cell' : 'cells'}
            </span>
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 12 }}>
              <button type="button" onClick={() => inputRef.current?.click()} style={barButtonStyle}>
                Replace
              </button>
              <button type="button" onClick={onClear} style={barButtonStyle}>
                Clear
              </button>
            </span>
          </div>
          <div
            className="rl-scroll"
            tabIndex={0}
            aria-label="Notebook preview"
            style={{ maxHeight: 320, overflowY: 'auto', padding: 14 }}
          >
            <NotebookPreview cells={cells} />
          </div>
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={onDrop}
            style={dropzoneStyle(drag)}
          >
            <span style={{ font: '600 12px/1.4 var(--sans)', color: 'var(--ink-2)' }}>
              Drop a notebook or script, or click to upload
            </span>
            <span style={{ font: '400 10.5px/1 var(--mono)', letterSpacing: '.04em', color: 'var(--ink-4)' }}>
              .ipynb renders as a notebook · .py · .r · .txt
            </span>
          </button>
          <textarea
            aria-label="Or paste your notebook or script"
            placeholder="or paste a script here..."
            value={value}
            rows={3}
            onChange={(e) => onPaste(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            className="rl-scroll"
            style={pasteStyle(focused)}
          />
        </>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".ipynb,.py,.r,.txt,.md"
        tabIndex={-1}
        onChange={(e) => onFile(e.target.files?.[0])}
        style={{ display: 'none' }}
      />

      {/* screen-reader announcement when a notebook loads or clears */}
      <div aria-live="polite" style={srOnly}>
        {status}
      </div>

      <p style={{ margin: 0, font: '400 11.5px/1.5 var(--sans)', color: 'var(--ink-4)' }}>
        Upload or paste your analysis so the claims match the tests you actually ran.
      </p>
      {notice ? (
        <p style={{ margin: 0, font: '400 11px/1.5 var(--sans)', color: 'var(--ink-4)' }}>{notice}</p>
      ) : null}
      {error ? (
        <p role="alert" style={{ margin: 0, font: '400 11px/1.5 var(--sans)', color: 'var(--red)' }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

const labelStyle: CSSProperties = {
  font: '600 10.5px/1 var(--mono)',
  letterSpacing: '.1em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
};

const srOnly: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

function dropzoneStyle(drag: boolean): CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    width: '100%',
    padding: '20px 14px',
    borderRadius: 10,
    border: `1.5px dashed ${drag ? 'var(--signal)' : 'var(--edge-2)'}`,
    background: drag ? 'var(--signal-soft)' : 'var(--void)',
    cursor: 'pointer',
    transition: 'border-color .12s ease, background .12s ease',
  };
}

function pasteStyle(focused: boolean): CSSProperties {
  return {
    resize: 'vertical',
    width: '100%',
    minHeight: 64,
    font: '400 12.5px/1.55 var(--mono)',
    color: 'var(--ink)',
    background: 'var(--void)',
    border: `1px solid ${focused ? 'var(--signal)' : 'var(--edge-2)'}`,
    borderRadius: 9,
    padding: '11px 12px',
    outline: 'none',
    boxShadow: focused ? '0 0 0 3px var(--signal-soft)' : 'none',
    transition: 'border-color .12s ease, box-shadow .12s ease',
  };
}

const notebookBarStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '9px 12px',
  borderBottom: '1px solid var(--edge-2)',
  background: 'var(--panel-3)',
};

const barButtonStyle: CSSProperties = {
  font: '600 10px/1 var(--mono)',
  letterSpacing: '.06em',
  textTransform: 'uppercase',
  color: 'var(--signal)',
  background: 'transparent',
  border: 'none',
  padding: 0,
  cursor: 'pointer',
};
