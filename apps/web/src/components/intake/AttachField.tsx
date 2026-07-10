'use client';

import { useId, useRef, useState } from 'react';
import { fmt } from '@/lib/format';
import { MAX_ANALYSIS_FILE_BYTES, readAnalysisText } from '@/lib/read-analysis-file';

/**
 * One optional attach point on Intake: a labeled textarea the scientist can
 * paste text into, or fill by uploading a file (a notebook or script, or claims
 * / prose). It is text, so it feeds the extraction model directly and needs no
 * compute, which is why paste and upload both work in every mode, fixture
 * included. Pass `accept` to show the upload control.
 *
 * Accessibility: a real <label> is bound to the field by id, the hint reaches
 * the field through aria-describedby, and the character count is live. The focus
 * ring is the interaction blue, matching the inputs in tokens.css (which ring on
 * :focus, so both a mouse and a keyboard focus show it).
 */
export function AttachField({
  label,
  hint,
  placeholder,
  value,
  onChange,
  rows = 4,
  accept,
  maxChars = 200_000,
}: {
  label: string;
  hint: string;
  placeholder: string;
  value: string;
  onChange: (text: string) => void;
  rows?: number;
  /** When set, an Upload control reads a picked file's text into the field. */
  accept?: string;
  /** Clamp uploaded text to the field's contract cap so the request never 413s. */
  maxChars?: number;
}) {
  const fieldId = useId();
  const hintId = `${fieldId}-hint`;
  const [focused, setFocused] = useState(false);
  const [uploadName, setUploadName] = useState<string | null>(null);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const count = value.length;

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_ANALYSIS_FILE_BYTES) {
      setUploadErr('That file is too large. Paste the relevant part instead.');
      setUploadName(null);
    } else {
      try {
        onChange(await readAnalysisText(file, maxChars));
        setUploadName(file.name);
        setUploadErr(null);
      } catch {
        setUploadErr('Could not read that file. Paste the text instead.');
        setUploadName(null);
      }
    }
    if (inputRef.current) inputRef.current.value = ''; // let the same file be re-picked
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
        <label
          htmlFor={fieldId}
          style={{
            font: '600 10.5px/1 var(--mono)',
            letterSpacing: '.1em',
            textTransform: 'uppercase',
            color: 'var(--ink-3)',
          }}
        >
          {label}
        </label>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          {accept ? (
            <>
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                style={{
                  font: '600 10px/1 var(--mono)',
                  letterSpacing: '.06em',
                  textTransform: 'uppercase',
                  color: 'var(--signal)',
                  background: 'transparent',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                }}
              >
                Upload
              </button>
              <input
                ref={inputRef}
                type="file"
                accept={accept}
                aria-label={`Upload a file for ${label}`}
                onChange={(e) => onFile(e.target.files?.[0])}
                style={{ display: 'none' }}
              />
            </>
          ) : null}
          <span style={{ font: '400 10px/1 var(--mono)', color: 'var(--ink-4)' }}>
            {count === 0 ? 'optional' : `${fmt(count)} characters`}
          </span>
        </div>
      </div>
      <textarea
        id={fieldId}
        aria-describedby={hintId}
        placeholder={placeholder}
        value={value}
        rows={rows}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className="rl-scroll"
        style={{
          resize: 'vertical',
          width: '100%',
          minHeight: 84,
          font: '400 12.5px/1.55 var(--mono)',
          color: 'var(--ink)',
          background: 'var(--void)',
          border: `1px solid ${focused ? 'var(--signal)' : 'var(--edge-2)'}`,
          borderRadius: 9,
          padding: '11px 12px',
          outline: 'none',
          boxShadow: focused ? '0 0 0 3px var(--signal-soft)' : 'none',
          transition: 'border-color .12s ease, box-shadow .12s ease',
        }}
      />
      <p id={hintId} style={{ margin: 0, font: '400 11.5px/1.5 var(--sans)', color: 'var(--ink-4)' }}>
        {hint}
      </p>
      {uploadName ? (
        <p style={{ margin: 0, font: '400 11px/1.5 var(--mono)', color: 'var(--ink-4)' }}>Loaded {uploadName}</p>
      ) : null}
      {uploadErr ? (
        <p role="alert" style={{ margin: 0, font: '400 11px/1.5 var(--sans)', color: 'var(--red)' }}>
          {uploadErr}
        </p>
      ) : null}
    </div>
  );
}
