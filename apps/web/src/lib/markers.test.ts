import { describe, expect, it } from 'vitest';
import { markerSurvives, MARKER_SURVIVES_AUC } from './markers';

/**
 * The chart used to key its red strike-through off `chart.verified`, which only
 * says the held-out test RAN. Every marker went red whenever the test ran, so a
 * finding the critic overturned rendered as a red figure beside a green verdict,
 * and a genuinely surviving marker was struck through.
 *
 * The predicate is per marker, and it mirrors `_SURVIVE_AUC` in
 * `redline/pillars/double_dipping.py`.
 */
describe('markerSurvives', () => {
  it('mirrors the engine threshold', () => {
    expect(MARKER_SURVIVES_AUC).toBe(0.6);
  });

  it('a marker that holds out of sample is not struck through', () => {
    expect(markerSurvives({ hold: 1.0 })).toBe(true);
    expect(markerSurvives({ hold: 0.62 })).toBe(true);
    expect(markerSurvives({ hold: MARKER_SURVIVES_AUC })).toBe(true);
  });

  it('a marker that collapses toward chance is struck through', () => {
    expect(markerSurvives({ hold: 0.51 })).toBe(false);
    expect(markerSurvives({ hold: 0.59 })).toBe(false);
  });

  it('the clean case the critic vetoes renders no collapsed markers', () => {
    // Case C: all four claimed markers hold at AUC 1.0.
    const markers = [{ hold: 1.0 }, { hold: 1.0 }, { hold: 1.0 }, { hold: 1.0 }];
    expect(markers.some((m) => !markerSurvives(m))).toBe(false);
  });

  it('the genuine double-dipping case renders every marker collapsed', () => {
    // Case A: zero of four markers survive the held-out split.
    const markers = [{ hold: 0.55 }, { hold: 0.51 }, { hold: 0.58 }, { hold: 0.49 }];
    expect(markers.every((m) => !markerSurvives(m))).toBe(true);
  });
});
