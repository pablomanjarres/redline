import type {
  AuditReport,
  CheckResult,
  CorrectedBundle,
  CorrectedScript,
  DatasetMeta,
  Recommendation,
} from '@redline/contracts';
import { checkMeta } from '@redline/contracts';

/**
 * The corrected-analysis bundle: the artifact that outlasts the demo week. It
 * collects, for every finding that has a fix, the runnable script, a README, and
 * a consolidated notebook.
 *
 * The honesty rule holds here too. Clean findings are skipped (nothing to
 * correct). An unsalvageable finding gets a notebook cell that says the design
 * cannot be rescued from this data and what would be needed, and NO code cell
 * claiming a fix. Its non-separability proof script is still included, because
 * proving the dead end is honest; inventing a corrected number is not.
 */
export function buildBundle(report: AuditReport, dataset: DatasetMeta): CorrectedBundle {
  const findings = report.results.filter((r) => r.state !== 'clean');
  const scripts = collectScripts(findings);
  return {
    readme: buildReadme(report, dataset, findings),
    notebook: buildNotebook(report, dataset, findings),
    scripts,
  };
}

function isUnsalvageable(r: CheckResult): boolean {
  return r.preview?.unsalvageable === true;
}

/** One script per finding that carries corrected code (flagged findings do). */
function collectScripts(findings: CheckResult[]): CorrectedScript[] {
  const out: CorrectedScript[] = [];
  for (const r of findings) {
    if (!r.correctedCode) continue;
    out.push({
      checkId: r.checkId,
      title: checkMeta(r.checkId).name,
      filename: r.correctedCode.filename,
      code: r.correctedCode.inline,
    });
  }
  return out;
}

function firstNeedsData(recs: Recommendation[] | undefined): Recommendation | undefined {
  return recs?.find((x) => x.feasibility === 'needs_new_data' || x.feasibility === 'unsalvageable');
}

function buildReadme(report: AuditReport, dataset: DatasetMeta, findings: CheckResult[]): string {
  const lines: string[] = [];
  lines.push('# Redline corrected analysis');
  lines.push('');
  lines.push(`Dataset: ${dataset.title}`);
  lines.push(`File: ${dataset.file}`);
  lines.push('');
  lines.push(report.verdict);
  lines.push('');
  if (findings.length === 0) {
    lines.push('Every check passed clean. There is nothing to correct.');
    return lines.join('\n');
  }
  lines.push('Each script below re-runs one finding the honest way. Every script');
  lines.push('takes --h5ad PATH and prints its result as a REDLINE_RESULT line, so');
  lines.push('the numbers are reproducible from your own data.');
  lines.push('');
  for (const r of findings) {
    const meta = checkMeta(r.checkId);
    lines.push(`## Check ${r.checkId}: ${meta.name}`);
    if (r.error) lines.push(`Problem: ${r.error}.`);
    if (isUnsalvageable(r)) {
      lines.push('This finding is unsalvageable. There is no valid fix on this data,');
      lines.push('so no corrected result is provided.');
      const needs = firstNeedsData(r.recommendations);
      if (needs) lines.push(`What would be needed: ${needs.action}`);
    } else if (r.correctedCode) {
      lines.push(`Corrected: ${r.corrected}`);
      lines.push(`Run: ${r.correctedCode.entrypoint}`);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd() + '\n';
}

// ── Notebook (nbformat 4) ────────────────────────────────────────────────────

interface NbCell {
  cell_type: 'markdown' | 'code';
  metadata: Record<string, never>;
  source: string[];
  execution_count?: null;
  outputs?: never[];
}

function toSource(text: string): string[] {
  const lines = text.split('\n');
  return lines.map((l, i) => (i < lines.length - 1 ? l + '\n' : l));
}

function mdCell(text: string): NbCell {
  return { cell_type: 'markdown', metadata: {}, source: toSource(text) };
}

function codeCell(text: string): NbCell {
  return { cell_type: 'code', metadata: {}, execution_count: null, outputs: [], source: toSource(text) };
}

function findingMarkdown(r: CheckResult): string {
  const meta = checkMeta(r.checkId);
  const parts: string[] = [`## Check ${r.checkId}: ${meta.name}`, ''];
  if (r.error) parts.push(`Problem: ${r.error}.`, '');
  if (isUnsalvageable(r)) {
    parts.push('This design cannot be rescued from this data. There is no valid fix,');
    parts.push('so this notebook carries no corrected code for it.');
    const needs = firstNeedsData(r.recommendations);
    if (needs) parts.push('', `What would be needed: ${needs.action}`);
  } else {
    parts.push(`Corrected: ${r.corrected}`);
  }
  return parts.join('\n');
}

function buildNotebook(report: AuditReport, dataset: DatasetMeta, findings: CheckResult[]): string {
  const cells: NbCell[] = [
    mdCell(
      [
        '# Redline corrected analysis',
        '',
        `Dataset: ${dataset.title} (${dataset.file})`,
        '',
        report.verdict,
      ].join('\n'),
    ),
  ];
  for (const r of findings) {
    cells.push(mdCell(findingMarkdown(r)));
    // No code cell for an unsalvageable finding: there is no fix to run.
    if (!isUnsalvageable(r) && r.correctedCode) {
      cells.push(codeCell(r.correctedCode.inline));
    }
  }
  const nb = {
    cells,
    metadata: {
      kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' },
      language_info: { name: 'python' },
    },
    nbformat: 4,
    // nbformat_minor 4, not 5: the 4.5 schema makes a per-cell `id` mandatory,
    // and these cells carry none, so a 4.5 notebook fails nbformat.validate with
    // one "'id' is a required property" per cell (a future nbformat makes that a
    // hard error). The cells use no 4.5-only feature, so 4.4 is the honest,
    // valid version to declare.
    nbformat_minor: 4,
  };
  return JSON.stringify(nb, null, 1);
}
