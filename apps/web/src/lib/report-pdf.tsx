/**
 * The audit report as a real, downloadable PDF — not the browser's print
 * dialog on the dark app chrome. `downloadReportPdf` renders the session's
 * `AuditReport` into a clean, light, paginated document (selectable text,
 * built-in Helvetica/Courier so it needs no font fetch) and saves it to disk.
 *
 * The PDF is a superset of the on-screen report row: per check it carries the
 * evidence figure (drawn from `result.chart` with SVG primitives), the compute
 * headline, the struck-through claim, the defensible rewrite, the statistics
 * table, and the method citation. Every mark and number is read from the
 * engine's result — it never invents a figure or a stat (docs/honesty-rules.md).
 */
import { Fragment } from 'react';
import {
  Document,
  Page,
  View,
  Text,
  StyleSheet,
  Svg,
  Rect,
  Line,
  Circle,
  pdf,
} from '@react-pdf/renderer';
import type { AuditReport, Chart, CheckResult, DatasetMeta, StatReadout } from '@redline/contracts';
import { signalColor, stateLabel } from '@redline/ui';
import type { ReportFinding } from '@/state/session';
import { ciLabel, fmt } from './format';

// Canonical check names — mirrors CHECK_META in components/check/CheckStage.tsx,
// inlined here so this module stays free of the client-only chart tree.
const CHECK_NAMES: Record<number, string> = {
  1: 'Pseudoreplication',
  2: 'Double dipping',
  3: 'Fragility',
  4: 'Confounding',
};

// Light document palette (kept in lockstep with @redline/ui `C`).
const P = {
  ink: '#10131A',
  ink2: '#44506A',
  ink3: '#6A7688',
  ink4: '#9AA6B8',
  line: '#E6EAF0',
  line2: '#D3DBE5',
  panel2: '#F1F4F8',
  red: '#E5484D',
  pass: '#12925E',
  amber: '#B45309',
  stop: '#1E293B',
} as const;

/** Soft fill + strong foreground for a verdict chip / accent, per state. */
function tint(state: CheckResult['state']): { fg: string; bg: string } {
  switch (state) {
    case 'flagged':
      return { fg: P.red, bg: '#FDECEC' };
    case 'clean':
      return { fg: P.pass, bg: '#E7F5EF' };
    case 'flag_only':
      return { fg: P.amber, bg: '#FBF1E5' };
    case 'hard_stop':
      return { fg: P.stop, bg: '#EEF1F6' };
    default:
      return { fg: P.ink4, bg: P.panel2 };
  }
}

// The built-in PDF fonts are WinAnsi-encoded and drop most non-Latin glyphs.
// Map the scientific symbols the narrative/stats can carry to safe equivalents
// so nothing renders as a blank box. (WinAnsi already covers smart quotes,
// en/em dashes, ellipsis, bullet, ×, ÷, ±, °, µ — those are left untouched.)
const GLYPHS: Record<string, string> = {
  'α': 'alpha', 'β': 'beta', 'γ': 'gamma', 'σ': 'sigma', 'Δ': 'delta', 'μ': 'µ',
  '≥': '>=', '≤': '<=', '≈': '~', '≠': '!=', '→': '->', '←': '<-', '▸': '>',
  '↑': 'up', '↓': 'down', '√': 'sqrt', '∞': 'inf', '−': '-',
};
// Superscript digits/signs (used in scientific notation like 6.2×10⁻⁹) are not
// in the WinAnsi encoding of the built-in fonts, so normalize a run of them to
// caret notation: "6.2×10⁻⁹" -> "6.2×10^-9".
const SUP: Record<string, string> = {
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁺': '+', '⁻': '-', 'ⁿ': 'n',
};
function safe(s: string): string {
  return s
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻ⁿ]+/g, (run) => '^' + [...run].map((c) => SUP[c] ?? '').join(''))
    .replace(/[αβγσΔμ≥≤≈≠→←▸↑↓√∞−]/g, (ch) => GLYPHS[ch] ?? ch);
}

// ── Evidence figures ─────────────────────────────────────────────────────────
// Clean, data-driven glyphs per check, drawn from `result.chart` with react-pdf
// SVG primitives (miniatures of the on-screen figures; verdict-tinted). The
// viewBox is a fixed 210×116 box scaled to the plate.
const VB = { w: 210, h: 116 } as const;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

