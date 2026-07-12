/**
 * Read an attached analysis file as text for the extraction agent. The analysis
 * fields are plain text fed straight to the model, so a client-side file read is
 * all it takes, in every compute mode.
 *
 * A Jupyter notebook is JSON, so a raw read would hand the model the notebook
 * plumbing. Pull the cell sources out instead, so the model sees clean code and
 * markdown. Everything else is read as-is. Fails soft: an unparseable `.ipynb`
 * falls back to its raw text.
 */

/** Refuse anything past this before reading, so a stray binary never loads. */
export const MAX_ANALYSIS_FILE_BYTES = 1_000_000;

/** Flatten a Jupyter notebook's cells into their source text. */
export function notebookToText(raw: string): string {
  try {
    const nb = JSON.parse(raw) as { cells?: unknown };
    if (!Array.isArray(nb.cells)) return raw;
    const blocks: string[] = [];
    for (const cell of nb.cells) {
      const c = cell as { source?: unknown };
      const src = Array.isArray(c.source) ? c.source.join('') : String(c.source ?? '');
      const text = src.trim();
      if (text) blocks.push(text);
    }
    return blocks.length ? blocks.join('\n\n') : raw;
  } catch {
    return raw;
  }
}

/**
 * Read a picked file into text, parsing `.ipynb` into cell sources, and clamp to
 * `maxChars` (the field's contract cap) so the request never trips the route's
 * size guard.
 */
export async function readAnalysisText(file: File, maxChars: number): Promise<string> {
  const raw = await file.text();
  const text = file.name.toLowerCase().endsWith('.ipynb') ? notebookToText(raw) : raw;
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}
