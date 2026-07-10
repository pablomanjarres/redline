import { describe, expect, it } from 'vitest';
import { cellsToIpynb, cellsToText, parseNotebook, readNotebookFile, scriptToCells } from './notebook';

describe('parseNotebook', () => {
  it('parses code and markdown cells, joining array sources', () => {
    const raw = JSON.stringify({
      cells: [
        { cell_type: 'markdown', source: ['# Title\n', 'intro'] },
        { cell_type: 'code', source: ['import scanpy as sc\n', 'sc.read()'] },
      ],
    });
    const cells = parseNotebook(raw)!;
    expect(cells).toEqual([
      { type: 'markdown', source: '# Title\nintro' },
      { type: 'code', source: 'import scanpy as sc\nsc.read()' },
    ]);
  });

  it('extracts plain-text stream and result outputs, ignoring images', () => {
    const raw = JSON.stringify({
      cells: [
        {
          cell_type: 'code',
          source: 'print(1)',
          outputs: [
            { output_type: 'stream', text: ['hello\n'] },
            { output_type: 'execute_result', data: { 'text/plain': ['42'] } },
            { output_type: 'display_data', data: { 'image/png': 'base64...' } },
          ],
        },
      ],
    });
    expect(parseNotebook(raw)![0].outputs).toEqual(['hello', '42']);
  });

  it('skips empty and raw/unknown cells', () => {
    const raw = JSON.stringify({
      cells: [
        { cell_type: 'code', source: '   ' },
        { cell_type: 'raw', source: 'x' },
        { cell_type: 'code', source: 'ok' },
      ],
    });
    expect(parseNotebook(raw)).toEqual([{ type: 'code', source: 'ok' }]);
  });

  it('returns null for invalid JSON, non-notebooks, and empty notebooks', () => {
    expect(parseNotebook('not json {')).toBeNull();
    expect(parseNotebook('{"foo":1}')).toBeNull();
    expect(parseNotebook('{"cells":[]}')).toBeNull();
  });
});

describe('cellsToText / scriptToCells', () => {
  it('flattens cell sources with blank-line separators', () => {
    expect(cellsToText([{ type: 'markdown', source: '# A' }, { type: 'code', source: 'x = 1' }])).toBe('# A\n\nx = 1');
  });

  it('wraps a script as one code cell', () => {
    expect(scriptToCells('print(1)')).toEqual([{ type: 'code', source: 'print(1)' }]);
  });
});

describe('cellsToIpynb', () => {
  it('produces a notebook that parses back to the same sources', () => {
    const cells = [
      { type: 'markdown' as const, source: '# T' },
      { type: 'code' as const, source: 'a\nb' },
    ];
    const round = parseNotebook(cellsToIpynb(cells))!;
    expect(round.map((c) => ({ type: c.type, source: c.source }))).toEqual(cells);
  });
});

describe('readNotebookFile', () => {
  const fake = (name: string, text: string) => ({ name, text: async () => text }) as unknown as File;

  it('reads a .ipynb into cells + flattened text + name', async () => {
    const raw = JSON.stringify({ cells: [{ cell_type: 'code', source: 'print(1)' }] });
    const nb = await readNotebookFile(fake('a.ipynb', raw), 1000);
    expect(nb.cells).toEqual([{ type: 'code', source: 'print(1)' }]);
    expect(nb.text).toBe('print(1)');
    expect(nb.name).toBe('a.ipynb');
  });

  it('wraps a plain script as one code cell', async () => {
    expect((await readNotebookFile(fake('a.py', 'x = 1'), 1000)).cells).toEqual([{ type: 'code', source: 'x = 1' }]);
  });

  it('falls back to one code cell when a .ipynb is not really a notebook', async () => {
    expect((await readNotebookFile(fake('a.ipynb', 'not json'), 1000)).cells).toEqual([{ type: 'code', source: 'not json' }]);
  });

  it('clamps the flattened text to maxChars so the request never 413s', async () => {
    expect((await readNotebookFile(fake('a.py', 'x'.repeat(50)), 10)).text).toHaveLength(10);
  });
});
