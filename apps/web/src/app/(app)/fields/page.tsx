'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { Confidence } from '@redline/contracts';
import { useSession } from '@/state/session';
import { FieldMatrixRow } from '@/components/fields/FieldMatrix';

/**
 * Foundation · Design resolution. The structural gate. Every downstream check
 * runs on a field's *role*, so a wrong role poisons every flag it produces.
 * Redline proposes a meaning per column; the scientist confirms or corrects it,
 * then opens the workbench. Dark audit-instrument surface. This page carries no
 * figure, so no lightbox plate appears and it stays fully dark.
 */

const CONF_COLOR: Record<Confidence, string> = {
  high: 'var(--green)',
  medium: 'var(--amber)',
  low: 'var(--red)',
};

const TALLY: { key: Confidence; label: string }[] = [
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

  const busy = pending || !hasFields;

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '34px 40px 72px' }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 28 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <span style={{ width: 7, height: 7, borderRadius: 2, background: 'var(--red)', boxShadow: '0 0 8px var(--red)' }} />
            <span
              style={{
                font: '600 11px/1 var(--mono)',
                letterSpacing: '.18em',
                textTransform: 'uppercase',
                color: 'var(--red)',
              }}
            >
              Foundation · Design resolution
            </span>
          </div>
          <h1 style={{ margin: '13px 0 0', font: '800 30px/1.05 var(--display)', letterSpacing: '-.02em', color: 'var(--ink)' }}>
            Confirm what each field means.
          </h1>
          <p style={{ margin: '11px 0 0', maxWidth: 620, font: '400 13.5px/1.55 var(--sans)', color: 'var(--ink-2)' }}>
            Every check depends on this. Redline proposes a meaning; accept it, or correct it.
          </p>
        </div>

        <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 14 }}>
          <div style={{ display: 'flex', gap: 8 }} role="group" aria-label="Confidence tally">
            {TALLY.map(({ key, label }) => {
              const on = counts[key] > 0;
              return (
                <span
                  key={key}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 7,
                    font: '600 11px/1 var(--mono)',
                    background: 'var(--panel-2)',
                    border: '1px solid var(--edge)',
                    padding: '7px 11px',
                    borderRadius: 8,
                  }}
                >
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: 7,
                      background: on ? CONF_COLOR[key] : 'var(--ink-4)',
                      boxShadow: on ? `0 0 7px ${CONF_COLOR[key]}` : 'none',
                    }}
                  />
                  <span style={{ color: 'var(--ink)' }}>{counts[key]}</span>
                  <span style={{ letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>{label}</span>
                </span>
              );
            })}
          </div>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            style={{
              font: '800 12px/1 var(--sans)',
              letterSpacing: '.06em',
              textTransform: 'uppercase',
              color: 'var(--surface)',
              background: 'var(--signal)',
              padding: '13px 20px',
              borderRadius: 10,
              border: 'none',
              cursor: busy ? 'not-allowed' : 'pointer',
              opacity: busy ? 0.5 : 1,
            }}
          >
            {pending ? 'Opening workbench…' : 'Confirm & open workbench →'}
          </button>
        </div>
      </div>

      {/* matrix */}
      {hasFields ? (
        <div style={{ marginTop: 30, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
            <span style={{ width: 6, height: 6, borderRadius: 2, background: 'var(--signal)', boxShadow: '0 0 8px var(--signal)' }} />
            <span style={{ font: '700 10px/1 var(--mono)', letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
              Design matrix · {fields!.length} fields
            </span>
          </div>
          {fields!.map((f) => (
            <FieldMatrixRow key={f.id} field={f} onRole={(role) => setRole(f.id, role)} />
          ))}
        </div>
      ) : (
        <div
          style={{
            marginTop: 30,
            background: 'var(--panel)',
            border: '1px solid var(--edge)',
            borderRadius: 12,
            padding: '30px 26px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <span style={{ width: 7, height: 7, borderRadius: 2, background: 'var(--ink-4)' }} />
            <span style={{ font: '700 10px/1 var(--mono)', letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
              No design
            </span>
          </div>
          <div style={{ marginTop: 4, font: '800 19px/1.2 var(--display)', letterSpacing: '-.01em', color: 'var(--ink)' }}>
            No design resolved yet.
          </div>
          <p style={{ margin: 0, maxWidth: 520, font: '400 13px/1.55 var(--sans)', color: 'var(--ink-3)' }}>
            Bring in a dataset from intake and Redline will propose what each field means.
          </p>
          <Link
            href="/"
            style={{
              marginTop: 10,
              display: 'inline-flex',
              alignItems: 'center',
              font: '700 11px/1 var(--sans)',
              letterSpacing: '.06em',
              textTransform: 'uppercase',
              color: 'var(--ink)',
              background: 'var(--panel-2)',
              border: '1px solid var(--edge-2)',
              padding: '11px 16px',
              borderRadius: 10,
              textDecoration: 'none',
            }}
          >
            Back to intake →
          </Link>
        </div>
      )}
    </div>
  );
}
