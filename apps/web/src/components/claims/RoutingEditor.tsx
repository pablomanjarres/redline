'use client';

import type { CheckId, CheckRoute } from '@redline/contracts';
import { CHECK_IDS, CHECK_NAMES } from './shared';

/**
 * Edit which of the four checks test a claim (spec section 6). Each check is a
 * toggle shown by its real name. Turning one on adds a route with empty params,
 * so the workbench runs it on the resolved-field defaults; turning it off drops
 * that route while keeping the params of the others. The user reads plain checks,
 * never the four error types by name (spec section 7).
 */
export function RoutingEditor({
  routes,
  onChange,
  tourId,
}: {
  routes: CheckRoute[];
  onChange: (checks: CheckRoute[]) => void;
  tourId?: string;
}) {
  const active = new Set(routes.map((r) => r.check));
  const toggle = (id: CheckId) => {
    if (active.has(id)) onChange(routes.filter((r) => r.check !== id));
    else onChange([...routes, { check: id, params: {} }]);
  };

  return (
    <div
      data-tour={tourId}
      role="group"
      aria-label="Which checks test this claim"
      style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}
    >
      {CHECK_IDS.map((id) => {
        const on = active.has(id);
        return (
          <button
            key={id}
            type="button"
            aria-pressed={on}
            aria-label={`${on ? 'Remove' : 'Add'} check 0${id} ${CHECK_NAMES[id]}`}
            onClick={() => toggle(id)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              font: '600 10px/1 var(--mono)',
              letterSpacing: '.04em',
              cursor: 'pointer',
              padding: '7px 10px',
              borderRadius: 7,
              border: `1px solid ${on ? 'var(--signal)' : 'var(--edge-2)'}`,
              background: on ? 'var(--signal-soft)' : 'var(--panel)',
              color: on ? 'var(--signal)' : 'var(--ink-3)',
            }}
          >
            <span style={{ width: 7, height: 7, flex: 'none', borderRadius: 7, background: on ? 'var(--signal)' : 'var(--ink-4)' }} />
            <span>0{id}</span>
            <span>{CHECK_NAMES[id]}</span>
          </button>
        );
      })}
    </div>
  );
}
