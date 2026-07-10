'use client';

import { Fragment, useState, type ReactNode } from 'react';
import type { CheckConfigMap, CheckId, CorrectedCode, FieldSpec, ScenarioId } from '@redline/contracts';
import { downloadTextFile } from '@/lib/download';
import { postCheck } from '@/lib/api';
import { correctionTerminal, type CorrectionTerminal, type TermTone } from '@/lib/correction-terminal';

/**
 * The corrected analysis as runnable code. The script is shown inline,
 * hand-tinted (the same span approach as the environment page: keywords cool,
 * strings warm, comments dim), readable before download. A download button
 * saves the exact file, and a copy button announces when it has copied. Renders
 * nothing when there is no corrected code for this finding.
 *
 * When run inputs are supplied it also carries a Run action: a genuine
 * numbers-only recompute through the same ComputeTarget the audit used, which
 * reveals the corrected method's output as a terminal readout and flips the
 * before/after view to the honest result (via `onRan`). The numbers come from the
 * compute, never invented here, and the reveal names the compute seam that ran so
 * a fixture is never dressed up as a live sandbox. An unsalvageable finding shows
 * no corrected number.
 */

/** What the Run action needs to recompute this finding's corrected method. */
export interface CorrectionRunInputs {
  scenarioId: ScenarioId;
  checkId: CheckId;
  config: CheckConfigMap[CheckId];
  fields: FieldSpec[];
}

type RunPhase = 'idle' | 'running' | 'done' | 'error';

/** Honest, human label for the compute seam the numbers came from. */
function targetLabel(target: string | null): string {
  switch (target) {
    case 'fixture':
      return 'recomputed on the locked fixture';
    case 'local':
      return 'recomputed on the local engine';
    case 'cloudrun':
      return 'executed on Cloud Run';
    case 'endpoint':
      return 'executed on the configured endpoint';
    default:
      return 'recomputed by the engine';
  }
}

const TONE_COLOR: Record<TermTone, string> = {
  bad: 'var(--red-2)',
  good: 'var(--green)',
  plain: 'var(--ink-2)',
};

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

export function CorrectedCodeBlock({
  code,
  run,
  onRan,
}: {
  code?: CorrectedCode;
  run?: CorrectionRunInputs;
  onRan?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [phase, setPhase] = useState<RunPhase>('idle');
  const [terminal, setTerminal] = useState<CorrectionTerminal | null>(null);
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

  const onRun = async () => {
    if (!run || phase === 'running') return;
    setPhase('running');
    setTerminal(null);
    try {
      // A genuine numbers-only recompute through the same target the audit used.
      // On the fixture it reproduces the reported result; on a real target it runs.
      const result = await postCheck({ ...run, noReason: true });
      setTerminal(correctionTerminal(result));
      setPhase('done');
      onRan?.();
    } catch {
      // No fabricated output. Say it plainly and point at the reliable path.
      setPhase('error');
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
          {run && (
            <button
              type="button"
              data-testid="correction-run"
              onClick={() => void onRun()}
              disabled={phase === 'running'}
              aria-label="Run the corrected analysis and show its result"
              style={{
                ...btnStyle,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                color: 'var(--surface)',
                background: 'var(--green)',
                border: '1px solid var(--green)',
                cursor: phase === 'running' ? 'default' : 'pointer',
                opacity: phase === 'running' ? 0.75 : 1,
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: 7,
                  background: 'var(--surface)',
                  animation: phase === 'running' ? 'rl-pulse 1s infinite' : undefined,
                }}
              />
              {phase === 'running' ? 'Running' : phase === 'done' ? 'Run again' : 'Run'}
            </button>
          )}
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

      {/* the run reveal: the corrected method's output, from the compute the audit ran */}
      {phase !== 'idle' && <CorrectionOutput phase={phase} terminal={terminal} filename={code.filename} />}
    </section>
  );
}

/**
 * The terminal reveal under the code. It shows the command that reproduces the
 * result, the computed stats colored the same way the stat strip colors them, and
 * the verdict. Every value is the compute's own output. On an unsalvageable
 * finding it shows no corrected number. On a failed run it says so and points at
 * the download.
 */
function CorrectionOutput({
  phase,
  terminal,
  filename,
}: {
  phase: RunPhase;
  terminal: CorrectionTerminal | null;
  filename: string;
}) {
  return (
    <div
      data-testid="correction-terminal"
      aria-label="Corrected analysis result"
      style={{ borderTop: '1px solid var(--edge)', background: 'var(--void)', padding: '13px 16px 16px' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ font: '700 9px/1 var(--mono)', letterSpacing: '.16em', color: 'var(--ink-3)' }}>OUTPUT</span>
        {phase === 'done' && terminal && (
          <span style={{ font: '400 10px/1.3 var(--mono)', color: 'var(--ink-4)' }}>
            {targetLabel(terminal.target)}
          </span>
        )}
      </div>

      {phase === 'running' && (
        <div role="status" aria-live="polite" style={{ display: 'flex', alignItems: 'center', gap: 9, font: '500 12px/1 var(--mono)', color: '#2563EB' }}>
          <span aria-hidden style={{ width: 8, height: 8, borderRadius: 8, background: '#2563EB', animation: 'rl-pulse 1s infinite' }} />
          recomputing the corrected method…
        </div>
      )}

      {phase === 'error' && (
        <p role="status" aria-live="polite" style={{ margin: 0, font: '400 12px/1.55 var(--sans)', color: 'var(--ink-3)' }}>
          The correction could not run just now. Download <span style={{ font: '500 11.5px/1 var(--mono)', color: 'var(--ink-2)' }}>{filename}</span> and run it locally to reproduce the result.
        </p>
      )}

      {phase === 'done' && terminal && (
        <pre style={{ margin: 0, font: '400 12px/1.7 var(--mono)', color: 'var(--ink-2)', whiteSpace: 'pre-wrap' }}>
          <div>
            <span style={{ color: 'var(--ink-4)' }}>$ </span>
            <span style={{ color: 'var(--ink-3)' }}>{terminal.command || 'redline recompute'}</span>
          </div>
          {terminal.lines.map((l, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ color: 'var(--ink-3)' }}>{l.label}</span>
              <span aria-hidden style={{ flex: 1, minWidth: 12, borderBottom: '1px dotted var(--edge-2)', transform: 'translateY(-3px)' }} />
              <span style={{ color: TONE_COLOR[l.tone], fontWeight: 600 }}>{l.value}</span>
            </div>
          ))}
          {terminal.unsalvageable ? (
            <div style={{ marginTop: 8, color: 'var(--red-deep)' }}>
              → No valid corrected result on this data. See the dead end below.
            </div>
          ) : (
            <div style={{ marginTop: 8, color: 'var(--ink)' }}>→ {terminal.verdict}</div>
          )}
        </pre>
      )}
    </div>
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
