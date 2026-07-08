import type { ReactElement } from 'react';
import type * as RC from '@redline/contracts';
import { C } from '@redline/ui';
import { Svg, txt, keyer, fSans, fMono } from './svg';

/**
 * Check 2 (double dipping). Ported from `Redline.dc.html` `chartGroups`: a
 * discovery split where the state is defined, an optional held-out split the
 * markers never saw, and a dumbbell row per marker showing its separation (AUC)
 * sliding from the discovery value back toward chance on held-out data. When the
 * held-out test has run (`verified`), the gene labels strike through and the
 * held-out endpoints land near 0.5.
 */
export function GroupsChart({ chart }: { chart: RC.GroupsChart }): ReactElement {
  const c = chart;
  const { add, els } = keyer();

  // left: discovery cloud (always) and held-out cloud (once verified)
  add(txt(70, 40, 'Discovery split', { textAnchor: 'middle', fill: C.ink2, style: { font: fSans(500, 11) } }));
  add(txt(70, 58, 'defined here', { textAnchor: 'middle', fill: C.ink3, style: { font: fSans(400, 10) } }));
  add(<ellipse cx={48} cy={110} rx={26} ry={20} fill="#EDEAE2" stroke={C.ink4} strokeWidth={1} />);
  add(<ellipse cx={96} cy={96} rx={24} ry={18} fill={C.ink} opacity={0.12} stroke={C.ink} strokeWidth={1} />);
  for (let i = 0; i < 16; i++) {
    add(<circle cx={48 + Math.sin(i) * 17} cy={110 + Math.cos(i * 1.7) * 13} r={2.2} fill={C.ink3} />);
  }
  for (let i = 0; i < 16; i++) {
    add(<circle cx={96 + Math.sin(i * 1.3) * 15} cy={96 + Math.cos(i) * 12} r={2.2} fill={C.ink} />);
  }
  if (c.verified) {
    add(txt(210, 40, 'Held-out split', { textAnchor: 'middle', fill: C.ink2, style: { font: fSans(500, 11) } }));
    add(txt(210, 58, 'markers never saw', { textAnchor: 'middle', fill: C.ink3, style: { font: fSans(400, 10) } }));
    add(<ellipse cx={210} cy={103} rx={34} ry={24} fill="none" stroke={C.red} strokeWidth={1.5} strokeDasharray="5 4" />);
    for (let i = 0; i < 32; i++) {
      add(<circle cx={210 + Math.sin(i * 2.1) * 26} cy={103 + Math.cos(i * 1.3) * 17} r={2.2} fill={i % 2 ? C.ink3 : C.ink} />);
    }
    add(txt(210, 150, 'no separation', { textAnchor: 'middle', fill: C.redDeep, style: { font: fSans(600, 10.5) } }));
  }
  add(<line x1={300} y1={36} x2={300} y2={150} stroke={C.line} strokeWidth={1} />);

  // right: marker separation (AUC) dumbbells
  const ax0 = 360;
  const ax1 = 596;
  const aucX = (a: number): number => ax0 + ((a - 0.5) / 0.5) * (ax1 - ax0);
  add(txt(360, 40, 'Marker separation (AUC)', { fill: C.ink2, style: { font: fSans(500, 11) } }));
  [0.5, 0.8, 1.0].forEach((t) => {
    add(<line x1={aucX(t)} y1={52} x2={aucX(t)} y2={300} stroke="#EDEAE2" strokeWidth={1} />);
    add(txt(aucX(t), 314, t.toFixed(1), { textAnchor: 'middle', fill: C.ink4, style: { font: fMono(500, 9) } }));
  });
  add(txt(aucX(0.5), 326, 'chance', { textAnchor: 'middle', fill: C.ink4, style: { font: fSans(400, 8.5) } }));
  c.markers.forEach((m, mi) => {
    const y = 78 + mi * 52;
    const xd = aucX(m.disc);
    const xh = aucX(c.verified ? m.hold : m.disc);
    add(
      txt(346, y + 4, m.gene, {
        textAnchor: 'end',
        fill: c.verified ? C.redDeep : C.ink,
        style: { font: fMono(500, 12), textDecoration: c.verified ? 'line-through' : 'none' },
      }),
    );
    add(<line x1={xh} y1={y} x2={xd} y2={y} stroke={C.line2} strokeWidth={2} />);
    add(<circle cx={xd} cy={y} r={5.5} fill={C.ink} />);
    if (c.verified) {
      add(<circle cx={xh} cy={y} r={5.5} fill="#fff" stroke={C.red} strokeWidth={2.2} />);
      add(txt(xh - 10, y + 4, m.hold.toFixed(2), { textAnchor: 'end', fill: C.redDeep, style: { font: fMono(500, 10) } }));
    } else {
      add(txt(xd + 12, y + 4, '?', { fill: C.amber, style: { font: fMono(600, 12) } }));
    }
  });

  return <Svg label="Marker separation on the discovery split collapses toward chance on a held-out split">{els}</Svg>;
}
