import { z } from 'zod';
import { Dtype } from './primitives.js';

/**
 * The thin inspection output (spec section 3). This is what `services/rigor`
 * can read from an AnnData `.h5ad` WITHOUT loading the expression matrix: the
 * `obs` columns and their types, the `uns` contents (stored results), the
 * cluster label fields, and whether raw counts are present. It is not a parser;
 * it is the raw material the extraction agent reads the way a person would.
 */

/** One `obs` column, summarized for the extraction agent. */
export const ObsColumn = z.object({
  name: z.string(),
  dtype: Dtype,
  /** Cardinality for categoricals; null for numeric columns. */
  levels: z.number().int().nullable(),
  missing: z.number().int().nonnegative(),
  /** A few example values, for legibility. */
  sample: z.array(z.string()),
});
export type ObsColumn = z.infer<typeof ObsColumn>;

/** What kind of stored result an `uns` entry holds, as the inspector reads it. */
export const UnsEntryKind = z.enum(['de_result', 'marker_table', 'unknown']);
export type UnsEntryKind = z.infer<typeof UnsEntryKind>;

/**
 * One stored result under `uns` (a stored DE result, a marker table per
 * cluster, or something the inspector cannot classify). `genes` is the union of
 * gene identifiers appearing in that stored result (capped, for example at 200).
 * That gene union is what lets the honesty backstop reject a claim about a gene
 * the data never mentions.
 */
export const UnsEntry = z.object({
  key: z.string(),
  kind: UnsEntryKind,
  /** A short human description of the stored shape, for example "3200 x 5". */
  shape: z.string(),
  /** Column names inside the stored result, when it is tabular. */
  columns: z.array(z.string()),
  /** The group labels the result is keyed on (clusters, conditions). */
  groups: z.array(z.string()),
  /** Union of gene identifiers this stored result references (capped). */
  genes: z.array(z.string()),
  /** A short text preview handed to the agent as context. */
  preview: z.string(),
});
export type UnsEntry = z.infer<typeof UnsEntry>;

/**
 * The full inspection of one dataset. Camel-cased keys are the source of truth
 * the Python inspector mirrors (`nCells`, `hasRawCounts`, `countsSource`,
 * `varNamesSample`, `clusterFields`).
 */
export const DatasetInventory = z.object({
  file: z.string(),
  nCells: z.number().int().nonnegative(),
  nGenes: z.number().int().nonnegative(),
  obs: z.array(ObsColumn),
  uns: z.array(UnsEntry),
  /** `obs` columns that hold cluster / community labels (for example `leiden`). */
  clusterFields: z.array(z.string()),
  hasRawCounts: z.boolean(),
  /** Where raw counts live (for example "layers/counts" or ".raw"), or null. */
  countsSource: z.string().nullable(),
  layers: z.array(z.string()),
  obsm: z.array(z.string()),
  /** A sample of `var_names` (gene identifiers), for gene-existence checks. */
  varNamesSample: z.array(z.string()),
});
export type DatasetInventory = z.infer<typeof DatasetInventory>;

/**
 * True when the inventory contains an `obs` column (or cluster field) by this
 * exact name. Column names are identifiers, so the match is case-sensitive.
 * This is the predicate the honesty backstop uses to reject a claim that
 * references an `obs` column the data does not have (spec section 8).
 */
export function inventoryHasField(inv: DatasetInventory, name: string): boolean {
  if (name === '') return false;
  return inv.obs.some((c) => c.name === name) || inv.clusterFields.includes(name);
}

/**
 * True when the inventory knows a gene by this symbol. Gene symbols vary in
 * case across tools, so the match is case-insensitive. Genes are drawn from the
 * `var_names` sample and from the gene union of every stored `uns` result. This
 * is what lets Redline demote a claim about a gene the data never mentions
 * rather than auditing it as if it were real (spec section 8).
 */
export function inventoryKnowsGene(inv: DatasetInventory, gene: string): boolean {
  const g = gene.trim().toLowerCase();
  if (g === '') return false;
  if (inv.varNamesSample.some((v) => v.toLowerCase() === g)) return true;
  return inv.uns.some((u) => u.genes.some((x) => x.toLowerCase() === g));
}
