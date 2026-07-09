import { AttachField } from './AttachField';

/**
 * Intake slab 02: the optional attach points. The dataset alone already audits,
 * so both fields here are optional. They let the scientist add the analysis they
 * ran (a notebook or script) and what they concluded (claims or prose), so the
 * extracted claims read in their own words. Both are text, so they feed the model
 * directly and work in every compute mode, fixture included.
 */
export function AnalysisSlab({
  notebook,
  prose,
  onNotebook,
  onProse,
}: {
  notebook: string;
  prose: string;
  onNotebook: (t: string) => void;
  onProse: (t: string) => void;
}) {
  return (
    <div
      data-tour="intake.analysis"
      style={{ background: 'var(--panel)', border: '1px solid var(--edge)', borderRadius: 14, padding: 22 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ font: '700 11px/1 var(--mono)', color: 'var(--red)' }}>02</span>
        <span style={{ font: '700 12px/1 var(--sans)', letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink)' }}>
          Analysis
        </span>
        <span
          style={{
            marginLeft: 'auto',
            font: '600 9px/1 var(--mono)',
            letterSpacing: '.14em',
            textTransform: 'uppercase',
            color: 'var(--ink-4)',
            border: '1px solid var(--edge-2)',
            padding: '4px 7px',
            borderRadius: 5,
          }}
        >
          optional
        </span>
      </div>
      <p style={{ margin: '13px 0 16px', maxWidth: 440, font: '400 12.5px/1.55 var(--sans)', color: 'var(--ink-2)' }}>
        Redline can audit the dataset on its own. Add the analysis you ran so the claims read in your own words.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <AttachField
          label="Notebook or script"
          hint="Paste your analysis code so the claims match the tests you actually ran."
          placeholder="# de_analysis.ipynb, or a script..."
          value={notebook}
          onChange={onNotebook}
        />
        <AttachField
          label="Claims or prose"
          hint="Paste an abstract, figure captions, or a plain description of what you found."
          placeholder="e.g. IL2RA knockdown significantly upregulates FOXP3 (p < 0.001)..."
          value={prose}
          onChange={onProse}
        />
      </div>
    </div>
  );
}
