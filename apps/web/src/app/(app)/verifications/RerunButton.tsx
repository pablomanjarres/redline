'use client';

import { useState } from 'react';

/**
 * Fires the self-verification harness. POSTs to /api/verify/run, which spawns
 * the harness detached and returns immediately. The button shows a pending
 * state, then a plain instruction that the run is in progress. It does not wait
 * for the harness to finish (that takes minutes); the operator refreshes the
 * page to pick up the new verdict once the reporter overwrites latest-run.json.
 */
type Status = 'idle' | 'pending' | 'started' | 'error';

export function RerunButton() {
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');

  async function run() {
    if (status === 'pending') return;
    setStatus('pending');
    setMessage('');
    try {
      const res = await fetch('/api/verify/run', { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as { started?: boolean; error?: string; at?: string };
      if (!res.ok || !body.started) {
        setStatus('error');
        setMessage(body.error ? `Could not start the harness. ${body.error}` : 'Could not start the harness.');
        return;
      }
      setStatus('started');
      setMessage('Harness started. The run takes a few minutes. Refresh this page when it finishes to see the new verdict.');
    } catch {
      setStatus('error');
      setMessage('Could not reach the run endpoint. Check that the app has a Node runtime.');
    }
  }

  const pending = status === 'pending';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 9, minWidth: 0 }}>
      <button
        type="button"
        onClick={run}
        disabled={pending}
        aria-busy={pending}
        aria-label="Re-run the verification harness"
        className="rl-focusable"
        style={{
          flex: 'none',
          font: '700 11px/1 var(--sans)',
          letterSpacing: '.06em',
          textTransform: 'uppercase',
          color: 'var(--ink)',
          background: 'var(--panel-2)',
          border: '1px solid var(--edge-2)',
          padding: '11px 16px',
          borderRadius: 10,
          cursor: pending ? 'progress' : 'pointer',
          opacity: pending ? 0.6 : 1,
        }}
      >
        {pending ? 'Starting…' : 'Re-run harness'}
      </button>
      <p
        role="status"
        aria-live="polite"
        style={{
          margin: 0,
          maxWidth: 320,
          textAlign: 'right',
          font: '400 11.5px/1.55 var(--mono)',
          color: status === 'error' ? 'var(--red)' : 'var(--ink-3)',
        }}
      >
        {message}
      </p>
      <style>{`.rl-focusable:focus-visible { outline: 2px solid var(--signal); outline-offset: 2px; }`}</style>
    </div>
  );
}
