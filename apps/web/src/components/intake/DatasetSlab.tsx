'use client';

import { useState } from 'react';
import type { DatasetMeta } from '@redline/contracts';
import { fmt } from '@/lib/format';

/**
 * Intake slab 01: the dataset, the one required input. The scientist brings an
 * .h5ad.
 *
 * The demo runs a locked fixture, so the dataset is already loaded and there is
 * nothing to upload. Inspecting a real HDF5 file needs the Python engine, so the
 * file picker appears only when a compute target is connected; the scenario
 * picker in the top strip is the way in for the fixture demo.
 */
export function DatasetSlab({
  dataset,
  computeTargetAvailable,
}: {
  dataset: DatasetMeta;
  computeTargetAvailable: boolean;
}) {
  const [pickedName, setPickedName] = useState<string | null>(null);
  const [uploadFocused, setUploadFocused] = useState(false);

  const stats = [
    { v: fmt(dataset.cells), l: 'cells' },
    { v: fmt(dataset.genes), l: 'genes' },
    { v: `${dataset.replicates}`, l: dataset.replicateLabel },
    { v: `${dataset.fieldCount}`, l: 'fields' },
  ];

  return (
    <div
      data-tour="intake.dataset"
      style={{ background: 'var(--panel)', border: '1px solid var(--edge)', borderRadius: 14, padding: 22 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ font: '700 11px/1 var(--mono)', color: 'var(--red)' }}>01</span>
        <span style={{ font: '700 12px/1 var(--sans)', letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink)' }}>
          Dataset
        </span>
        <span
          style={{
            marginLeft: 'auto',
            font: '600 9px/1 var(--mono)',
            letterSpacing: '.14em',
            textTransform: 'uppercase',
            color: 'var(--red)',
            background: 'var(--red-soft)',
            border: '1px solid var(--red-line)',
            padding: '4px 7px',
            borderRadius: 5,
          }}
        >
          required
        </span>
      </div>

      {/* the file card */}
      <div
        style={{
          marginTop: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          background: 'var(--panel-2)',
          border: '1px solid var(--edge)',
          borderRadius: 10,
          padding: '13px 14px',
        }}
      >
        <span
          aria-hidden
          style={{
            width: 34,
            height: 34,
            flex: 'none',
            borderRadius: 7,
            background: 'var(--void)',
            border: '1px solid var(--edge-2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            font: '600 9px/1 var(--mono)',
            color: 'var(--signal)',
          }}
        >
          h5ad
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ font: '500 12.5px/1.2 var(--mono)', color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {pickedName ?? dataset.file}
          </div>
          <div style={{ marginTop: 3, font: '400 11px/1 var(--mono)', color: 'var(--ink-4)' }}>
            {pickedName ? 'selected' : `${dataset.sizeGB} GB · loaded`}
          </div>
        </div>
        {computeTargetAvailable ? (
          <div style={{ marginLeft: 'auto' }}>
            {/* A real, connected compute target: a live file picker. The label
                carries the accessible name for the visually hidden (but focusable)
                input, and the whole control rings on keyboard focus. */}
            <label
              data-tour="intake.upload"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                font: '600 11px/1 var(--sans)',
                color: 'var(--surface)',
                background: 'var(--signal)',
                padding: '9px 13px',
                borderRadius: 8,
                cursor: 'pointer',
                boxShadow: uploadFocused ? '0 0 0 3px var(--signal-soft)' : 'none',
              }}
            >
              Upload .h5ad
              <input
                type="file"
                accept=".h5ad,.h5"
                onChange={(e) => setPickedName(e.target.files?.[0]?.name ?? null)}
                onFocus={() => setUploadFocused(true)}
                onBlur={() => setUploadFocused(false)}
                style={{
                  position: 'absolute',
                  width: 1,
                  height: 1,
                  padding: 0,
                  margin: -1,
                  overflow: 'hidden',
                  clip: 'rect(0 0 0 0)',
                  whiteSpace: 'nowrap',
                  border: 0,
                }}
              />
            </label>
          </div>
        ) : null}
      </div>

      {/* the fixture is already loaded; the way in is the scenario picker up top */}
      {!computeTargetAvailable ? (
        <p style={{ margin: '10px 0 0', font: '400 11.5px/1.5 var(--sans)', color: 'var(--ink-4)' }}>
          The demo runs a locked fixture dataset, already loaded. Pick a scenario in the top strip to run the audit now.
        </p>
      ) : null}

      {/* dataset stats */}
      <div style={{ marginTop: 16, display: 'flex', flexWrap: 'wrap', gap: '14px 26px' }}>
        {stats.map((s) => (
          <div key={s.l}>
            <div style={{ font: '700 20px/1 var(--mono)', color: 'var(--ink)' }}>{s.v}</div>
            <div style={{ marginTop: 5, font: '400 9.5px/1 var(--mono)', letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
              {s.l}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