function Figure({ chart, fg }: { chart: Chart; fg: string }) {
  const svgProps = { viewBox: `0 0 ${VB.w} ${VB.h}`, style: { width: '100%', height: '100%' } as const };

  // Check 1 — pseudoreplication: naive vs honest significance as two bars,
  // with a dashed α rule. Bar height ∝ −log10(p); the naive bar towers past α,
  // the honest bar sits below it.
  if (chart.kind === 'significance') {
    const base = 98, span = 78;
    // Significance magnitude = |log10(p)|, robust to the sign convention of the
    // stored `log10p`. Bigger = more significant; the α threshold is |log10(α)|.
    const naiveSig = Math.abs(chart.naive.log10p);
    const honestSig = Math.abs(chart.honest.log10p);
    const alphaSig = Math.abs(Math.log10(chart.alpha || 0.05));
    const max = Math.max(naiveSig, alphaSig * 1.15, 1);
    const h = (s: number) => Math.max(3, (clamp(s, 0, max) / max) * span);
    const alphaY = base - (clamp(alphaSig, 0, max) / max) * span;
    return (
      <Svg {...svgProps}>
        <Line x1={38} y1={base} x2={186} y2={base} stroke="#D3DBE5" strokeWidth={1} />
        <Line x1={38} y1={alphaY} x2={186} y2={alphaY} stroke="#9AA6B8" strokeWidth={1} strokeDasharray="3 3" />
        <Rect x={74} y={base - h(naiveSig)} width={28} height={h(naiveSig)} rx={3} fill={fg} />
        <Rect x={124} y={base - h(honestSig)} width={28} height={h(honestSig)} rx={3} fill="#10131A" />
      </Svg>
    );
  }

  // Check 1 hard branch — too few independent units: a row of unit dots.
  if (chart.kind === 'hardstop') {
    const n = clamp(chart.units, 1, 8);
    const dots = Array.from({ length: n }, (_, i) => 46 + i * 20);
    return (
      <Svg {...svgProps}>
        <Line x1={38} y1={74} x2={186} y2={74} stroke="#D3DBE5" strokeWidth={1} />
        {dots.map((x, i) => (
          <Circle key={i} cx={x} cy={58} r={6} fill="none" stroke={fg} strokeWidth={2} />
        ))}
      </Svg>
    );
  }

  // Check 2 — double dipping: dumbbell per marker across an AUC axis (0.5→1).
  // Discovery point in ink, held-out point in verdict color; a dashed rule at
  // chance (0.5). Markers that collapse toward chance out of sample are the tell.
  if (chart.kind === 'groups') {
    const x0 = 58, x1 = 190;
    const xf = (auc: number) => x0 + (clamp(auc, 0.5, 1) - 0.5) / 0.5 * (x1 - x0);
    const rows = chart.markers.slice(0, 5);
    const step = rows.length > 0 ? Math.min(20, 84 / rows.length) : 20;
    const top = 20;
    return (
      <Svg {...svgProps}>
        <Line x1={x0} y1={12} x2={x0} y2={104} stroke="#9AA6B8" strokeWidth={1} strokeDasharray="3 3" />
        {rows.map((m, i) => {
          const y = top + i * step;
          return (
            <Fragment key={i}>
              <Line x1={xf(m.hold)} y1={y} x2={xf(m.disc)} y2={y} stroke="#D3DBE5" strokeWidth={1.5} />
              <Circle cx={xf(m.disc)} cy={y} r={3.5} fill="#10131A" />
              <Circle cx={xf(m.hold)} cy={y} r={3.5} fill="#FFFFFF" stroke={fg} strokeWidth={2} />
            </Fragment>
          );
        })}
      </Svg>
    );
  }

  // Check 3 — fragility: a presence strip across the resolution sweep (filled =
  // the tracked group is a discrete cluster there), plus a stability bar.
  if (chart.kind === 'fragility') {
    const steps = chart.steps.slice(0, 10);
    const n = Math.max(steps.length, 1);
    const gap = 4, left = 38, right = 186;
    const cw = (right - left - gap * (n - 1)) / n;
    return (
      <Svg {...svgProps}>
        {steps.map((s, i) => {
          const x = left + i * (cw + gap);
          return (
            <Rect key={i} x={x} y={28} width={cw} height={30} rx={2.5}
              fill={s.present ? fg : '#F1F4F8'} stroke={s.present ? 'none' : '#D3DBE5'} strokeWidth={1} />
          );
        })}
        <Rect x={left} y={76} width={right - left} height={9} rx={4.5} fill="#F1F4F8" stroke="#D3DBE5" strokeWidth={1} />
        <Rect x={left} y={76} width={Math.max(5, (right - left) * clamp(chart.stability, 0, 1))} height={9} rx={4.5} fill={fg} />
      </Svg>
    );
  }

  // Check 4 — confounding: the contingency grid (grouping × technical variable).
  // Occupied cells in ink; when the two variables are inseparable (not verified)
  // the occupied cells are ringed in verdict color.
  if (chart.kind === 'confound') {
    const rows = chart.grid.cells.slice(0, 4);
    const nr = Math.max(rows.length, 1);
    const nc = Math.max(rows[0]?.length ?? 1, 1);
    const cell = clamp(Math.min(120 / nc, 68 / nr), 14, 34);
    const gw = nc * cell, gh = nr * cell;
    const ox = (VB.w - gw) / 2, oy = (VB.h - gh) / 2;
    const pad = 3;
    return (
      <Svg {...svgProps}>
        {rows.map((row, r) =>
          row.slice(0, 4).map((v, c) => {
            const filled = v > 0;
            const x = ox + c * cell, y = oy + r * cell;
            return (
              <Fragment key={`${r}-${c}`}>
                <Rect x={x + pad} y={y + pad} width={cell - pad * 2} height={cell - pad * 2} rx={3}
                  fill={filled ? '#10131A' : '#F1F4F8'} stroke={filled ? 'none' : '#D3DBE5'} strokeWidth={1}
                  strokeDasharray={filled ? undefined : '3 3'} />
                {filled && !chart.verified && (
                  <Rect x={x + pad - 2} y={y + pad - 2} width={cell - pad * 2 + 4} height={cell - pad * 2 + 4} rx={4}
                    fill="none" stroke={fg} strokeWidth={1.75} />
                )}
              </Fragment>
            );
          }),
        )}
      </Svg>
    );
  }

  return null;
}

