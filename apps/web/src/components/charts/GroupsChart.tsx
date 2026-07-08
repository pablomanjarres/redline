import type { ReactElement } from 'react';
import type * as RC from '@redline/contracts';
import { C } from '@redline/ui';
import { Svg, txt, keyer, fSans, fMono } from './svg';

/**
 * Check 2 (double dipping), as a clean dumbbell. One row per claimed marker: a
 * dot for how well it separates the group on the discovery cells (where it was
 * chosen) and a dot for the held-out cells it never saw, joined by a track. When
 * the held-out dots collapse toward the chance line, the group is an artifact of
 * choosing the markers and the cluster on the same data.
 */
export function GroupsChart({ chart }: { chart: RC.GroupsChart }): ReactElement {
  const { add, els } = keyer();
  const markers = chart.markers;
  const verified = chart.verified;

  const x0 = 150; // AUC = 0.5 (chance)
  const x1 = 566; // AUC = 1.0
  const X = (a: number): number => x0 + ((a - 0.5) / 0.5) * (x1 - x0);
  const rowY = (i: number): number => 92 + i * 46;
  const axisY = rowY(markers.length - 1) + 26;

  // header + legend
  add(txt(28, 34, 'Marker separation (AUC)', { fill: C.ink3, style: { font: fSans(600, 11) } }));
  add(<circle cx={356} cy={30} r={5} fill={C.ink} />);
  add(txt(366, 34, 'discovery', { fill: C.ink3, style: { font: fSans(500, 10.5) } }));
  add(<circle cx={452} cy={30} r={5} fill="#fff" stroke={verified ? C.red : C.ink4} strokeWidth={2.5} />);
  add(txt(462, 34, 'held-out', { fill: C.ink3, style: { font: fSans(500, 10.5) } }));

  // gridlines + x ticks
  [0.5, 0.75, 1.0].forEach((t) => {
    add(<line x1={X(t)} y1={54} x2={X(t)} y2={axisY} stroke={C.grid} strokeWidth={1} />);
    add(txt(X(t), axisY + 16, t.toFixed(2), { textAnchor: 'middle', fill: C.ink4, style: { font: fMono(400, 9) } }));
  });
  // chance reference at 0.5
  add(<line x1={X(0.5)} y1={54} x2={X(0.5)} y2={axisY} stroke={C.line2} strokeWidth={1} strokeDasharray="4 4" />);
  add(txt(X(0.5), 48, 'chance', { textAnchor: 'middle', fill: C.ink4, style: { font: fSans(400, 9) } }));

  markers.forEach((m, i) => {
    const y = rowY(i);
    const xd = X(m.disc);
    const xh = X(verified ? m.hold : m.disc);
    add(
      txt(x0 - 16, y + 4, m.gene, {
        textAnchor: 'end',
        fill: verified ? C.redDeep : C.ink,
        style: { font: fMono(500, 12), textDecoration: verified ? 'line-through' : 'none' },
      }),
    );
    if (verified) add(<line x1={xh} y1={y} x2={xd} y2={y} stroke={C.line2} strokeWidth={2} strokeLinecap="round" />);
    add(<circle cx={xd} cy={y} r={6} fill={C.ink} />);
    if (verified) {
      add(<circle cx={xh} cy={y} r={6} fill="#fff" stroke={C.red} strokeWidth={2.5} />);
      add(txt(xh - 12, y + 4, m.hold.toFixed(2), { textAnchor: 'end', fill: C.redDeep, style: { font: fMono(500, 10) } }));
    } else {
      add(txt(xd + 14, y + 4, '?', { fill: C.amber, style: { font: fMono(600, 12) } }));
    }
  });

  if (!verified) {
    add(txt(x0 - 16, axisY + 16, 'held-out set too small to test', { fill: C.amber, style: { font: fSans(500, 10.5) } }));
  }

  return (
    <Svg vb={`0 0 620 ${axisY + 28}`} label="Marker separation on discovery versus held-out cells">
      {els}
    </Svg>
  );
}
