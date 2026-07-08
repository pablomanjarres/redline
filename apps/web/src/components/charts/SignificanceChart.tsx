import type { ReactElement } from 'react';
import type * as RC from '@redline/contracts';
import { C } from '@redline/ui';
import { Svg, txt, keyer, fSans, fMono, RL_ANIM } from './svg';

/**
 * Check 1 (pseudoreplication). Ported from `Redline.dc.html` `chartSig`, which
 * draws two branches off the chart discriminated union:
 *  - `hardstop`: too few independent units for any valid test (n per group).
 *  - `significance`: the naive cell-level test deflating to an honest per-unit
 *    re-test (the reported ghost bar struck through, the honest bar grown in).
 */

const SUP: Record<string, string> = {
  '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³',
  '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
};
const sup = (s: string): string =>
  s
    .split('')
    .map((ch) => SUP[ch] ?? ch)
    .join('');

/** Print a p-value the way the design does: 0.34 / 0.21 in range, otherwise a
 *  mantissa times ten to a superscript exponent (3.1x10^-9). */
function fmtP(p: number): string {
  if (!Number.isFinite(p) || p <= 0) return String(p);
  if (p >= 0.001) return p.toFixed(p >= 0.1 ? 2 : 3);
  const exp = Math.floor(Math.log10(p));
  const mant = p / Math.pow(10, exp);
  return `${mant.toFixed(1)}×10${sup(String(exp))}`;
}