const S = StyleSheet.create({
  page: {
    paddingTop: 42,
    paddingBottom: 54,
    paddingHorizontal: 44,
    backgroundColor: '#FFFFFF',
    color: P.ink,
    fontFamily: 'Helvetica',
    fontSize: 10,
    lineHeight: 1.5,
  },
  // header
  kicker: { fontFamily: 'Courier-Bold', fontSize: 8, letterSpacing: 2, color: P.red },
  title: { fontFamily: 'Helvetica-Bold', fontSize: 21, color: P.ink, marginTop: 8 },
  meta: { fontFamily: 'Courier', fontSize: 9, color: P.ink3, marginTop: 7 },
  metaFile: { color: P.ink2 },
  rule: { borderBottomWidth: 1, borderBottomColor: P.line, marginTop: 16, marginBottom: 18 },
  // verdict band
  band: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: P.line,
    borderLeftWidth: 3,
    borderRadius: 8,
    paddingVertical: 16,
    paddingHorizontal: 18,
    marginBottom: 20,
  },
  tiles: { flexDirection: 'row' },
  tile: { marginRight: 22 },
  tileN: { fontFamily: 'Courier-Bold', fontSize: 22 },
  tileLabel: { fontFamily: 'Courier', fontSize: 7, letterSpacing: 1.2, color: P.ink4, marginTop: 5, textTransform: 'uppercase' },
  bandDivider: { width: 1, alignSelf: 'stretch', backgroundColor: P.line, marginRight: 18 },
  verdict: { flex: 1, fontFamily: 'Helvetica', fontSize: 12, color: P.ink },
  // check card
  card: {
    borderWidth: 1,
    borderColor: P.line,
    borderLeftWidth: 3,
    borderRadius: 8,
    padding: 16,
    marginBottom: 14,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center' },
  num: { fontFamily: 'Courier', fontSize: 10, color: P.ink4, marginRight: 10 },
  name: { fontFamily: 'Helvetica-Bold', fontSize: 13, color: P.ink },
  chip: {
    marginLeft: 'auto',
    fontFamily: 'Helvetica-Bold',
    fontSize: 8,
    letterSpacing: 0.8,
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
    textTransform: 'uppercase',
  },
  // body: figure plate (left) + verdict content (right)
  body: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 14, gap: 16 },
  plate: {
    width: 176,
    flexShrink: 0,
    borderWidth: 1,
    borderColor: P.line,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  plateHead: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 11, borderBottomWidth: 1, borderBottomColor: P.line },
  plateLabel: { fontFamily: 'Courier-Bold', fontSize: 7, letterSpacing: 1.4, color: '#8792a3', textTransform: 'uppercase' },
  plateFig: { height: 104, paddingVertical: 10, paddingHorizontal: 12 },
  content: { flex: 1 },
  headline: { fontFamily: 'Helvetica', fontSize: 11, color: P.ink2 },
  errorLine: { marginTop: 9, fontFamily: 'Courier-Bold', fontSize: 9.5, color: P.red },
  original: {
    marginTop: 9,
    fontFamily: 'Helvetica',
    fontSize: 11,
    color: P.ink4,
    textDecoration: 'line-through',
  },
  correctedRow: { flexDirection: 'row', marginTop: 8 },
  caret: { fontFamily: 'Helvetica-Bold', color: P.red, marginRight: 6 },
  corrected: { flex: 1, fontFamily: 'Helvetica', fontSize: 11, color: P.ink },
  missing: {
    marginTop: 10,
    backgroundColor: '#FBF1E5',
    borderWidth: 1,
    borderColor: '#E7D0A8',
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 9,
    flexDirection: 'row',
  },
  missingTag: { fontFamily: 'Courier-Bold', fontSize: 7, letterSpacing: 1, color: P.amber, marginRight: 8, textTransform: 'uppercase' },
  missingText: { flex: 1, fontFamily: 'Helvetica', fontSize: 9.5, color: P.ink2 },
  // stats table
  stats: { marginTop: 12, borderTopWidth: 1, borderTopColor: P.line, paddingTop: 10 },
  statsHead: { fontFamily: 'Courier-Bold', fontSize: 7, letterSpacing: 1, color: P.ink4, textTransform: 'uppercase', marginBottom: 6 },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2.5 },
  statLabel: { fontFamily: 'Helvetica', fontSize: 9.5, color: P.ink3 },
  statValue: { fontFamily: 'Courier', fontSize: 9.5, color: P.ink },
  statValueCol: { flexDirection: 'column', alignItems: 'flex-end' },
  statCI: { fontFamily: 'Courier', fontSize: 6.5, color: P.ink4, marginTop: 1 },
  // citation
  cite: { marginTop: 12, borderTopWidth: 1, borderTopColor: P.line, paddingTop: 10, flexDirection: 'row' },
  citeTag: { fontFamily: 'Courier-Bold', fontSize: 7, letterSpacing: 1, color: P.ink4, marginRight: 9, textTransform: 'uppercase' },
  citeRef: { fontFamily: 'Courier', fontSize: 9, color: P.ink2 },
  citeNote: { fontFamily: 'Helvetica', fontSize: 9, color: P.ink3, marginTop: 3 },
  // closing + footer
  closing: { marginTop: 12, fontFamily: 'Helvetica', fontSize: 9.5, color: P.ink3 },
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 44,
    right: 44,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontFamily: 'Courier',
    fontSize: 7.5,
    color: P.ink4,
  },
});

