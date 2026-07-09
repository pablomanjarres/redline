'use client';

import Link from 'next/link';
import { useState } from 'react';
import { CHECK_COUNT } from '@redline/contracts';
import { useSession } from '@/state/session';
import { fmt } from '@/lib/format';
import { ReportRow } from '@/components/report/ReportRow';

/**
 * The audit report: a dark verdict sheet. A mono kicker + display title name
 * the specimen; a bold verdict band tallies the run in signal color and states
 * the overall verdict; one ReportRow per check carries the finding, the figure
 * on a lightbox plate, and the citation. "Export PDF" renders a real, light,
 * downloadable report document via `@/lib/report-pdf` (not a print of this
 * dark page); the button carries `rl-no-print` so an ad-hoc Cmd+P still omits
 * it.
 */
export default function ReportPage() {
  const { report, dataset } = useSession();
  const [exporting, setExporting] = useState(false);

  // Generate a real, downloadable PDF report (not a print of the dark app
  // page). The renderer is a heavy dependency, so it is code-split and only
  // pulled in when the operator actually exports.
  const onExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const { downloadReportPdf } = await import('@/lib/report-pdf');
      await downloadReportPdf(report, dataset);
    } catch (err) {
      console.error('Report PDF export failed', err);
      if (typeof window !== 'undefined') window.alert('Could not generate the PDF. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  const counts = [
    { n: report.flagged, label: 'flagged', c: 'var(--red)' },
    { n: report.clean, label: 'verified', c: 'var(--green)' },
    { n: report.needInput, label: 'need input', c: 'var(--amber)' },
  ];
  const bandColor = report.flagged > 0 ? 'var(--red)' : report.needInput > 0 ? 'var(--amber)' : 'var(--green)';

  return (
    <div style={{ maxWidth: 1060, margin: '0 auto', padding: '32px 40px 80px' }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ font: '600 12px/1 var(--mono)', letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--red)' }}>AUDIT REPORT</div>
          <h1 style={{ margin: '13px 0 0', font: '800 30px/1.05 var(--display)', letterSpacing: '-.02em', color: 'var(--ink)', maxWidth: 720 }}>{dataset.title}</h1>
          <div style={{ marginTop: 11, font: '400 12.5px/1.5 var(--mono)', color: 'var(--ink-3)' }}>
            {fmt(dataset.cells)} cells · {fmt(dataset.replicates)} {dataset.replicateLabel}
            {' · '}
            <span style={{ color: 'var(--ink-4)' }}>from </span>
            <span style={{ color: 'var(--ink-2)' }}>{dataset.file}</span>
          </div>
        </div>
        <button
          data-tour="report.export"
          type="button"
          onClick={onExport}
          disabled={exporting}
          aria-busy={exporting}
          className="rl-no-print"
          aria-label="Export report as PDF"
          style={{
            flex: 'none',
            font: '700 11px/1 var(--sans)',
            letterSpacing: '.06em',
            textTransform: 'uppercase',
            color: 'var(--ink)',
            background: 'var(--panel-2)',
            border: '1px solid var(--edge-2)',
            padding: '11px 16px',
            borderRadius: 10,
            cursor: exporting ? 'progress' : 'pointer',
            opacity: exporting ? 0.6 : 1,
          }}
        >
          {exporting ? 'Generating…' : 'Export PDF'}
        </button>
      </div>

      {/* verdict band */}
      <section
        data-tour="report.band"
        aria-label="Audit summary"
        style={{
          marginTop: 24,
          display: 'flex',
          alignItems: 'center',
          gap: 26,
          flexWrap: 'wrap',
          background: `linear-gradient(180deg, color-mix(in srgb, ${bandColor} 6%, transparent), transparent), var(--panel)`,
          border: '1px solid var(--edge)',
          borderLeft: `3px solid ${bandColor}`,
          borderRadius: 12,
          padding: '22px 26px',
        }}
      >
        <div style={{ display: 'flex', gap: 26, flex: 'none' }}>
          {counts.map((t) => (
            <div key={t.label}>
              <div style={{ font: '700 30px/1 var(--mono)', color: t.n > 0 ? t.c : 'var(--ink-4)' }}>{t.n}</div>
              <div style={{ marginTop: 7, font: '400 9.5px/1.2 var(--mono)', letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>{t.label}</div>
            </div>
          ))}
        </div>
        <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--edge)', flex: 'none' }} aria-hidden />
        <p style={{ margin: 0, flex: 1, minWidth: 240, font: '500 16px/1.5 var(--sans)', color: 'var(--ink)' }}>{report.verdict}</p>
      </section>

      {/* per-check findings */}
      {report.results.length > 0 ? (
        <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {report.results.map((r) => (
            <ReportRow key={r.checkId} result={r} />
          ))}
        </div>
      ) : (
        <div
          style={{
            marginTop: 18,
            border: '1px dashed var(--edge-2)',
            borderRadius: 12,
            padding: '30px 24px',
            textAlign: 'center',
            font: '400 12.5px/1.6 var(--mono)',
            color: 'var(--ink-4)',
          }}
        >
          No checks have run yet. Confirm the design and run all {CHECK_COUNT} checks to populate this report.
        </div>
      )}

      {/* leave with the fixed pipeline, not only the critique */}
      <div style={{ marginTop: 24, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', background: 'var(--panel)', border: '1px solid var(--edge)', borderRadius: 12, padding: '18px 22px' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ font: '700 14px/1.3 var(--sans)', color: 'var(--ink)' }}>Take the corrected analysis with you.</div>
          <p style={{ margin: '5px 0 0', font: '400 12.5px/1.55 var(--sans)', color: 'var(--ink-3)' }}>
            Every flagged finding comes with a runnable script that reproduces the honest re-analysis. Download the scripts, the
            notebook, and the README.
          </p>
        </div>
        <Link
          href="/corrected"
          style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 8, font: '700 11px/1 var(--sans)', letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--surface)', background: 'var(--signal)', padding: '11px 16px', borderRadius: 10, textDecoration: 'none' }}
        >
          Corrected analysis →
        </Link>
      </div>

      {/* closing note */}
      <p style={{ margin: '18px 4px 0', font: '400 13px/1.6 var(--sans)', color: 'var(--ink-3)', maxWidth: 660 }}>
        Everything above is shown, reproducible, and cited. Each flag names the method that fixes it, the corrected code runs, and
        the preview is the output of that code. Where a claim cannot be rescued, Redline says so and shows no corrected result.
      </p>
    </div>
  );
}
