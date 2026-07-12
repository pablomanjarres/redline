import { describe, expect, it } from 'vitest';
import { EXAMPLE_CELLS, EXAMPLE_FILENAME, EXAMPLE_NOTEBOOK, EXAMPLE_PROSE } from './example-analysis';
import { cellsToIpynb, parseNotebook } from './notebook';

// The contract caps (packages/contracts/src/claims.ts): notebook 200k, prose 100k.
const MAX_NOTEBOOK = 200_000;
const MAX_PROSE = 100_000;

describe('example analysis', () => {
  it('is a notebook with both markdown and code cells', () => {
    expect(EXAMPLE_CELLS.some((c) => c.type === 'markdown')).toBe(true);
    expect(EXAMPLE_CELLS.some((c) => c.type === 'code')).toBe(true);
  });

  it('downloads as a .ipynb that parses back to the same cells', () => {
    const round = parseNotebook(cellsToIpynb(EXAMPLE_CELLS));
    expect(round).not.toBeNull();
    expect(round!.map((c) => c.source)).toEqual(EXAMPLE_CELLS.map((c) => c.source));
    expect(EXAMPLE_FILENAME).toMatch(/\.ipynb$/);
  });

  it('stays within the contract caps so it always posts', () => {
    expect(EXAMPLE_NOTEBOOK.length).toBeLessThanOrEqual(MAX_NOTEBOOK);
    expect(EXAMPLE_PROSE.length).toBeLessThanOrEqual(MAX_PROSE);
  });

  it('carries the four load-bearing claims, so it reads coherently against the curated marson list', () => {
    expect(EXAMPLE_NOTEBOOK).toMatch(/FOXP3/);
    expect(EXAMPLE_NOTEBOOK).toMatch(/IL2RA knockdown significantly upregulates FOXP3/);
    expect(EXAMPLE_PROSE).toMatch(/Treg-like/);
    expect(EXAMPLE_PROSE).toMatch(/distinct knockdown-responsive/);
    expect(EXAMPLE_PROSE).toMatch(/Differential expression/);
  });

  it('holds the repo voice rule (no em dash)', () => {
    expect(EXAMPLE_NOTEBOOK.includes('—')).toBe(false);
    expect(EXAMPLE_PROSE.includes('—')).toBe(false);
  });
});
