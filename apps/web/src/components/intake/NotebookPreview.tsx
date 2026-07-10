import type { CSSProperties } from 'react';
import type { NotebookCell } from '@/lib/notebook';
import { Markdown } from './Markdown';

/**
 * Render parsed notebook cells as an actual notebook: markdown cells as prose,
 * code cells on a panel with a Jupyter-style `In [ ]:` gutter and any plain-text
 * outputs beneath. Read-only, and every source/output string is rendered as
 * React text, so an uploaded notebook cannot inject markup.
 */
export function NotebookPreview({ cells }: { cells: NotebookCell[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {cells.map((cell, i) =>
        cell.type === 'markdown' ? (
          <div key={i} style={{ padding: '6px 2px' }}>
            <Markdown source={cell.source} />
          </div>
        ) : (
          <CodeCell key={i} cell={cell} />
        ),
      )}
    </div>
  );
}

function CodeCell({ cell }: { cell: NotebookCell }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
      <div style={gutterStyle} aria-hidden>
        In [ ]:
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <pre className="rl-scroll" style={codeStyle}>
          {cell.source.replace(/\n+$/, '')}
        </pre>
        {cell.outputs && cell.outputs.length > 0 ? (
          <pre className="rl-scroll" style={outputStyle}>
            {cell.outputs.join('\n')}
          </pre>
        ) : null}
      </div>
    </div>
  );
}

const gutterStyle: CSSProperties = {
  flex: 'none',
  width: 52,
  paddingTop: 11,
  font: '400 10px/1 var(--mono)',
  color: 'var(--signal)',
  textAlign: 'right',
  userSelect: 'none',
};

const codeStyle: CSSProperties = {
  margin: 0,
  padding: '10px 12px',
  overflowX: 'auto',
  font: '400 12px/1.55 var(--mono)',
  color: 'var(--ink)',
  background: 'var(--void)',
  border: '1px solid var(--edge-2)',
  borderRadius: 8,
};

const outputStyle: CSSProperties = {
  margin: '6px 0 0',
  padding: '8px 12px',
  overflowX: 'auto',
  font: '400 11.5px/1.5 var(--mono)',
  color: 'var(--ink-3)',
  background: 'transparent',
  borderLeft: '2px solid var(--edge-2)',
  borderRadius: 0,
};
