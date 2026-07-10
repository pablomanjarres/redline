import type { ReactElement } from 'react';
import type * as RC from '@redline/contracts';
import { C } from '@redline/ui';
import { Svg, txt, keyer, fSans, fMono } from './svg';

/**
 * Check 5 (multiple testing), as clean data-viz. Two bars, side by side: how
 * many genes clear the raw p threshold, and how many still clear it after a real
 * Benjamini-Hochberg (or Benjamini-Yekutieli) correction. The drop between them
 * is the false-discovery load. Below, a small table of the strongest genes with
 * raw p and adjusted q, so a reader can see which claims survive.
 */
export function FdrChart({ chart }: { chart: RC.FdrChart }): ReactElement {
  const { add, els } = keyer();
  const methodLabel = chart.method === 'bh' ? 'Benjamini-Hochberg' : 'Benjamini-Yekutieli';

  const base = 200;
  const top = 40;
  const maxV = Math.max(chart.rawHits, 1);
  const H = (v: number): number => (v / maxV) * (base - top);

  add(txt(28, 28, `Hits across ${chart.tests.toLocaleString()} tested genes`, { fill: C.ink3, style: { font: fSans(600, 11) } }));

  const bw = 96;
  const bxA = 150;
  const bxB = 340;

  // raw-hit bar (the inflated count)
  const rawTop = base - H(chart.rawHits);
  add(<rect x={bxA} y={rawTop} width={bw} height={base - rawTop} rx={4} fill={C.red} />);
  add(txt(bxA + bw / 2, rawTop - 10, String(chart.rawHits), { textAnchor: 'middle', fill: C.redDeep, style: { font: fMono(700, 18) } }));
  add(txt(bxA + bw / 2, base + 18, 'raw p < α', { textAnchor: 'middle', fill: C.ink3, style: { font: fSans(500, 10.5) } }));

  // adjusted-hit bar (the honest count)
  const adjTop = base - H(chart.adjustedHits);
  add(<rect x={bxB} y={adjTop} width={bw} height={base - adjTop} rx={4} fill={C.ink} />);
  add(txt(bxB + bw / 2, adjTop - 10, String(chart.adjustedHits), { textAnchor: 'middle', fill: C.ink, style: { font: fMono(700, 18) } }));
  add(txt(bxB + bw / 2, base + 18, `q < α (${methodLabel})`, { textAnchor: 'middle', fill: C.ink3, style: { font: fSans(500, 10.5) } }));

  add(<line x1={120} y1={base} x2={470} y2={base} stroke={C.line2} strokeWidth={1} />);
  add(txt(500, base - 20, `α = ${String(chart.alpha).replace(/^0\./, '.')}`, { fill: C.ink4, style: { font: fMono(500, 10) } }));
  const dropped = chart.rawHits - chart.adjustedHits;
  add(txt(500, base, `${dropped} false`, { fill: C.redDeep, style: { font: fSans(600, 11) } }));

  return (
    <div style={{ width: '100%' }}>
      <Svg vb="0 0 620 232" label={`False-discovery control: ${chart.adjustedHits} of ${chart.rawHits} hits survive ${methodLabel}`}>
        {els}
      </Svg>
      {chart.top.length > 0 && (
        <div className="rl-scroll" style={{ marginTop: 12, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', font: '400 11px/1.4 var(--mono)' }}>
            <caption style={{ textAlign: 'left', font: '600 9.5px/1 var(--mono)', letterSpacing: '.12em', textTransform: 'uppercase', color: '#8792a3', padding: '0 0 8px' }}>
              Strongest genes, raw p ascending
            </caption>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.line}` }}>
                <th scope="col" style={{ textAlign: 'left', padding: '5px 8px', color: C.ink3, fontWeight: 600 }}>Gene</th>
                <th scope="col" style={{ textAlign: 'right', padding: '5px 8px', color: C.ink3, fontWeight: 600 }}>raw p</th>
                <th scope="col" style={{ textAlign: 'right', padding: '5px 8px', color: C.ink3, fontWeight: 600 }}>q</th>
                <th scope="col" style={{ textAlign: 'right', padding: '5px 8px', color: C.ink3, fontWeight: 600 }}>survives</th>
              </tr>
            </thead>
            <tbody>
              {chart.top.map((g) => (
                <tr key={g.gene} style={{ borderBottom: `1px solid ${C.grid}` }}>
                  <td style={{ padding: '5px 8px', color: C.ink }}>{g.gene}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: C.ink2 }}>{fmtP(g.p)}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: g.survives ? C.ink2 : C.redDeep }}>{fmtP(g.q)}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: g.survives ? C.pass : C.redDeep, fontWeight: 600 }}>
                    {g.survives ? 'yes' : 'no'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function fmtP(p: number): string {
  if (!Number.isFinite(p) || p <= 0) return String(p);
  if (p >= 0.001) return p.toFixed(3);
  return p.toExponential(1);
}
