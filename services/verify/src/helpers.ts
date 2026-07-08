/** Field-mapping and displayed-value helpers shared by the driver. */
import type { CheckResult, FieldRole, FieldSpec } from '@redline/contracts';
import type { CaseDef } from './cases.js';

/**
 * The scientist's confirmed mapping. We force the load-bearing roles to the
 * case descriptor so the checks compute against the same design the oracle
 * uses; the model's raw proposal is judged separately for AI wiring.
 */
export function confirmFields(resolved: FieldSpec[], c: CaseDef): FieldSpec[] {
  const force: Record<string, FieldRole> = {
    [c.unit]: 'unit',
    [c.grouping]: 'grouping',
    [c.nuisance]: 'nuisance',
    [c.observation]: 'observation',
  };
  return resolved.map((f) => (force[f.id] ? { ...f, role: force[f.id]!, edited: true } : { ...f }));
}

/** The foundation probe (2B): demote the replicate unit to an observation. */
export function demoteUnit(fields: FieldSpec[], unitCol: string): FieldSpec[] {
  return fields.map((f) => (f.id === unitCol ? { ...f, role: 'observation', edited: true } : { ...f }));
}

type AnyChart = Record<string, unknown> & { kind: string };

/** Pull the load-bearing displayed numbers out of a finding, keyed by name. */
export function displayedFor(check: CheckResult): Record<string, string> {
  const chart = check.chart as AnyChart;
  const out: Record<string, string> = { state: check.state };
  const g = (o: unknown, k: string): unknown => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined);
  switch (chart.kind) {
    case 'significance': {
      const naive = g(chart, 'naive');
      const honest = g(chart, 'honest');
      out.naiveP = String(g(naive, 'p'));
      out.honestP = String(g(honest, 'p'));
      out.n = String(g(honest, 'n'));
      out.naiveSig = String(g(naive, 'sig'));
      out.honestSig = String(g(honest, 'sig'));
      out.badUnit = String(g(chart, 'badUnit'));
      break;
    }
    case 'groups': {
      const disc = g(chart, 'discAUC');
      const hold = g(chart, 'holdAUC');
      if (disc !== undefined) out.discAUC = String(disc);
      if (hold !== undefined) out.holdAUC = String(hold);
      const markers = g(chart, 'markers');
      out.markers = String(Array.isArray(markers) ? markers.length : 0);
      break;
    }
    case 'fragility': {
      out.stability = String(g(chart, 'stability'));
      const present = g(chart, 'present');
      if (Array.isArray(present)) {
        out.presentMin = String(present[0]);
        out.presentMax = String(present[1]);
      }
      const steps = g(chart, 'steps');
      out.steps = String(Array.isArray(steps) ? steps.length : 0);
      break;
    }
    case 'confound': {
      const v = g(chart, 'cramersV');
      if (v != null) out.cramersV = String(v);
      out.verified = String(g(chart, 'verified'));
      break;
    }
    case 'hardstop': {
      out.units = String(g(chart, 'units'));
      out.perGroup = String(g(chart, 'perGroup'));
      break;
    }
  }
  return out;
}

/** Does a rewritten conclusion carry a case-specific number (not a bare template)? */
export function carriesNumber(text: string | null | undefined): boolean {
  if (!text) return false;
  return /\d/.test(text) && /\d\.\d|\bp\s*=|\bAUC\b|donor|patient|=\s*\d|10\D?\d/i.test(text);
}
