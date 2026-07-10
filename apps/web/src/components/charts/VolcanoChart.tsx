import type { ReactElement } from 'react';
import type * as RC from '@redline/contracts';
import { C } from '@redline/ui';
import { Svg, txt, keyer, fSans, fMono } from './svg';

/**
 * A volcano plot, in the house style. log2 fold change on x, -log10(p) on y. A
 * dashed horizontal rule marks the significance threshold (alpha), two dashed
 * vertical rules mark the fold-change threshold. Genes the scientist called
 * significant carry a label and an outline; genes that survive the honest test
 * are drawn in the editorial red. This is the corrected downstream artifact for
 * a differential-expression finding (checks 1, 6, 8 fix-and-preview, and the
 * "after" panel of a before/after), never a check's own evidence chart.
 */
export function VolcanoChart({ chart }: { chart: RC.VolcanoChart }): ReactElement {
  const { add, els } = keyer();
  const pts = chart.points;

  const left = 56;
  const right = 592;
  const top = 54;
  const base = 280;

  const maxAbsFc = Math.max(1, ...pts.map((p) => Math.abs(p.log2fc)), chart.fcThreshold * 1.2);
  const maxY = Math.max(1, ...pts.map((p) => p.negLog10P), Math.abs(Math.log10(chart.alpha)) * 1.2);

  const X = (fc: number): number => left + ((fc + maxAbsFc) / (2 * maxAbsFc)) * (right - left);
  const Y = (v: number): number => base - (Math.min(v, maxY) / maxY) * (base - top);

  // header
  add(txt(28, 34, chart.label, { fill: C.ink3, style: { font: fSans(600, 11) } }));

  // gridlines + y ticks
  const yStep = maxY <= 6 ? 2 : maxY <= 20 ? 5 : 10;
  for (let v = 0; v <= maxY + 1e-6; v += yStep) {
    add(<line x1={left} y1={Y(v)} x2={right} y2={Y(v)} stroke={C.grid} strokeWidth={1} />);
    add(txt(left - 6, Y(v) + 3, v.toFixed(0), { textAnchor: 'end', fill: C.ink4, style: { font: fMono(400, 9) } }));
  }
  add(txt(left, 46, '−log₁₀ p', { fill: C.ink4, style: { font: fMono(500, 10) } }));

  // significance threshold (alpha)
  const aY = Y(Math.abs(Math.log10(chart.alpha)));
  add(<line x1={left} y1={aY} x2={right} y2={aY} stroke={C.line2} strokeWidth={1} strokeDasharray="4 4" />);
  add(txt(right, aY - 6, `α = ${String(chart.alpha).replace(/^0\./, '.')}`, { textAnchor: 'end', fill: C.ink3, style: { font: fMono(500, 10) } }));

  // fold-change thresholds
  [-chart.fcThreshold, chart.fcThreshold].forEach((fc) => {
    add(<line x1={X(fc)} y1={top} x2={X(fc)} y2={base} stroke={C.grid} strokeWidth={1} strokeDasharray="4 4" />);
  });
  // x baseline + zero rule + ticks
  add(<line x1={left} y1={base} x2={right} y2={base} stroke={C.line2} strokeWidth={1} />);
  add(<line x1={X(0)} y1={top} x2={X(0)} y2={base} stroke={C.line} strokeWidth={1} />);
  [-Math.round(maxAbsFc), 0, Math.round(maxAbsFc)].forEach((fc) => {
    add(txt(X(fc), base + 16, fc.toString(), { textAnchor: 'middle', fill: C.ink4, style: { font: fMono(400, 9) } }));
  });
  add(txt(right, base + 16, 'log₂FC', { textAnchor: 'end', fill: C.ink4, style: { font: fMono(500, 10) } }));

  // points: unremarkable dots in recessive ink, survivors in red, claimed outlined + labeled
  pts.forEach((p) => {
    const x = X(p.log2fc);
    const y = Y(p.negLog10P);
    if (p.sig) {
      add(<circle cx={x} cy={y} r={4} fill={C.red} fillOpacity={0.9} />);
    } else {
      add(<circle cx={x} cy={y} r={2.6} fill={C.line2} />);
    }
    if (p.claimed) {
      add(<circle cx={x} cy={y} r={6.5} fill="none" stroke={p.sig ? C.redDeep : C.ink3} strokeWidth={1.5} />);
      add(txt(x + 9, y + 3, p.gene, { fill: p.sig ? C.redDeep : C.ink3, style: { font: fMono(500, 9.5) } }));
    }
  });

  // survivor count
  add(txt(28, base + 34, `${chart.nSig} gene${chart.nSig === 1 ? '' : 's'} survive at α and |log₂FC| ≥ ${chart.fcThreshold}`, { fill: chart.nSig > 0 ? C.ink2 : C.ink4, style: { font: fSans(600, 11.5) } }));

  return (
    <Svg vb="0 0 620 328" label={`Volcano plot: ${chart.label}`}>
      {els}
    </Svg>
  );
}
