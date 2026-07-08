/**
 * The audit report as a real, downloadable PDF — not the browser's print
 * dialog on the dark app chrome. `downloadReportPdf` renders the session's
 * `AuditReport` into a clean, light, paginated document (selectable text,
 * built-in Helvetica/Courier so it needs no font fetch) and saves it to disk.
 *
 * The PDF is a superset of the on-screen report row: it keeps the verdict
 * band, the struck-through claim, and the defensible rewrite, and it *adds*
 * the compute headline and the per-check statistics table — the numbers a
 * reviewer actually needs on paper. It renders only fields the engine
 * produced; it never invents a figure or a stat (see docs/honesty-rules.md).
 */
import {
  Document,
  Page,
  View,
  Text,
  StyleSheet,
  pdf,
} from '@react-pdf/renderer';
import type { AuditReport, CheckResult, DatasetMeta, StatReadout } from '@redline/contracts';
import { signalColor, stateLabel } from '@redline/ui';
import { fmt } from './format';

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
  headline: { marginTop: 9, fontFamily: 'Helvetica', fontSize: 11, color: P.ink2 },
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
            <Text style={[S.statValue, { color: valueColor }]}>{safe(s.value)}</Text>
          </View>
        );
      })}
    </View>
  );
}

function CheckCard({ result }: { result: CheckResult }) {
  const { checkId, state, headline, stats, error, original, corrected, missing, citation } = result;
  const t = tint(state);
  const num = `0${checkId}`;
  const ref = `${citation.authors} (${citation.year}) · ${citation.venue}`;

  return (
    <View style={[S.card, { borderLeftColor: t.fg }]} wrap={false}>
      <View style={S.cardHead}>
        <Text style={S.num}>{num}</Text>
        <Text style={S.name}>{CHECK_NAMES[checkId] ?? `Check ${checkId}`}</Text>
        <Text style={[S.chip, { color: t.fg, borderColor: t.fg, backgroundColor: t.bg }]}>{stateLabel(state)}</Text>
      </View>

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
  generatedAt,
}: {
  report: AuditReport;
  dataset: DatasetMeta;
  generatedAt: string;
}) {
  const bandColor = report.flagged > 0 ? P.red : report.needInput > 0 ? P.amber : P.pass;
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
          Generated {generatedAt} · {report.results.length} of 4 checks run
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

        {/* per-check findings */}
        {report.results.length > 0 ? (
          report.results.map((r) => <CheckCard key={r.checkId} result={r} />)
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

/** Build the report PDF and trigger a browser download. Client-only. */
export async function downloadReportPdf(report: AuditReport, dataset: DatasetMeta): Promise<void> {
  const now = new Date();
  const generatedAt = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const stamp = now.toISOString().slice(0, 10);

  const blob = await pdf(
    <ReportDocument report={report} dataset={dataset} generatedAt={generatedAt} />,
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