export function SignificanceChart({
  chart,
}: {
  chart: RC.SignificanceChart | RC.HardStopChart;
}): ReactElement {
  const { add, els } = keyer();

  if (chart.kind === 'hardstop') {
    const groups = [...new Set(chart.profiles.map((p) => p.group))];
    const gx =
      groups.length === 2
        ? [210, 410]
        : groups.map((_, i) => (groups.length > 1 ? 160 + (i * 300) / (groups.length - 1) : 310));
    add(
      txt(310, 40, 'Independent units available', {
        textAnchor: 'middle',
        fill: C.ink3,
        style: { font: fSans(500, 12) },
      }),
    );
    groups.forEach((g, gi) => {
      add(txt(gx[gi], 300, g, { textAnchor: 'middle', fill: C.ink2, style: { font: fSans(500, 12) } }));
      add(<circle cx={gx[gi]} cy={180} r={20} fill="#fff" stroke={C.stop} strokeWidth={2} />);
      add(
        txt(gx[gi], 186, String(chart.perGroup), {
          textAnchor: 'middle',
          fill: C.stop,
          style: { font: fMono(600, 18) },
        }),
      );
    });
    add(<line x1={310} y1={120} x2={310} y2={250} stroke={C.line2} strokeWidth={1} strokeDasharray="4 4" />);
    add(
      <path
        d="M150 96 C 300 78, 360 78, 470 92"
        fill="none"
        stroke={C.red}
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeDasharray={400}
        strokeDashoffset={400}
        className={RL_ANIM}
        style={{ animation: 'rl-draw .8s .2s ease forwards' }}
      />,
    );
    add(
      txt(310, 80, `n = ${chart.perGroup} per group · no replication`, {
        textAnchor: 'middle',
        fill: C.redDeep,
        style: { font: fSans(600, 13) },
      }),
    );
    return <Svg label="Too few independent units for a valid test">{els}</Svg>;
  }

  const c = chart;
  const units = c.units;
  const maxV = Math.max(9.2, c.naive.log10p * 1.08);
  const baseY = 286;
  const topY = 54;
  const Y = (v: number): number => baseY - (v / maxV) * (baseY - topY);
  const aY = Y(-Math.log10(c.alpha));
  const bx1 = 372;
  const bx2 = 486;
  const bw = 62;
  const repTop = Y(c.naive.log10p);
  const honTop = Y(c.honest.log10p);
  const cols =
    units.length === 6
      ? [40, 80, 120, 180, 220, 260]
      : units.map((_, i) => (units.length > 1 ? 40 + (i * 220) / (units.length - 1) : 150));
  const groupOrder = [...new Set(units.map((u) => u.group))];
  const groupColor = (g: string): string => {
    const i = groupOrder.indexOf(g);
    return i === 0 ? C.ink2 : i === 1 ? C.ink : C.ink3;
  };
  const alphaLabel = String(c.alpha).replace(/^0\./, '.');
  const naiveN = c.naive.n.toLocaleString();

  // left: aggregation of cells down to independent units
  add(txt(40, 46, `${naiveN} cells`, { fill: C.ink3, style: { font: fMono(500, 11) } }));
  add(txt(40, 300, `collapse to ${units.length} units`, { fill: C.ink2, style: { font: fMono(500, 11) } }));
  units.forEach((m, mi) => {
    const x = cols[mi];
    for (let j = 0; j < 14; j++) {
      add(<circle cx={x + Math.sin(mi * 9 + j * 2.3) * 9} cy={96 + j * 7.2} r={2} fill={C.line2} />);
    }
    add(<circle cx={x} cy={250} r={6.5} fill={groupColor(m.group)} />);
    add(txt(x, 272, m.id, { textAnchor: 'middle', fill: C.ink3, style: { font: fMono(500, 9) } }));
  });
  add(
    <path
      d="M28 240 q 130 26 250 0 q 8 20 -6 30 q -120 22 -238 0 q -14 -12 -6 -30 Z"
      fill="none"
      stroke={C.red}
      strokeWidth={2}
      strokeDasharray={620}
      strokeDashoffset={620}
      className={RL_ANIM}
      style={{ animation: 'rl-draw 1s .3s ease forwards' }}
    />,
  );
  add(
    txt(150, 320, `n = ${units.length}, not ${naiveN}`, {
      textAnchor: 'middle',
      fill: C.redDeep,
      style: { font: fSans(600, 12) },
    }),
  );
  add(<line x1={312} y1={44} x2={312} y2={300} stroke={C.line} strokeWidth={1} />);

  // right: significance bars
  add(<line x1={344} y1={baseY} x2={604} y2={baseY} stroke={C.line2} strokeWidth={1} />);
  add(<line x1={344} y1={aY} x2={604} y2={aY} stroke={C.ink3} strokeWidth={1} strokeDasharray="4 4" />);
  add(
    txt(600, aY - 6, `α = ${alphaLabel} threshold`, {
      textAnchor: 'end',
      fill: C.ink3,
      style: { font: fMono(500, 10) },
    }),
  );
  add(txt(356, 52, '−log₁₀ p', { fill: C.ink3, style: { font: fMono(500, 10) } }));

  // reported (ghost) bar
  add(<rect x={bx1} y={repTop} width={bw} height={baseY - repTop} rx={3} fill="#ECE9E0" stroke={C.line2} strokeWidth={1} />);
  add(
    <line
      x1={bx1 - 9}
      y1={repTop + 20}
      x2={bx1 + bw + 9}
      y2={repTop + 1}
      stroke={C.red}
      strokeWidth={2.6}
      strokeLinecap="round"
      strokeDasharray={110}
      strokeDashoffset={110}
      className={RL_ANIM}
      style={{ animation: 'rl-draw .6s .5s ease forwards' }}
    />,
  );
  add(txt(bx1 + bw / 2, repTop - 24, 'reported', { textAnchor: 'middle', fill: C.ink3, style: { font: fSans(500, 10) } }));
  add(
    txt(bx1 + bw / 2, repTop - 10, `p = ${fmtP(c.naive.p)}`, {
      textAnchor: 'middle',
      fill: C.redDeep,
      style: { font: fMono(600, 11.5), textDecoration: 'line-through' },
    }),
  );
  add(
    txt(bx1 + bw / 2, baseY + 16, `n = ${naiveN}`, {
      textAnchor: 'middle',
      fill: C.ink3,
      style: { font: fMono(500, 10) },
    }),
  );

  // deflate arrow from reported to honest
  add(
    <path
      d={`M${bx1 + bw / 2} ${repTop + 34} C ${bx1 + bw + 34} ${repTop + 40}, ${bx2 - 14} ${honTop - 52}, ${bx2 + bw / 2 - 2} ${honTop - 30}`}
      fill="none"
      stroke={C.red}
      strokeWidth={1.5}
      strokeDasharray="3 4"
    />,
  );
  add(
    <path
      d={`M${bx2 + bw / 2 - 8} ${honTop - 36} l 8 8 l 6 -10`}
      fill="none"
      stroke={C.red}
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    />,
  );

  // honest bar
  add(
    <rect
      x={bx2}
      y={honTop}
      width={bw}
      height={baseY - honTop}
      rx={3}
      fill={C.ink}
      className={RL_ANIM}
      style={{ transformBox: 'fill-box', transformOrigin: 'center bottom', animation: 'rl-grow .55s .8s ease both' }}
    />,
  );
  add(txt(bx2 + bw / 2, honTop - 24, 'honest re-test', { textAnchor: 'middle', fill: C.ink2, style: { font: fSans(500, 10) } }));
  add(
    txt(bx2 + bw / 2, honTop - 10, `p = ${fmtP(c.honest.p)}`, {
      textAnchor: 'middle',
      fill: C.ink,
      style: { font: fMono(600, 11.5) },
    }),
  );
  add(
    txt(bx2 + bw / 2, baseY + 16, `n = ${c.honest.n.toLocaleString()}`, {
      textAnchor: 'middle',
      fill: C.ink2,
      style: { font: fMono(500, 10) },
    }),
  );

  return <Svg label="Naive cell-level significance deflates under an honest per-unit re-test">{els}</Svg>;
}
