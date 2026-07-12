import { describe, expect, it } from 'vitest';
import { correctionTerminal } from './correction-terminal';

/**
 * The terminal reveal replays the corrected method's output from the result the
 * ComputeTarget already produced. It must read the real stats (never invent a
 * number), color them by the same bad/good flags the stat strip uses, carry the
 * honest compute target for the label, and refuse a corrected number on an
 * unsalvageable finding.
 */
describe('correctionTerminal', () => {
  const doubleDipping = {
    headline: 'The state does not survive out of sample.',
    stats: [
      { label: 'Discovery AUC', value: '0.90', bad: true },
      { label: 'Held-out AUC', value: '0.57', bad: true },
      { label: 'Markers holding', value: '0 / 4', bad: true },
    ],
    correctedCode: { entrypoint: 'python 02_double_dipping.py --h5ad data.h5ad' },
    preview: { unsalvageable: false, after: { kind: 'groups' } },
    provenance: { target: 'fixture' },
  };

  it('carries the run command from the corrected code entrypoint', () => {
    expect(correctionTerminal(doubleDipping).command).toBe(
      'python 02_double_dipping.py --h5ad data.h5ad',
    );
  });

  it('emits one line per stat, in order, with the stat value verbatim', () => {
    const t = correctionTerminal(doubleDipping);
    expect(t.lines.map((l) => [l.label, l.value])).toEqual([
      ['Discovery AUC', '0.90'],
      ['Held-out AUC', '0.57'],
      ['Markers holding', '0 / 4'],
    ]);
  });

  it('tones each line by the bad/good flag the stat carries', () => {
    const t = correctionTerminal({
      ...doubleDipping,
      stats: [
        { label: 'Naive p', value: '6.2e-11', bad: true },
        { label: 'Honest p (donor-level)', value: '0.21', good: true },
        { label: 'Donors', value: '4' },
      ],
    });
    expect(t.lines.map((l) => l.tone)).toEqual(['bad', 'good', 'plain']);
  });

  it('closes with the headline as the verdict line', () => {
    expect(correctionTerminal(doubleDipping).verdict).toBe(
      'The state does not survive out of sample.',
    );
  });

  it('reports the honest compute target for the label', () => {
    expect(correctionTerminal(doubleDipping).target).toBe('fixture');
    expect(correctionTerminal({ ...doubleDipping, provenance: { target: 'cloudrun' } }).target).toBe(
      'cloudrun',
    );
    expect(correctionTerminal({ ...doubleDipping, provenance: undefined }).target).toBeNull();
  });

  it('marks an unsalvageable finding so no corrected number is shown', () => {
    const confound = {
      headline: 'Condition and lane are perfectly confounded.',
      stats: [{ label: "Cramer's V", value: '1.00', bad: true }],
      correctedCode: undefined,
      preview: { unsalvageable: true, after: null },
      provenance: { target: 'fixture' },
    };
    const t = correctionTerminal(confound);
    expect(t.unsalvageable).toBe(true);
    expect(t.command).toBe('');
  });

  it('treats a null after as unsalvageable even if the flag is missing', () => {
    const t = correctionTerminal({
      ...doubleDipping,
      preview: { after: null },
    });
    expect(t.unsalvageable).toBe(true);
  });

  it('is salvageable when there is a real after artifact', () => {
    expect(correctionTerminal(doubleDipping).unsalvageable).toBe(false);
  });
});
