import { describe, expect, it } from 'vitest';
import { notebookToText, readAnalysisText } from './read-analysis-file';

describe('notebookToText', () => {
  it('flattens code and markdown cell sources, dropping the plumbing', () => {
    const nb = JSON.stringify({
      cells: [
        { cell_type: 'markdown', source: ['# Title\n', 'intro'] },
        { cell_type: 'code', source: ['import scanpy as sc\n', 'sc.read()'] },
        { cell_type: 'code', source: [] },
      ],
    });
    const out = notebookToText(nb);
    expect(out).toContain('# Title');
    expect(out).toContain('import scanpy as sc');
    expect(out).not.toContain('cell_type');
  });

  it('handles a string source (not an array)', () => {
    const nb = JSON.stringify({ cells: [{ cell_type: 'code', source: 'x = 1' }] });
    expect(notebookToText(nb)).toBe('x = 1');
  });

  it('falls back to raw text on invalid JSON', () => {
    expect(notebookToText('not json {')).toBe('not json {');
  });

  it('falls back when there are no cells', () => {
    expect(notebookToText('{"nbformat":4}')).toBe('{"nbformat":4}');
  });
});

describe('readAnalysisText', () => {
  const fakeFile = (name: string, text: string) => ({ name, text: async () => text }) as unknown as File;

  it('reads a plain script as-is', async () => {
    expect(await readAnalysisText(fakeFile('a.py', 'print(1)'), 1000)).toBe('print(1)');
  });

  it('parses an .ipynb into cell sources', async () => {
    const nb = JSON.stringify({ cells: [{ cell_type: 'code', source: ['print(1)'] }] });
    expect(await readAnalysisText(fakeFile('a.ipynb', nb), 1000)).toBe('print(1)');
  });

  it('clamps to maxChars so the request never trips the route size guard', async () => {
    expect(await readAnalysisText(fakeFile('a.py', 'x'.repeat(50)), 10)).toHaveLength(10);
  });
});