function StatTable({ stats }: { stats: StatReadout[] }) {
  if (!stats || stats.length === 0) return null;
  return (
    <View style={S.stats}>
      <Text style={S.statsHead}>Statistics</Text>
      {stats.map((s, i) => {
        const valueColor = s.bad ? P.red : s.good ? P.pass : P.ink;
        return (
          <View key={i} style={S.statRow}>
            <Text style={S.statLabel}>{safe(s.label)}</Text>
            <View style={S.statValueCol}>
              <Text style={[S.statValue, { color: valueColor }]}>{safe(s.value)}</Text>
              {s.interval ? (
                <Text style={S.statCI}>{safe(`${ciLabel(s.interval, s.value)} · ${s.interval.n} runs`)}</Text>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function CheckCard({ result, claimText }: { result: CheckResult; claimText?: string }) {
  const { checkId, state, headline, stats, error, original, corrected, missing, citation } = result;
  const t = tint(state);
  const num = `0${checkId}`;
  const ref = `${citation.authors} (${citation.year}) · ${citation.venue}`;
  // Title the card with the claim this run audited, so two findings on the same
  // check read apart on the page (mirrors the on-screen ReportRow).
  const name = claimText ? `${CHECK_NAMES[checkId] ?? `Check ${checkId}`}: ${claimText}` : CHECK_NAMES[checkId] ?? `Check ${checkId}`;

  return (
    <View style={[S.card, { borderLeftColor: t.fg }]} wrap={false}>
      <View style={S.cardHead}>
        <Text style={S.num}>{num}</Text>
        <Text style={S.name}>{name}</Text>
        <Text style={[S.chip, { color: t.fg, borderColor: t.fg, backgroundColor: t.bg }]}>{stateLabel(state)}</Text>
      </View>

      <View style={S.body}>
        {/* figure plate */}
        <View style={S.plate}>
          <View style={S.plateHead}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.fg }} />
            <Text style={S.plateLabel}>Fig {num}</Text>
          </View>
          <View style={S.plateFig}>
            <Figure chart={result.chart} fg={t.fg} />
          </View>
        </View>

        {/* verdict content */}
        <View style={S.content}>
          {headline ? <Text style={S.headline}>{safe(headline)}</Text> : null}
          {error ? <Text style={S.errorLine}>{safe(error)}</Text> : null}
          {original ? <Text style={S.original}>{safe(original)}</Text> : null}

          <View style={S.correctedRow}>
            <Text style={S.caret}>&gt;</Text>
            <Text style={S.corrected}>{safe(corrected)}</Text>
          </View>

          {missing ? (
            <View style={S.missing}>
              <Text style={S.missingTag}>Missing</Text>
              <Text style={S.missingText}>{safe(missing)}</Text>
            </View>
          ) : null}

          <StatTable stats={stats} />
        </View>
      </View>

      {/* method citation: full width under the body */}
      <View style={S.cite}>
        <Text style={S.citeTag}>Method</Text>
        <View style={{ flex: 1 }}>
          <Text style={S.citeRef}>{safe(ref)}</Text>
          {citation.note ? <Text style={S.citeNote}>{safe(citation.note)}</Text> : null}
          {citation.url ? <Text style={[S.citeNote, { color: '#2563EB' }]}>{citation.url}</Text> : null}
        </View>
      </View>
    </View>
  );
}

function ReportDocument({
  report,
  dataset,
  findings,
  generatedAt,
}: {
  report: AuditReport;
  dataset: DatasetMeta;
  findings: ReportFinding[];
  generatedAt: string;
}) {
  const bandColor = report.flagged > 0 ? P.red : report.needInput > 0 ? P.amber : P.pass;
  const ran = findings.length;
  const counts = [
    { n: report.flagged, label: 'flagged', c: P.red },
    { n: report.clean, label: 'verified', c: P.pass },
    { n: report.needInput, label: 'need input', c: P.amber },
  ];

  return (
    <Document title={`Redline audit — ${dataset.title}`} author="Redline" subject="Statistical-rigor audit report">
      <Page size="A4" style={S.page}>
        {/* header */}
        <Text style={S.kicker}>REDLINE · AUDIT REPORT</Text>
        <Text style={S.title}>{safe(dataset.title)}</Text>
        <Text style={S.meta}>
          {fmt(dataset.cells)} cells · {fmt(dataset.replicates)} {dataset.replicateLabel} · from{' '}
          <Text style={S.metaFile}>{dataset.file}</Text>
        </Text>
        <Text style={[S.meta, { marginTop: 2 }]}>
          Generated {generatedAt} · {ran} {ran === 1 ? 'check' : 'checks'} run
        </Text>
        <View style={S.rule} />

        {/* verdict band */}
        <View style={[S.band, { borderLeftColor: bandColor }]}>
          <View style={S.tiles}>
            {counts.map((t) => (
              <View key={t.label} style={S.tile}>
                <Text style={[S.tileN, { color: t.n > 0 ? t.c : P.ink4 }]}>{t.n}</Text>
                <Text style={S.tileLabel}>{t.label}</Text>
              </View>
            ))}
          </View>
          <View style={S.bandDivider} />
          <Text style={S.verdict}>{safe(report.verdict)}</Text>
        </View>

        {/* per-run findings: one card per run that produced a result, titled with
            the claim it audited so two findings on the same check read apart */}
        {findings.length > 0 ? (
          findings.map((f) => <CheckCard key={f.key} result={f.result} claimText={f.claimText} />)
        ) : (
          <Text style={{ color: P.ink4, fontFamily: 'Courier', fontSize: 10 }}>
            No checks have run yet. Confirm the design and run the four checks to populate this report.
          </Text>
        )}

        {/* closing note */}
        <Text style={S.closing}>
          Redline reports evidence and flags. Except where noted, it does not overwrite your analysis. The rewritten
          conclusions above are the defensible version of each claim, for you to accept.
        </Text>

        {/* footer: page numbers */}
        <View style={S.footer} fixed>
          <Text>REDLINE</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'report';
}

/** Build the report PDF and trigger a browser download. Client-only. The
 *  `findings` carry each run's claim so the cards title two findings on one check
 *  apart, exactly as the on-screen report does. */
export async function downloadReportPdf(
  report: AuditReport,
  dataset: DatasetMeta,
  findings: ReportFinding[],
): Promise<void> {
  const now = new Date();
  const generatedAt = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const stamp = now.toISOString().slice(0, 10);

  const blob = await pdf(
    <ReportDocument report={report} dataset={dataset} findings={findings} generatedAt={generatedAt} />,
  ).toBlob();

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Redline-audit-${slug(dataset.label || dataset.title)}-${stamp}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the click has committed to the download.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export { ReportDocument };
