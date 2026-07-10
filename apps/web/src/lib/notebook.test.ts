import { describe, expect, it } from 'vitest';
import { parseNotebook, renderMarkdownLite } from './notebook';

/**
 * The corrected notebook is shown inline so the scientist reads the cells before
 * downloading. The parser must handle the nbformat this app emits (source as an
 * array of lines) and fail soft on anything malformed, and the markdown-lite
 * renderer must turn the notebook's headings and paragraphs into legible blocks.
 */
describe('parseNotebook', () => {
  const nb = JSON.stringify({
    cells: [
      { cell_type: 'markdown', metadata: {}, source: ['# Redline corrected analysis\n', '\n', 'Dataset: CD4 T cells'] },
      { cell_type: 'code', metadata: {}, execution_count: null, outputs: [], source: ['import scanpy as sc\n', 'print("ok")'] },
    ],
    metadata: {},
    nbformat: 4,
    nbformat_minor: 4,
  });

  it('returns the cells in order with type and joined source', () => {
    const cells = parseNotebook(nb);
    expect(cells).toHaveLength(2);
    expect(cells[0].type).toBe('markdown');
    expect(cells[0].source).toBe('# Redline corrected analysis\n\nDataset: CD4 T cells');
    expect(cells[1].type).toBe('code');
    expect(cells[1].source).toBe('import scanpy as sc\nprint("ok")');
  });

  it('accepts a source given as a single string', () => {
    const one = JSON.stringify({ cells: [{ cell_type: 'code', source: 'x = 1' }] });
    expect(parseNotebook(one)[0].source).toBe('x = 1');
  });

  it('fails soft to an empty list on invalid JSON', () => {
    expect(parseNotebook('not json{')).toEqual([]);
  });

  it('fails soft when there is no cells array', () => {
    expect(parseNotebook(JSON.stringify({ metadata: {} }))).toEqual([]);
  });

  it('skips cells with an unknown type', () => {
    const mixed = JSON.stringify({ cells: [{ cell_type: 'raw', source: 'x' }, { cell_type: 'code', source: 'y' }] });
    const cells = parseNotebook(mixed);
    expect(cells).toHaveLength(1);
    expect(cells[0].source).toBe('y');
  });
});

describe('renderMarkdownLite', () => {
  it('reads heading level from the leading hashes', () => {
    expect(renderMarkdownLite('# Title')).toEqual([{ kind: 'heading', level: 1, text: 'Title' }]);
    expect(renderMarkdownLite('## Check 2: Double dipping')).toEqual([
      { kind: 'heading', level: 2, text: 'Check 2: Double dipping' },
    ]);
  });

  it('joins consecutive non-blank lines into one paragraph', () => {
    expect(renderMarkdownLite('This design cannot be rescued\nso there is no fix.')).toEqual([
      { kind: 'para', text: 'This design cannot be rescued so there is no fix.' },
    ]);
  });

  it('separates blocks on a blank line', () => {
    const blocks = renderMarkdownLite('# Redline corrected analysis\n\nDataset: CD4 T cells\n\nverdict text');
    expect(blocks).toEqual([
      { kind: 'heading', level: 1, text: 'Redline corrected analysis' },
      { kind: 'para', text: 'Dataset: CD4 T cells' },
      { kind: 'para', text: 'verdict text' },
    ]);
  });

  it('groups consecutive bullet lines into one list', () => {
    expect(renderMarkdownLite('- one\n- two\n- three')).toEqual([
      { kind: 'bullet', items: ['one', 'two', 'three'] },
    ]);
  });

  it('returns nothing for empty or whitespace-only input', () => {
    expect(renderMarkdownLite('')).toEqual([]);
    expect(renderMarkdownLite('   \n  \n')).toEqual([]);
  });
});
