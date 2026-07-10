'use client';

import type { Recommendation } from '@redline/contracts';
import { feasibilityColor, feasibilityLabel } from '@redline/ui';

/**
 * What to do about a finding. Each row states the action to take, why (tied to
 * this finding's numbers), what it would change, and a feasibility tag. The tag
 * color is the shared token: fixable now is green, needs new data is amber, and
 * an unsalvageable claim is the editorial red, carrying the same weight as a
 * flag. An unsalvageable row reads as a dead end. It never sits beside a
 * corrected-result claim, because the feasibility is decided by the engine, not
 * the model, and the before/after preview refuses an "after" when there is no
 * valid fix. Renders nothing when there are no recommendations.
 */
export function Recommendations({ items }: { items?: Recommendation[] }) {
  if (!items || items.length === 0) return null;

  return (
    <section
      data-tour="check.recommend"
      aria-label="What to do about this finding"
      style={{ marginTop: 18, background: 'var(--panel)', border: '1px solid var(--edge)', borderRadius: 12, overflow: 'hidden' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '13px 16px', borderBottom: '1px solid var(--edge)' }}>
        <span style={{ width: 6, height: 6, borderRadius: 2, background: 'var(--signal)', boxShadow: '0 0 8px var(--signal)', flex: 'none' }} />
        <span style={{ font: '700 10px/1 var(--mono)', letterSpacing: '.18em', color: 'var(--ink)' }}>WHAT TO DO</span>
      </div>
      <ol style={{ margin: 0, padding: 0, listStyle: 'none' }}>
        {items.map((r, i) => {
          const c = feasibilityColor(r.feasibility);
          const dead = r.feasibility === 'unsalvageable';
          return (
            <li
              key={i}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                padding: '16px',
                borderTop: i === 0 ? 'none' : '1px solid var(--edge)',
                borderLeft: `3px solid ${c}`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                <span style={{ flex: 1, minWidth: 220, font: '600 14.5px/1.4 var(--sans)', color: dead ? 'var(--red-deep)' : 'var(--ink)' }}>
                  {r.action}
                </span>
                <span
                  style={{
                    flex: 'none',
                    font: '700 9px/1 var(--sans)',
                    letterSpacing: '.08em',
                    textTransform: 'uppercase',
                    color: c,
                    border: `1px solid ${c}`,
                    background: `color-mix(in srgb, ${c} 12%, transparent)`,
                    padding: '6px 9px',
                    borderRadius: 7,
                  }}
                >
                  {feasibilityLabel(r.feasibility)}
                </span>
              </div>
              <p style={{ margin: 0, font: '400 12.5px/1.55 var(--sans)', color: 'var(--ink-3)' }}>{r.rationale}</p>
              <p style={{ margin: 0, font: '400 12.5px/1.55 var(--sans)', color: 'var(--ink-2)' }}>
                <span style={{ font: '600 9px/1 var(--mono)', letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink-4)', marginRight: 8 }}>
                  Changes
                </span>
                {r.changes}
              </p>
              {r.citation && (
                <div style={{ font: '500 11.5px/1.4 var(--mono)', color: 'var(--ink-3)' }}>
                  {r.citation.url ? (
                    <a href={r.citation.url} target="_blank" rel="noreferrer" style={{ color: 'var(--signal)' }}>
                      {r.citation.authors} ({r.citation.year}) · {r.citation.venue}
                    </a>
                  ) : (
                    <>
                      {r.citation.authors} ({r.citation.year}) · {r.citation.venue}
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
