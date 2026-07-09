/**
 * The engine's per-marker survival threshold (`_SURVIVE_AUC` in
 * `redline/pillars/double_dipping.py`). A marker survives when it still
 * separates the group on cells it never saw.
 *
 * `GroupsChart` used to key its red strike-through off `chart.verified`, which
 * only says the held-out test RAN. Every marker went red whenever the test ran,
 * so a surviving marker was struck through, and a finding the critic overturned
 * rendered as a red figure beside a green verdict.
 */
export const MARKER_SURVIVES_AUC = 0.6;

export function markerSurvives(m: { hold: number }): boolean {
  return m.hold >= MARKER_SURVIVES_AUC;
}
