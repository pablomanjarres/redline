/** Raw data the driver captures per check, before the comparator grades it. */
export interface Provenance {
  target?: string;
  engine?: string;
  ran?: string;
  nonce?: string;
  elapsedMs?: number;
}

export interface CheckProbe {
  checkId: number;
  ok: boolean;
  error?: string;
  displayed: Record<string, string>;
  provenance?: Provenance;
  reasoningSource?: string;
  correctedText?: string | null;
  // liveness: a live knob was moved off its default; the relevant number should move
  livenessKnob?: string;
  livenessBefore?: string;
  livenessAfter?: string;
  livenessChanged?: boolean;
  rerunNonce?: string; // provenance nonce from the second (perturbed) call
  // check 3 runs twice: the spurious group is the default `displayed`, the stable one here
  stableDisplayed?: Record<string, string>;
  // check 1 foundation probe (2B): demote the replicate unit and re-run
  twoB?: { before: string; after: string; changed: boolean } | null;
}

export interface CaseProbe {
  caseId: string;
  scenarioId: string;
  label: string;
  fieldsSource?: string;
  fieldRoles: Record<string, string>; // the model-proposed roles, for the adapts-across-cases check
  checks: CheckProbe[];
  error?: string;
}
