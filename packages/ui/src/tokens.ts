import type { CheckState } from '@redline/contracts';

/**
 * The chart palette as raw hex. The figures render on the bright lightbox plate
 * (not the dark chrome), so these are dark-on-white: slate ink, recessive cool
 * gridlines, one clean red for the finding, one blue for the operator's scrub.
 * Kept in lockstep with the `--plate-*` tokens in tokens.css.
 */
export const C = {
  desk: '#FFFFFF',
  frame: '#F7F9FC',
  panel: '#FFFFFF',
  panel2: '#F1F4F8',
  panel3: '#E9EDF3',
  ink: '#10131A',
  ink2: '#44506A',
  ink3: '#6A7688',
  ink4: '#9AA6B8',
  line: '#E6EAF0',
  line2: '#D3DBE5',
  grid: '#EEF1F6',
  red: '#E5484D',
  redDeep: '#C22A3A',
  pass: '#12925E',
  amber: '#B45309',
  stop: '#1E293B',
  accent: '#2563EB',
  accentSoft: '#EEF2FE',
} as const;

export const FONT = {
  sans: "'Archivo', system-ui, -apple-system, sans-serif",
  mono: "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace",
  serif: "'Archivo', system-ui, sans-serif",
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

/** Signal colors for the chrome (verdict lights, badges on the surface). */
export function signalColor(state: CheckState | 'ready' | 'running'): string {
  switch (state) {
    case 'flagged':
      return '#E5484D';
    case 'clean':
      return '#12925E';
    case 'flag_only':
      return '#B45309';
    case 'hard_stop':
      return '#1E293B';
    case 'running':
      return '#2563EB';
    default:
      return '#97A2B4';
  }
}
