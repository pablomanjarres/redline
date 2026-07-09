'use client';

import { Fragment, useState, type ReactNode } from 'react';
import type { CorrectedCode } from '@redline/contracts';
import { downloadTextFile } from '@/lib/download';

/**
 * The corrected analysis as runnable code. The script is shown inline,
 * hand-tinted (the same span approach as the environment page: keywords cool,
 * strings warm, comments dim), readable before download. A download button
 * saves the exact file, and a copy button announces when it has copied. Renders
 * nothing when there is no corrected code for this finding.
 */

const KW = 'var(--signal)';
const STR = 'var(--amber)';
const COM = 'var(--ink-4)';
const NUM = 'var(--ink-2)';
const ID = 'var(--ink-2)';

const PY_KEYWORDS = new Set([
  'def', 'class', 'import', 'from', 'return', 'if', 'elif', 'else', 'for', 'while',
  'in', 'not', 'and', 'or', 'is', 'None', 'True', 'False', 'with', 'as', 'try',
  'except', 'finally', 'raise', 'assert', 'lambda', 'yield', 'global', 'nonlocal',
  'pass', 'break', 'continue', 'print', 'async', 'await',
]);

// One pass over the source: comments, strings (triple + single/double), keywords,
// and numbers. Everything else is left as plain identifier text. Whitespace and
// newlines survive because the gaps between matches are emitted verbatim inside
// a <pre>.
const TOKEN =
  /(#[^\n]*)|("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|([A-Za-z_]\w*)|(\d[\d_.eE+-]*)/g;

export function highlightPython(code: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(code)) !== null) {
    if (m.index > last) out.push(<Fragment key={key++}>{code.slice(last, m.index)}</Fragment>);
    const [full, comment, str, ident, num] = m;
    if (comment !== undefined) {
      out.push(<span key={key++} style={{ color: COM, fontStyle: 'italic' }}>{comment}</span>);
    } else if (str !== undefined) {
      out.push(<span key={key++} style={{ color: STR }}>{str}</span>);
    } else if (ident !== undefined) {
      out.push(
        PY_KEYWORDS.has(ident)
          ? <span key={key++} style={{ color: KW }}>{ident}</span>
          : <Fragment key={key++}>{ident}</Fragment>,
      );
    } else if (num !== undefined) {
      out.push(<span key={key++} style={{ color: NUM }}>{num}</span>);
    } else {
      out.push(<Fragment key={key++}>{full}</Fragment>);
    }
    last = m.index + full.length;
  }
  if (last < code.length) out.push(<Fragment key={key++}>{code.slice(last)}</Fragment>);
  return out;
}

export function CorrectedCodeBlock({ code }: { code?: CorrectedCode }) {
  const [copied, setCopied] = useState(false);
  if (!code) return null;

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(code.inline);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked; the download button is the reliable path */
    }
  };

  return (
    <section
      data-tour="check.code"
      aria-label="Corrected analysis code"
      style={{ marginTop: 18, background: 'var(--void)', border: '1px solid var(--edge)', borderRadius: 12, overflow: 'hidden' }}
    >
      {/* title bar: filename + entrypoint + actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderBottom: '1px solid var(--edge)', background: 'var(--panel)', flexWrap: 'wrap' }}>
        <span style={{ width: 6, height: 6, borderRadius: 2, background: 'var(--signal)', boxShadow: '0 0 8px var(--signal)', flex: 'none' }} />
        <span style={{ font: '700 10px/1 var(--mono)', letterSpacing: '.16em', color: 'var(--ink)' }}>CORRECTED CODE</span>
        <span style={{ font: '500 11px/1 var(--mono)', color: 'var(--ink-3)' }}>{code.filename}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={onCopy}
            aria-label={copied ? 'Copied to clipboard' : 'Copy the corrected code'}
            style={btnStyle}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            type="button"
            onClick={() => downloadTextFile(code.filename, code.inline, 'text/x-python')}
            aria-label={`Download ${code.filename}`}
            style={{ ...btnStyle, color: 'var(--surface)', background: 'var(--signal)', border: '1px solid var(--signal)' }}
          >
            Download
          </button>
        </div>
        {/* a polite announcement so a screen reader hears the copy result */}
        <span role="status" aria-live="polite" style={visuallyHidden}>{copied ? 'Copied to clipboard' : ''}</span>
      </div>

      {/* run line */}
      <div style={{ padding: '9px 16px', borderBottom: '1px solid var(--edge)', font: '400 11px/1.5 var(--mono)', color: 'var(--ink-3)' }}>
        <span style={{ color: 'var(--ink-4)' }}>$ </span>
        {code.entrypoint}
      </div>

      {/* the code */}
      <div className="rl-scroll" style={{ padding: '16px 18px', overflowX: 'auto', maxHeight: 420, overflowY: 'auto' }}>
        <pre style={{ margin: 0, font: '400 12.5px/1.7 var(--mono)', color: ID, whiteSpace: 'pre' }}>
          <code>{highlightPython(code.inline)}</code>
        </pre>
      </div>
    </section>
  );
}

const btnStyle = {
  font: '700 10px/1 var(--sans)',
  letterSpacing: '.06em',
  textTransform: 'uppercase' as const,
  color: 'var(--ink)',
  background: 'var(--panel-2)',
  border: '1px solid var(--edge-2)',
  padding: '8px 12px',
  borderRadius: 7,
  cursor: 'pointer',
};

const visuallyHidden = {
  position: 'absolute' as const,
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap' as const,
  border: 0,
};
