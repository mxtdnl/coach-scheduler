// Access to SheetJS, which SPEC.md §2 loads from the CDN in index.html.
//
// The library is the app's only external dependency and the only network
// request the app makes. If the CDN is unreachable (offline laptop, blocked
// network), `window.XLSX` is simply never defined — so every use goes through
// getXLSX(), which fails loudly with a message that says what to do rather
// than throwing an opaque "XLSX is not defined" (SPEC.md §6).

export const XLSX_MISSING = 'XLSX_MISSING';

export const XLSX_MISSING_MESSAGE =
  'The Excel library could not be loaded from the internet, so files cannot be read or exported. ' +
  'Check your connection and reload the page.';

/** True when SheetJS finished loading. */
export function isXLSXAvailable() {
  return Boolean(window.XLSX && window.XLSX.utils);
}

/** SheetJS, or a readable throw if the CDN script never arrived. */
export function getXLSX() {
  if (!isXLSXAvailable()) {
    const error = new Error(XLSX_MISSING_MESSAGE);
    error.code = XLSX_MISSING;
    throw error;
  }
  return window.XLSX;
}
