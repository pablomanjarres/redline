'use client';

import { useTour } from '@/state/tour';

/**
 * The way back into the tour once it has been dismissed. Sits in the intake
 * strip and in the masthead, so a reader who lands mid-audit and does not know
 * what they are looking at is one click from an explanation.
 */
export function TourLauncher({ compact = false }: { compact?: boolean }) {
  const { active, start } = useTour();
  if (active) return null;

  return (
    <button
      type="button"
      onClick={() => start('guided')}
      aria-label="Start the guided tour"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        flex: 'none',
        font: '700 10px/1 var(--sans)',
        letterSpacing: '.1em',
        textTransform: 'uppercase',
        color: 'var(--red)',
        background: 'var(--red-soft)',
        border: '1px solid var(--red-line)',
        padding: compact ? '8px 11px' : '9px 13px',
        borderRadius: 8,
        cursor: 'pointer',
      }}
    >
      <span
        aria-hidden
        style={{ width: 6, height: 6, borderRadius: 6, background: 'var(--red)', boxShadow: '0 0 7px var(--red)' }}
      />
      {compact ? 'Tour' : 'Guided tour'}
    </button>
  );
}
