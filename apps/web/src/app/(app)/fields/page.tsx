'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Kicker } from '@redline/ui';
import type { Confidence, FieldRole } from '@redline/contracts';
import { useSession } from '@/state/session';
import { FieldRow } from '@/components/fields/FieldRow';

/**
 * Foundation, field resolution. Every check depends on getting each column's
 * meaning right, so this is a structural gate, not a convenience. Redline
 * proposes a role and its reasoning; the scientist accepts or corrects it. Low
 * confidence rows carry an amber rail. Renders inside the app shell (topbar +
 * sidebar) provided by the (app) layout. Pixel-faithful to the fields block in
 * Redline.dc.html.
 */

const CONF_SUMMARY: { key: Confidence; label: string }[] = [
  { key: 'high', label: 'High' },
  { key: 'medium', label: 'Med' },
  { key: 'low', label: 'Low' },
];

export default function FieldsPage() {
  const { fields, setRole, confirmFields } = useSession();
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const hasFields = !!fields && fields.length > 0;

  const counts: Record<Confidence, number> = { high: 0, medium: 0, low: 0 };
  for (const f of fields ?? []) counts[f.confidence]++;

  async function onConfirm() {
    if (pending || !hasFields) return;
    setPending(true);
    try {
      await confirmFields();
      router.push('/workbench');
    } finally {
      setPending(false);
    }
  }

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '40px 48px 64px' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 24,
        }}
      >
        <div>
          <Kicker>Foundation · Field resolution</Kicker>
          <h1
            style={{
              margin: '12px 0 0',
              font: '500 27px/1.15 var(--serif)',
              letterSpacing: '-.01em',
              color: 'var(--ink)',
            }}
          >
            Confirm what each field means.
          </h1>
          <p
            style={{
              margin: '9px 0 0',
              maxWidth: 560,
              font: '400 14.5px/1.5 var(--sans)',
              color: 'var(--ink2)',
            }}
          >
            Every check depends on this. Redline proposes a meaning and its reasoning; accept it, or
            correct it. The independent unit is the one that matters most.
          </p>
        </div>

        <div style={{ flex: 'none', textAlign: 'right' }}>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            {CONF_SUMMARY.map(({ key, label }) => (
              <span
                key={key}
                style={{
                  font: '500 11px/1 var(--mono)',
                  color: key === 'low' ? 'var(--amber)' : 'var(--ink3)',
                  background: 'var(--panel2)',
                  border: '1px solid var(--line2)',
                  padding: '6px 9px',
                  borderRadius: 16,
                }}
              >
                {counts[key]} {label}
              </span>
            ))}
          </div>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending || !hasFields}
            style={{
              marginTop: 14,
              font: '600 13.5px/1 var(--sans)',
              color: '#fff',
              background: 'var(--accent)',
              padding: '13px 20px',
              borderRadius: 9,
              border: 'none',
              cursor: pending || !hasFields ? 'default' : 'pointer',
              opacity: pending || !hasFields ? 0.6 : 1,
            }}
          >
            {pending ? 'Opening workbench' : 'Confirm & open workbench →'}
          </button>
        </div>
      </div>

      {hasFields ? (
        <div style={{ marginTop: 30, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {fields.map((f) => (
            <FieldRow key={f.id} field={f} onRoleChange={(role: FieldRole) => setRole(f.id, role)} />
          ))}
        </div>
      ) : (
        <div
          style={{
            marginTop: 30,
            background: 'var(--panel)',
            border: '1px solid var(--line2)',
            borderRadius: 11,
            padding: '28px 24px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: 14,
          }}
        >
          <div style={{ font: '400 14px/1.5 var(--sans)', color: 'var(--ink2)', maxWidth: 560 }}>
            No fields resolved yet. Bring in a dataset from intake and Redline will propose what each
            field means.
          </div>
          <button
            type="button"
            onClick={() => router.push('/')}
            style={{
              font: '600 12.5px/1 var(--sans)',
              color: '#fff',
              background: 'var(--accent)',
              padding: '11px 16px',
              borderRadius: 9,
              border: 'none',
              cursor: 'pointer',
            }}
          >
            Back to intake →
          </button>
        </div>
      )}
    </div>
  );
}
