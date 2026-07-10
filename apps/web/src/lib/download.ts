/**
 * Trigger a browser download of an in-memory text file. Same blob pattern the
 * report PDF export uses: make a blob, click a synthetic anchor, revoke the URL
 * on the next tick so the click has committed. Client-only.
 */
export function downloadTextFile(filename: string, text: string, mime = 'text/plain'): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
