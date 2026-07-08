import type { ReactElement } from 'react';
import type * as RC from '@redline/contracts';
import { C } from '@redline/ui';
import { Svg, txt, keyer, fSans, fMono } from './svg';

/**
 * Check 4 (confounding), as clean data-viz. A contingency heatmap of grouping
 * levels (rows) against a technical variable (columns): filled where cells hold
 * cells, empty on the off-diagonal. When every sample sits on the diagonal the
 * two variables are the same split, so once verified the occupied cells take a
 * red ring and the summary reports Cramér's V. On the right, the two grouping
 * levels' expression densities overlap completely, so the effect is not separable.
 */
export function ConfoundChart({ chart }: { chart: RC.ConfoundChart }): ReactElement {
  const c = chart;
  const g = c.grid;
  const { add, els } = keyer();

  const ox = 130;
  const oy = 92;
  const cw = 104;
  const chh = 72;
  const gap = 8;

  add(txt(ox + cw, 62, 'technical variable', { textAnchor: 'middle', fill: C.ink3, style: { font: fSans(600, 11) } }));
  g.cols.forEach((cl, ci) => {
    add(txt(ox + ci * cw + cw / 2, 84, cl, { textAnchor: 'middle', fill: C.ink4, style: { font: fMono(500, 10) } }));
  });
  add(
    txt(ox - 18, oy + chh, 'grouping', {
      textAnchor: 'middle',
      fill: C.ink3,
      style: { font: fSans(600, 11), transform: 'rotate(-90deg)', transformOrigin: `${ox - 18}px ${oy + chh}px` },
    }),
  );
  g.rows.forEach((rw, ri) => {
    add(txt(ox - 10, oy + ri * chh + chh / 2 + 4, rw, { textAnchor: 'end', fill: C.ink4, style: { font: fMono(500, 10) } }));
    g.cols.forEach((_cl, ci) => {
      const x = ox + ci * cw;
      const y = oy + ri * chh;
      const cell = g.cells[ri]?.[ci] ?? 0;
      const filled = cell > 0;
      add(<rect x={x} y={y} width={cw - gap} height={chh - gap} rx={7} fill={filled ? C.ink : C.panel2} stroke={filled ? 'none' : C.line2} strokeWidth={1} />);
      if (c.verified && filled) {
        add(<rect x={x - 2.5} y={y - 2.5} width={cw - gap + 5} height={chh - gap + 5} rx={9} fill="none" stroke={C.red} strokeWidth={2} />);
      }
      add(txt(x + (cw - gap) / 2, y + (chh - gap) / 2 + 5, filled ? cell.toLocaleString() : '0', { textAnchor: 'middle', fill: filled ? '#fff' : C.ink4, style: { font: fMono(600, 13) } }));
    });
  });

  if (c.verified) {
    const vLabel = c.cramersV != null ? c.cramersV.toFixed(2) : 'n/a';
    add(txt(ox + cw, oy + 2 * chh + 26, `Cramér's V = ${vLabel} · not separable`, { textAnchor: 'middle', fill: C.redDeep, style: { font: fSans(600, 12.5) } }));
  }

  // right: overlapping expression densities for the two grouping levels
  const dx0 = 392;
  const dx1 = 592;
  const dyb = 244;
  const dpath = (shift: number): string => {
    let d = `M${dx0} ${dyb}`;
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      const x = dx0 + t * (dx1 - dx0);
      const yv = dyb - 92 * Math.exp(-Math.pow((t - (0.5 + shift)) / 0.2, 2) / 2);
      d += ` L ${x.toFixed(1)} ${yv.toFixed(1)}`;
    }
    d += ` L ${dx1} ${dyb} Z`;
    return d;
  };
  add(txt(dx0, 122, 'Expression by group', { fill: C.ink3, style: { font: fSans(600, 11) } }));
  add(<path d={dpath(0.02)} fill={C.accent} fillOpacity={0.1} stroke={C.accent} strokeWidth={1.5} strokeLinejoin="round" />);
  add(<path d={dpath(0)} fill={C.ink} fillOpacity={0.1} stroke={C.ink} strokeWidth={1.5} strokeLinejoin="round" />);
  add(<circle cx={dx0 + 6} cy={140} r={4} fill={C.ink} />);
  add(txt(dx0 + 14, 144, g.rows[0] ?? '', { fill: C.ink3, style: { font: fSans(500, 10) } }));
  add(<circle cx={dx0 + 6} cy={158} r={4} fill={C.accent} />);
  add(txt(dx0 + 14, 162, g.rows[1] ?? '', { fill: C.ink3, style: { font: fSans(500, 10) } }));
  if (c.verified) {
    add(txt((dx0 + dx1) / 2, dyb + 22, 'fully overlapping', { textAnchor: 'middle', fill: C.redDeep, style: { font: fSans(600, 11) } }));
  }

  return <Svg vb="0 0 620 300" label="Grouping is fully confounded with a technical variable">{els}</Svg>;
}
