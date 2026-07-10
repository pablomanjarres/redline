/**
 * Read a serialized .ipynb into the cells the corrected page shows inline, and a
 * tiny markdown renderer for the notebook's markdown cells. Both fail soft: a
 * malformed notebook yields no cells rather than a crash, because the download
 * button is always the reliable path.
 *
 * The renderer is deliberately small. The notebook this app builds uses only
 * headings, paragraphs, and the occasional bullet list, so a full markdown engine
 * would be weight with no payoff.
 */

export interface NbCellView {
  type: 'markdown' | 'code';
  /** The cell body, with the nbformat line array joined back into text. */
  source: string;
}

function joinSource(src: unknown): string {
  if (Array.isArray(src)) return src.filter((l) => typeof l === 'string').join('');
  if (typeof src === 'string') return src;
  return '';
}

export function parseNotebook(json: string): NbCellView[] {
  let nb: unknown;
  try {
    nb = JSON.parse(json);
  } catch {
    return [];
  }
  const cells = (nb as { cells?: unknown })?.cells;
  if (!Array.isArray(cells)) return [];
  const out: NbCellView[] = [];
  for (const c of cells) {
    if (!c || typeof c !== 'object') continue;
    const type = (c as { cell_type?: unknown }).cell_type;
    if (type !== 'markdown' && type !== 'code') continue;
    out.push({ type, source: joinSource((c as { source?: unknown }).source) });
  }
  return out;
}

export type MdBlock =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'bullet'; items: string[] }
  | { kind: 'para'; text: string };

function isBullet(line: string): boolean {
  return /^\s*[-*]\s+/.test(line);
}

function bulletText(line: string): string {
  return line.replace(/^\s*[-*]\s+/, '').trim();
}

export function renderMarkdownLite(src: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  const lines = src.split('\n');
  let para: string[] = [];
  let bullets: string[] = [];

  const flushPara = () => {
    if (para.length > 0) {
      blocks.push({ kind: 'para', text: para.join(' ').trim() });
      para = [];
    }
  };
  const flushBullets = () => {
    if (bullets.length > 0) {
      blocks.push({ kind: 'bullet', items: bullets });
      bullets = [];
    }
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (line.trim() === '') {
      flushPara();
      flushBullets();
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushPara();
      flushBullets();
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2].trim() });
      continue;
    }
    if (isBullet(line)) {
      flushPara();
      bullets.push(bulletText(line));
      continue;
    }
    flushBullets();
    para.push(line.trim());
  }
  flushPara();
  flushBullets();
  return blocks;
}
