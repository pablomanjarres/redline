import { Fragment, type CSSProperties, type ReactNode } from 'react';

/**
 * A tiny, safe Markdown renderer for notebook markdown cells: headings,
 * paragraphs, bullet lists, and fenced code. It emits React elements only and
 * never touches `dangerouslySetInnerHTML`, so an uploaded notebook cannot inject
 * markup or script. Inline markup is left as plain text on purpose; the goal is
 * a readable notebook cell, not a full Markdown engine.
 */
export function Markdown({ source }: { source: string }) {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      i++;
      continue;
    }

    if (line.trim().startsWith('```')) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        buf.push(lines[i]);
        i++;
      }
      i++; // consume the closing fence
      blocks.push(
        <pre key={key++} className="rl-scroll" style={codeStyle}>
          {buf.join('\n')}
        </pre>,
      );
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push(
        <div key={key++} style={headingStyle(heading[1].length)}>
          {heading[2]}
        </div>,
      );
      i++;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ''));
        i++;
      }
      blocks.push(
        <ul key={key++} style={listStyle}>
          {items.map((it, n) => (
            <li key={n}>{it}</li>
          ))}
        </ul>,
      );
      continue;
    }

    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^#{1,4}\s+/.test(lines[i]) &&
      !lines[i].trim().startsWith('```')
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={key++} style={paraStyle}>
        {para.join(' ')}
      </p>,
    );
  }

  return <Fragment>{blocks}</Fragment>;
}

function headingStyle(level: number): CSSProperties {
  const size = level <= 1 ? 20 : level === 2 ? 16 : 13.5;
  return {
    margin: level <= 1 ? '2px 0 6px' : '10px 0 4px',
    font: `400 ${size}px/1.25 var(--display)`,
    letterSpacing: '-.01em',
    color: 'var(--ink)',
  };
}

const paraStyle: CSSProperties = {
  margin: '0 0 8px',
  font: '400 13px/1.6 var(--sans)',
  color: 'var(--ink-2)',
};

const listStyle: CSSProperties = {
  margin: '0 0 8px',
  paddingLeft: 20,
  font: '400 13px/1.6 var(--sans)',
  color: 'var(--ink-2)',
};

const codeStyle: CSSProperties = {
  margin: '0 0 8px',
  padding: '10px 12px',
  overflowX: 'auto',
  font: '400 12px/1.55 var(--mono)',
  color: 'var(--ink)',
  background: 'var(--void)',
  border: '1px solid var(--edge-2)',
  borderRadius: 8,
};
