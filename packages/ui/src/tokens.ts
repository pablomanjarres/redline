import type { CheckState } from '@redline/contracts';

/**
 * The palette as raw hex — the SVG chart components draw with literal colors
 * (SVG `fill`/`stroke` can't read CSS custom properties reliably across all
 * renderers, and the report must print correctly). Keep in lockstep with
 * tokens.css.
 */
export const C = {
  desk: '#EAE6DD',
  frame: '#FBFAF6',
  panel: '#FFFFFF',
  panel2: '#F5F3EC',
  panel3: '#EFEDE4',
  ink: '#1B1A17',
  ink2: '#57544C',
  ink3: '#8C887D',
  ink4: '#B4AFA3',
  line: '#E7E3D9',
  line2: '#D8D3C6',
  red: '#CE2A1E',
  redDeep: '#A81F16',
  pass: '#2E7D5B',
  amber: '#A9741A',
  stop: '#241B1A',
  accent: '#2B5FB0',
} as const;

export const FONT = {
  sans: "'IBM Plex Sans', system-ui, sans-serif",
  mono: "'IBM Plex Mono', ui-monospace, Menlo, monospace",
  serif: "'Source Serif 4', Georgia, serif",
} as const;

/** Verdict → the color that represents it, including UI-transient states. */
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

/** Verdict → the human label shown on badges. */
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
