import type { ReactElement } from 'react';
import type * as RC from '@redline/contracts';
import { C } from '@redline/ui';
import { Svg, txt, keyer, fSans, fMono, RL_ANIM } from './svg';

/**
 * Check 4 (confounding). Ported from `Redline.dc.html` `chartConfound`: an
 * occupancy grid of grouping levels (rows) against a technical variable
 * (columns), plus overlapping expression densities on the right. When the check
 * has run (`verified`), a red lasso traces the filled diagonal and the summary
 * reports Cramér's V. The variable names are not carried by the chart contract,
 * so the axis titles stay generic while the level labels and counts come from
 * the grid; the density labels reuse the grouping levels (`grid.rows`).
 */
export function ConfoundChart({ chart }: { chart: RC.ConfoundChart }): ReactElement {
  const c = chart;
  const g = c.grid;
  const { add, els } = keyer();

  const ox = 120;
  const oy = 90;
  const cw = 120;
  const ch = 74;

  add(txt(ox + cw, 60, 'technical variable', { textAnchor: 'middle', fill: C.ink2, style: { font: fSans(500, 11) } }));
  g.cols.forEach((cl, ci) => {
    add(txt(ox + ci * cw + cw / 2, 84, cl, { textAnchor: 'middle', fill: C.ink3, style: { font: fMono(500, 10) } }));
  });
  add(
    txt(ox - 14, oy + ch, 'condition', {
      textAnchor: 'middle',
      fill: C.ink2,
      style: { font: fSans(500, 11), transform: 'rotate(-90deg)', transformOrigin: `${ox - 14}px ${oy + ch}px` },
    }),
  );
  g.rows.forEach((rw, ri) => {
    add(txt(ox - 8, oy + ri * ch + ch / 2 + 4, rw, { textAnchor: 'end', fill: C.ink3, style: { font: fMono(500, 10) } }));
    g.cols.forEach((_cl, ci) => {
      const x = ox + ci * cw;
      const y = oy + ri * ch;
      const cell = g.cells[ri]?.[ci] ?? 0;
      const filled = cell > 0;
      add(
        <rect
          x={x}
          y={y}
          width={cw - 8}
          height={ch - 8}
          rx={6}
          fill={filled ? C.ink : C.panel2}
          stroke={filled ? 'none' : '#DDD8CC'}
          strokeWidth={1}
          strokeDasharray={filled ? '0' : '4 4'}
        />,
      );
      if (filled) {
        add(
          txt(x + (cw - 8) / 2, y + (ch - 8) / 2 + 5, cell.toLocaleString(), {
            textAnchor: 'middle',
            fill: '#fff',
            style: { font: fMono(600, 13) },
          }),
        );
      } else {
        add(
          txt(x + (cw - 8) / 2, y + (ch - 8) / 2 + 5, '0', {
            textAnchor: 'middle',
            fill: '#C8C3B6',
            style: { font: fMono(500, 13) },
          }),
        );
      }
    });
  });

  if (c.verified) {
    add(
      <path
        d={`M${ox - 6} ${oy - 6} C ${ox + cw} ${oy + 10}, ${ox + cw} ${oy + ch}, ${ox + 2 * cw - 16} ${oy + 2 * ch - 12}`}
        fill="none"
        stroke={C.red}
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeDasharray={400}
        strokeDashoffset={400}
        className={RL_ANIM}
        style={{ animation: 'rl-draw 1s .3s ease forwards' }}
      />,
    );
    const vLabel = c.cramersV != null ? c.cramersV.toFixed(2) : 'n/a';
    add(
      txt(ox + cw, oy + 2 * ch + 30, `condition ≡ technical variable · Cramér’s V = ${vLabel}`, {
        textAnchor: 'middle',
        fill: C.redDeep,
        style: { font: fSans(600, 13) },
      }),
    );
  }

  // right: overlapping expression densities for the two grouping levels
  const dx0 = 380;
  const dx1 = 596;
  const dyb = 250;
  const dpath = (): string => {
    let d = `M${dx0} ${dyb}`;
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      const x = dx0 + t * (dx1 - dx0);
      const yv = dyb - 96 * Math.exp(-Math.pow((t - 0.5) / 0.2, 2) / 2);
      d += ` L ${x.toFixed(1)} ${yv.toFixed(1)}`;
    }
    d += ` L ${dx1} ${dyb} Z`;
    return d;
  };
  add(txt(dx0, 120, 'Expression support', { fill: C.ink2, style: { font: fSans(500, 11) } }));
  add(<path d={dpath()} fill="rgba(27,26,23,.10)" stroke={C.ink} strokeWidth={1.5} />);
  add(<path d={dpath()} fill="none" stroke={C.ink3} strokeWidth={1.5} strokeDasharray="5 4" />);
  add(txt(dx1, 150, g.rows[0] ?? '', { textAnchor: 'end', fill: C.ink, style: { font: fSans(500, 10) } }));
  add(txt(dx1, 166, g.rows[1] ?? '', { textAnchor: 'end', fill: C.ink3, style: { font: fSans(500, 10) } }));
  if (c.verified) {
    add(txt((dx0 + dx1) / 2, dyb + 22, 'fully overlapping · not separable', { textAnchor: 'middle', fill: C.redDeep, style: { font: fSans(600, 11) } }));
  }

  return <Svg label="Grouping is fully confounded with a technical variable">{els}</Svg>;
}
