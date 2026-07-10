import { describe, expect, it } from 'vitest';
import { EXAMPLE_FILENAME, EXAMPLE_NOTEBOOK, EXAMPLE_PROSE } from './example-analysis';

// The contract caps (packages/contracts/src/claims.ts): notebook 200k, prose 100k.
const MAX_NOTEBOOK = 200_000;
const MAX_PROSE = 100_000;

describe('example analysis', () => {
  it('stays within the contract caps so it always posts', () => {
    expect(EXAMPLE_NOTEBOOK.length).toBeLessThanOrEqual(MAX_NOTEBOOK);
    expect(EXAMPLE_PROSE.length).toBeLessThanOrEqual(MAX_PROSE);
  });

  it('carries the four load-bearing claims, so it reads coherently against the curated marson list', () => {
    expect(EXAMPLE_NOTEBOOK).toMatch(/FOXP3/);
    expect(EXAMPLE_PROSE).toMatch(/IL2RA knockdown significantly upregulates FOXP3/);
    expect(EXAMPLE_PROSE).toMatch(/Treg-like/);
    expect(EXAMPLE_PROSE).toMatch(/distinct knockdown-responsive/);
    expect(EXAMPLE_PROSE).toMatch(/Differential expression/);
  });

  it('names a .py sample and holds the repo voice rule (no em dash)', () => {
    expect(EXAMPLE_FILENAME).toMatch(/\.py$/);
    expect(EXAMPLE_NOTEBOOK.includes('—')).toBe(false);
    expect(EXAMPLE_PROSE.includes('—')).toBe(false);
  });
});
