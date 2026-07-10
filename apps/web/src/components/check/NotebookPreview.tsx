'use client';

import { parseNotebook, renderMarkdownLite, type MdBlock } from '@/lib/notebook';
import { highlightPython } from './CorrectedCodeBlock';

/**
 * The consolidated corrected notebook, shown inline so the scientist reads the
 * cells before downloading: the "what was wrong" markdown beside the corrected
 * code that replaces their analysis. It renders the same notebook the Download
 * notebook button saves (parsed from that exact .ipynb JSON), so the preview and
 * the file can never disagree. Renders nothing when the notebook has no cells.
 */
export function NotebookPreview({ notebook }: { notebook: string }) {
  const cells = parseNotebook(notebook);
  if (cells.length === 0) return null;

  return (
    <section
      aria-label="Corrected notebook preview"
      style={{ marginTop: 24, background: 'var(--panel)', border: '1px solid var(--edge)', borderRadius: 12, overflow: 'hidden' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 16px', borderBottom: '1px solid var(--edge)', flexWrap: 'wrap' }}>
        <span style={{ width: 6, height: 6, borderRadius: 2, background: 'var(--signal)', boxShadow: '0 0 8px var(--signal)', flex: 'none' }} />
        <span style={{ font: '700 10px/1 var(--mono)', letterSpacing: '.18em', color: 'var(--ink)' }}>NOTEBOOK PREVIEW</span>
        <span style={{ font: '500 11px/1 var(--mono)', color: 'var(--ink-3)' }}>redline_corrected.ipynb</span>
      </div>

      <div style={{ padding: '8px 0' }}>
        {cells.map((cell, i) =>
          cell.type === 'markdown' ? (
            <MarkdownCell key={i} source={cell.source} />
          ) : (
            <CodeCell key={i} source={cell.source} />
          ),
        )}
      </div>
    </section>
  );
}

function MarkdownCell({ source }: { source: string }) {
  const blocks = renderMarkdownLite(source);
  if (blocks.length === 0) return null;
  return (
    <div style={{ padding: '10px 20px' }}>
      {blocks.map((b, i) => (
        <MarkdownBlock key={i} block={b} />
      ))}
    </div>
  );
}

const HEADING_FONT: Record<number, string> = {
  1: '800 20px/1.2 var(--display)',
  2: '800 15px/1.3 var(--display)',
  3: '700 13px/1.3 var(--sans)',
};

function MarkdownBlock({ block }: { block: MdBlock }) {
  if (block.kind === 'heading') {
    const level = Math.min(block.level, 3);
    return (
      <div style={{ font: HEADING_FONT[level] ?? HEADING_FONT[3], color: 'var(--ink)', letterSpacing: level === 1 ? '-.01em' : '0', margin: '10px 0 6px' }}>
        {block.text}
      </div>
    );
  }
  if (block.kind === 'bullet') {
    return (
      <ul style={{ margin: '6px 0', paddingLeft: 18 }}>
        {block.items.map((it, i) => (
          <li key={i} style={{ font: '400 12.5px/1.6 var(--sans)', color: 'var(--ink-2)' }}>{it}</li>
        ))}
      </ul>
    );
  }
  return <p style={{ margin: '6px 0', font: '400 12.5px/1.6 var(--sans)', color: 'var(--ink-2)' }}>{block.text}</p>;
}

function CodeCell({ source }: { source: string }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 16px 8px 12px' }}>
      <span
        aria-hidden
        style={{ flex: 'none', paddingTop: 14, width: 46, textAlign: 'right', font: '400 10px/1 var(--mono)', color: 'var(--ink-4)' }}
      >
        In [ ]:
      </span>
      <div
        className="rl-scroll"
        style={{ flex: 1, minWidth: 0, background: 'var(--void)', border: '1px solid var(--edge)', borderRadius: 8, padding: '12px 14px', overflowX: 'auto' }}
      >
        <pre style={{ margin: 0, font: '400 12px/1.7 var(--mono)', color: 'var(--ink-2)', whiteSpace: 'pre' }}>
          <code>{highlightPython(source)}</code>
        </pre>
      </div>
    </div>
  );
}
