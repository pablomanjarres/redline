import type { CheckState } from '@redline/contracts';

/**
 * The palette as raw hex - the SVG chart components draw with literal colors
 * (SVG fill/stroke can't reliably read CSS custom properties across renderers,
 * and the report must print correctly). Keep in lockstep with tokens.css.
 * "clinical precision": cool slate ink, one indigo for interaction, one clean
 * red for findings.
 */
export const C = {
  desk: '#F4F6F9',
  frame: '#FAFBFD',
  panel: '#FFFFFF',
  panel2: '#F1F4F8',
  panel3: '#E8EDF4',
  ink: '#0F1729',
  ink2: '#46536B',
  ink3: '#6B7789',
  ink4: '#9AA6B8',
  line: '#E7ECF2',
  line2: '#D5DCE6',
  grid: '#EDF1F6',
  red: '#E5484D',
  redDeep: '#C22A3A',
  pass: '#12925E',
  amber: '#B45309',
  stop: '#1E293B',
  accent: '#4F46E5',
  accentSoft: '#EEF0FE',
} as const;

export const FONT = {
  sans: "'Inter', system-ui, -apple-system, sans-serif",
  mono: "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace",
  serif: "'Inter', system-ui, sans-serif",
} as const;

/** Verdict -> the color that represents it, including UI-transient states. */
export function stateColor(state: CheckState | 'ready' | 'running'): string {
  switch (state) {
    case 'flagged':
      return C.red;
    case 'clean':
      return C.pass;
    case 'flag_only':
      return C.amber;
    case 'hard_stop':
      return C.stop;
    case 'running':
      return C.accent;
    default:
      return C.ink4;
  }
}

/** Verdict -> the human label shown on badges. */
export function stateLabel(state: CheckState | 'ready' | 'running'): string {
  switch (state) {
    case 'flagged':
      return 'Flagged';
    case 'clean':
      return 'Verified';
    case 'flag_only':
      return 'Could not verify';
    case 'hard_stop':
      return 'Hard stop';
    case 'running':
      return 'Running…';
    default:
      return 'Not run';
  }
}
