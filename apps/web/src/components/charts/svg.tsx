import { cloneElement } from 'react';
import type { Key, ReactElement, ReactNode, SVGProps } from 'react';
import { FONT } from '@redline/ui';

/**
 * Shared SVG scaffolding for the Redline figures. Ported from the design source
 * (`Redline.dc.html`) `svg()` / `txt()` helpers, typed and made React-idiomatic.
 * The charts draw with literal hex from the `C` token map and animate with the
 * `rl-*` keyframes already defined in `tokens.css`.
 */

/** Applied to every animated node so one scoped rule can freeze it at its
 *  finished state under `prefers-reduced-motion` (inline `animation` styles can
 *  only be overridden with `!important`, which is why this class exists). */
export const RL_ANIM = 'rl-anim';

/** `font:` shorthand builders that route the family through the shared FONT
 *  tokens, so the self-hosted fallbacks travel with every label. */
export const fSans = (weight: number | string, px: number): string => `${weight} ${px}px ${FONT.sans}`;
export const fMono = (weight: number | string, px: number): string => `${weight} ${px}px ${FONT.mono}`;

/** A keyed element collector. React requires a stable key on every array child;
 *  the design source pushes bare nodes, so we clone-in a running index key. */
export function keyer(): { add: (el: ReactElement) => void; els: ReactElement[] } {
  const els: ReactElement[] = [];
  let i = 0;
  return {
    els,
    add(el) {
      els.push(cloneElement(el, { key: i++ }));
    },
  };
}

const REDUCE_MOTION_CSS =
  `@media (prefers-reduced-motion: reduce){.${RL_ANIM}{animation:none!important;` +
  `stroke-dashoffset:0!important;transform:none!important;opacity:1!important;}}`;

/** The shared `<svg>` frame: fixed viewBox, fluid width, and a scoped rule that
 *  parks every rl-* animation at its resting (fully drawn) state when the viewer
 *  asked for reduced motion. */
export function Svg({
  children,
  vb = '0 0 620 360',
  label,
}: {
  children: ReactNode;
  vb?: string;
  label?: string;
}): ReactElement {
  return (
    <svg viewBox={vb} width="100%" style={{ display: 'block' }} role="img" aria-label={label}>
      <style>{REDUCE_MOTION_CSS}</style>
      {children}
    </svg>
  );
}

export type TxtOpts = Omit<SVGProps<SVGTextElement>, 'x' | 'y' | 'children'>;

/** `txt(x, y, s, opts)` → a `<text>` node, mirroring the design source helper. */
export function txt(x: number, y: number, s: ReactNode, o: TxtOpts = {}): ReactElement {
  const { key, ...rest } = o as TxtOpts & { key?: Key };
  return (
    <text key={key} x={x} y={y} {...rest}>
      {s}
    </text>
  );
}
