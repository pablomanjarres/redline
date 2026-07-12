/**
 * A minimal Jupyter notebook model: enough to render an uploaded `.ipynb` as a
 * notebook and to flatten it into the plain text the extraction agent reads.
 *
 * Nothing here trusts the file. Sources and outputs are kept as plain strings
 * and rendered by React as text, never as HTML, so a notebook cannot inject
 * markup or script.
 */

export interface NotebookCell {
  type: 'code' | 'markdown';
  source: string;
  /** Plain-text outputs (stream text, or text/plain results), for a code cell. */
  outputs?: string[];
}

/** Join a Jupyter multiline source (string or string[]) into one string. */
function joinSource(source: unknown): string {
  if (Array.isArray(source)) return source.map((s) => (typeof s === 'string' ? s : '')).join('');
  return typeof source === 'string' ? source : '';
}

/** Pull the plain-text outputs out of a code cell's outputs array. */
function textOutputs(outputs: unknown): string[] {
  if (!Array.isArray(outputs)) return [];
  const out: string[] = [];
  for (const o of outputs) {
    const rec = o as { output_type?: string; text?: unknown; data?: Record<string, unknown> };
    if (rec.output_type === 'stream') {
      const t = joinSource(rec.text).trimEnd();
      if (t) out.push(t);
    } else if ((rec.output_type === 'execute_result' || rec.output_type === 'display_data') && rec.data) {
      const t = joinSource(rec.data['text/plain']).trimEnd();
      if (t) out.push(t);
    }
  }
  return out;
}

/** Parse a raw `.ipynb` string into cells, or `null` if it is not a notebook. */
export function parseNotebook(raw: string): NotebookCell[] | null {
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    return null;
  }
  const cells = (doc as { cells?: unknown }).cells;
  if (!Array.isArray(cells)) return null;
  const parsed: NotebookCell[] = [];
  for (const cell of cells) {
    const c = cell as { cell_type?: string; source?: unknown; outputs?: unknown };
    const source = joinSource(c.source);
    if (!source.trim()) continue;
    if (c.cell_type === 'markdown') {
      parsed.push({ type: 'markdown', source });
    } else if (c.cell_type === 'code') {
      const outputs = textOutputs(c.outputs);
      parsed.push(outputs.length ? { type: 'code', source, outputs } : { type: 'code', source });
    }
    // raw and unknown cell types are skipped
  }
  return parsed.length ? parsed : null;
}

/** Wrap a plain script as a single code cell. */
export function scriptToCells(source: string): NotebookCell[] {
  return [{ type: 'code', source }];
}

/**
 * Flatten cells into the plain text the extraction agent reads. A code cell's
 * plain-text outputs are appended after its source, because a printed result
 * (a p-value, a fold change) is often the very claim to audit, and it is what
 * the rendered preview shows; keeping them here means the text sent matches the
 * notebook seen.
 */
export function cellsToText(cells: NotebookCell[]): string {
  return cells
    .map((c) => {
      const src = c.source.trim();
      const outs = c.outputs && c.outputs.length ? c.outputs.join('\n').trim() : '';
      return outs ? [src, outs].filter(Boolean).join('\n') : src;
    })
    .filter(Boolean)
    .join('\n\n');
}

/** Build a minimal `.ipynb` document from cells (for the sample download). */
export function cellsToIpynb(cells: NotebookCell[]): string {
  const doc = {
    cells: cells.map((c) => ({
      cell_type: c.type,
      metadata: {},
      // Keep the trailing newline on each line, the way nbformat stores source.
      source: c.source.split(/(?<=\n)/),
      ...(c.type === 'code' ? { execution_count: null, outputs: [] } : {}),
    })),
    metadata: {
      kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' },
      language_info: { name: 'python' },
    },
    nbformat: 4,
    nbformat_minor: 5,
  };
  return JSON.stringify(doc, null, 1);
}

/**
 * Read a picked file into a notebook: a `.ipynb` becomes its parsed cells, any
 * other file becomes a single code cell. A `.ipynb` that does not parse into
 * cells throws, rather than masquerading the raw JSON as code. The flattened
 * `text` is what gets sent for extraction, clamped to the field's contract cap
 * so the request never trips the route's size guard; `truncated` says whether
 * the clamp dropped anything the preview still shows.
 */
export async function readNotebookFile(
  file: File,
  maxChars: number,
): Promise<{ cells: NotebookCell[]; text: string; name: string; truncated: boolean }> {
  const raw = await file.text();
  const isIpynb = file.name.toLowerCase().endsWith('.ipynb');
  const parsed = isIpynb ? parseNotebook(raw) : null;
  if (isIpynb && !parsed) throw new Error('not a readable notebook');
  const cells = parsed ?? scriptToCells(raw);
  const flat = cellsToText(cells);
  const truncated = flat.length > maxChars;
  return { cells, text: truncated ? flat.slice(0, maxChars) : flat, name: file.name, truncated };
}
