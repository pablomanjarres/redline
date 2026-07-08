import type { ReactElement } from 'react';
import type * as RC from '@redline/contracts';
import { C } from '@redline/ui';
import { Svg, txt, keyer, fSans, fMono, RL_ANIM } from './svg';

/**
 * Check 1 (pseudoreplication), as clean data-viz. Two panels:
 *  - left: the independent units (cells aggregate to a handful of donors).
 *  - right: a -log10(p) bar chart with an alpha reference line. The reported
 *    cell-level value towers over the honest donor-level value, which sits below
 *    the significance line. No hand-drawn marks: bars, gridlines, a dashed rule.
 * The `hardstop` branch reports too few units for any valid test.
 */

const SUP: Record<string, string> = {
  '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³',
  '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
};
const sup = (s: string): string => s.split('').map((ch) => SUP[ch] ?? ch).join('');

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
    const gx = groups.length === 2 ? [200, 420] : groups.map((_, i) => 160 + i * 130);
    add(txt(310, 40, 'Independent units available', { textAnchor: 'middle', fill: C.ink3, style: { font: fSans(500, 12) } }));
    groups.forEach((g, gi) => {
      add(<rect x={gx[gi]! - 74} y={92} width={148} height={132} rx={12} fill={C.panel2} stroke={C.line} strokeWidth={1} />);
      add(<circle cx={gx[gi]} cy={150} r={22} fill="#fff" stroke={C.stop} strokeWidth={2} />);
      add(txt(gx[gi], 158, String(chart.perGroup), { textAnchor: 'middle', fill: C.stop, style: { font: fMono(600, 20) } }));
      add(txt(gx[gi], 210, g, { textAnchor: 'middle', fill: C.ink2, style: { font: fSans(500, 12) } }));
    });
    add(txt(310, 262, `n = ${chart.perGroup} per group. No replication, no valid test.`, { textAnchor: 'middle', fill: C.redDeep, style: { font: fSans(600, 13) } }));
    return <Svg vb="0 0 620 300" label="Too few independent units for a valid test">{els}</Svg>;
  }

  const c = chart;
  const units = c.units;
  const groups = [...new Set(units.map((u) => u.group))];
  const groupTone = (g: string): string => (groups.indexOf(g) === 0 ? C.ink4 : C.ink2);

  // ---- left panel: cells collapse to independent units ----
  const naiveN = c.naive.n.toLocaleString();
  add(txt(28, 34, 'The independent units', { fill: C.ink3, style: { font: fSans(600, 11) } }));
  // faint cell field
  for (let i = 0; i < 60; i++) {
    const cx = 44 + (i % 12) * 18;
    const cy = 58 + Math.floor(i / 12) * 15;
    add(<circle cx={cx} cy={cy} r={2.1} fill={C.line2} />);
  }
  add(txt(150, 150, `${naiveN} cells (measurements)`, { textAnchor: 'middle', fill: C.ink4, style: { font: fMono(500, 10) } }));
  add(txt(150, 178, '▼', { textAnchor: 'middle', fill: C.ink4, style: { font: fSans(400, 11) } }));
  // donor dots
  const dcx = units.length <= 6 ? units.map((_, i) => 150 - ((units.length - 1) * 30) / 2 + i * 30) : [];
  units.forEach((u, i) => {
    add(<circle cx={dcx[i]} cy={212} r={8} fill={groupTone(u.group)} />);
    add(txt(dcx[i]!, 234, u.id, { textAnchor: 'middle', fill: C.ink4, style: { font: fMono(500, 9) } }));
  });
  add(txt(150, 268, `n = ${units.length} ${units.length === 1 ? 'unit' : 'units'}, not ${naiveN}`, { textAnchor: 'middle', fill: C.redDeep, style: { font: fSans(600, 12.5) } }));

  add(<line x1={305} y1={30} x2={305} y2={288} stroke={C.line} strokeWidth={1} />);

  // ---- right panel: -log10(p) bars with alpha reference ----
  const x0 = 344;
  const baseY = 280;
  const topY = 52;
  const maxV = Math.max(9.2, c.naive.log10p * 1.16);
  const Y = (v: number): number => baseY - (v / maxV) * (baseY - topY);
  const aY = Y(-Math.log10(c.alpha));
  const alphaLabel = String(c.alpha).replace(/^0\./, '.');

  // recessive gridlines + y ticks (integer steps read cleanly)
  const gStep = 2;
  for (let v = 0; v <= maxV + 1e-6; v += gStep) {
    add(<line x1={x0} y1={Y(v)} x2={604} y2={Y(v)} stroke={C.grid} strokeWidth={1} />);
    add(txt(x0 - 6, Y(v) + 3, v.toFixed(0), { textAnchor: 'end', fill: C.ink4, style: { font: fMono(400, 9) } }));
  }
  add(txt(x0, 40, '−log₁₀ p', { fill: C.ink4, style: { font: fMono(500, 10) } }));
  // alpha reference
  add(<line x1={x0} y1={aY} x2={604} y2={aY} stroke={C.line2} strokeWidth={1} strokeDasharray="4 4" />);
  add(txt(604, aY - 6, `α = ${alphaLabel}`, { textAnchor: 'end', fill: C.ink3, style: { font: fMono(500, 10) } }));

  const bw = 58;
  const bxA = 392;
  const bxB = 486;
  const repTop = Y(c.naive.log10p);
  const honTop = Y(c.honest.log10p);
  const honLabelY = Math.min(honTop, aY);

  // reported bar (the inflated, rejected result)
  add(<rect x={bxA} y={repTop} width={bw} height={baseY - repTop} rx={4} fill={C.red} className={RL_ANIM} style={{ transformBox: 'fill-box', transformOrigin: 'center bottom', animation: 'rl-grow .5s .1s ease both' }} />);
  add(txt(bxA + bw / 2, repTop - 22, 'reported', { textAnchor: 'middle', fill: C.ink3, style: { font: fSans(500, 10) } }));
  add(txt(bxA + bw / 2, repTop - 8, `p = ${fmtP(c.naive.p)}`, { textAnchor: 'middle', fill: C.redDeep, style: { font: fMono(600, 11), textDecoration: 'line-through' } }));
  add(txt(bxA + bw / 2, baseY + 15, 'cell-level', { textAnchor: 'middle', fill: C.ink4, style: { font: fSans(400, 9.5) } }));

  // honest bar (the truth, below alpha)
  add(<rect x={bxB} y={honTop} width={bw} height={baseY - honTop} rx={4} fill={C.ink} className={RL_ANIM} style={{ transformBox: 'fill-box', transformOrigin: 'center bottom', animation: 'rl-grow .5s .35s ease both' }} />);
  add(txt(bxB + bw / 2, honLabelY - 22, 'honest', { textAnchor: 'middle', fill: C.ink3, style: { font: fSans(500, 10) } }));
  add(txt(bxB + bw / 2, honLabelY - 8, `p = ${fmtP(c.honest.p)}`, { textAnchor: 'middle', fill: C.ink, style: { font: fMono(600, 11) } }));
  add(txt(bxB + bw / 2, baseY + 15, 'donor-level', { textAnchor: 'middle', fill: C.ink4, style: { font: fSans(400, 9.5) } }));

  // clean deflate guide: a thin dashed line + small arrowhead from reported to honest
  const gx1 = bxA + bw / 2;
  const gx2 = bxB + bw / 2;
  add(<path d={`M${gx1 + bw / 2 - 4} ${repTop + 10} C ${gx1 + 60} ${repTop + 30}, ${gx2 - 40} ${honLabelY - 40}, ${gx2} ${honLabelY - 34}`} fill="none" stroke={C.ink4} strokeWidth={1.25} strokeDasharray="2 4" />);
  add(<path d={`M${gx2 - 4} ${honLabelY - 40} l 4 6 l 5 -5`} fill="none" stroke={C.ink4} strokeWidth={1.25} strokeLinecap="round" strokeLinejoin="round" />);

  add(<line x1={x0} y1={baseY} x2={604} y2={baseY} stroke={C.line2} strokeWidth={1} />);

  return <Svg vb="0 0 620 300" label="Cell-level significance collapses to a non-significant donor-level result">{els}</Svg>;
}
