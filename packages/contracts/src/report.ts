import { z } from 'zod';
import { CheckResult } from './checks.js';
import { DatasetMeta } from './dataset.js';

/** The assembled audit — the printable report across all four checks. */
export const AuditReport = z.object({
  dataset: DatasetMeta,
  results: z.array(CheckResult),
  flagged: z.number().int(),
  clean: z.number().int(),
  needInput: z.number().int(),
  verdict: z.string(),
});
export type AuditReport = z.infer<typeof AuditReport>;
