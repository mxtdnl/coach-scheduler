// HTML escaping for the markup app.js builds as strings.
//
// This lives in its own module, rather than inline in app.js, so tests.html can
// assert on it directly — app.js is the DOM entry point and starts the whole
// app on import, so nothing importable from it can be unit tested.
//
// The earlier implementation set `textContent` on a detached element and read
// `innerHTML` back. That escapes a *text node* correctly, but the HTML fragment
// serialisation algorithm only escapes `&`, `<`, `>` and U+00A0 in text — quotes
// are escaped only inside attribute values, which that route never produces. So
// a value interpolated into a quoted attribute (`data-coach="…"`, `value="…"`,
// `<option value="…">`) could close the attribute and add its own, including an
// event handler. Every one of those values comes from an uploaded spreadsheet.
//
// This escapes quotes as well, so one function is safe in both a text position
// and a quoted attribute value.

const ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * A value as HTML-safe text, usable in element content and inside a
 * double- or single-quoted attribute value.
 *
 * Null and undefined become an empty string: a missing optional field should
 * leave a blank cell, not print the word "undefined".
 */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ESCAPES[char]);
}
