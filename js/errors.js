// Central error surface (SPEC.md §6: "All errors must be human-readable and
// name the file, row, and problem. The app must never fail silently.").
//
// Everything that can throw — file reading, parsing, scheduling, export,
// localStorage, rendering — is routed through `guard`/`guardAsync` or caught
// by the global handlers installed here, and surfaces as a readable alert.
// Nothing is ever swallowed: if there is no better message, the raw error
// text is shown as the detail line.

const ALERTS_ID = 'app-alerts';

/** Turns whatever was thrown into a readable one-line detail string. */
export function describeError(error) {
  if (error === null || error === undefined) return 'No further detail was available.';
  if (error instanceof Error) return error.message || error.name || String(error);
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function alertsRegion() {
  let region = document.getElementById(ALERTS_ID);
  if (!region) {
    region = document.createElement('div');
    region.id = ALERTS_ID;
    region.className = 'alerts';
    region.setAttribute('role', 'region');
    region.setAttribute('aria-label', 'Notifications');
    document.body.appendChild(region);
  }
  return region;
}

/**
 * Shows a dismissible alert. `key` de-duplicates: showing the same key twice
 * replaces the previous alert instead of stacking copies of it (a render loop
 * failing on every keystroke should not bury the page).
 */
function showAlert(kind, summary, detail, key) {
  const region = alertsRegion();
  const alertKey = key || `${kind}:${summary}`;
  const existing = region.querySelector(`[data-alert-key="${CSS.escape(alertKey)}"]`);
  if (existing) existing.remove();

  const alertEl = document.createElement('div');
  alertEl.className = `alert alert-${kind}`;
  alertEl.dataset.alertKey = alertKey;
  alertEl.setAttribute('role', kind === 'error' ? 'alert' : 'status');

  const body = document.createElement('div');
  body.className = 'alert-body';

  const summaryEl = document.createElement('p');
  summaryEl.className = 'alert-summary';
  summaryEl.textContent = summary;
  body.appendChild(summaryEl);

  if (detail) {
    const detailEl = document.createElement('p');
    detailEl.className = 'alert-detail mono';
    detailEl.textContent = detail;
    body.appendChild(detailEl);
  }

  const dismissBtn = document.createElement('button');
  dismissBtn.type = 'button';
  dismissBtn.className = 'alert-dismiss';
  dismissBtn.textContent = 'Dismiss';
  dismissBtn.addEventListener('click', () => alertEl.remove());

  alertEl.append(body, dismissBtn);
  region.appendChild(alertEl);
  return alertEl;
}

/** Red alert — something did not work and the user needs to know. */
export function showError(summary, detail, key) {
  return showAlert('error', summary, detail, key);
}

/** Amber alert — the app carried on, but with a caveat worth reading. */
export function showWarning(summary, detail, key) {
  return showAlert('warning', summary, detail, key);
}

/** Removes every alert currently on screen. */
export function clearAlerts() {
  alertsRegion().replaceChildren();
}

/**
 * Runs `fn`, reporting anything it throws as "Something went wrong while
 * <action>." plus the underlying message. Returns `fallback` on failure so
 * callers can keep rendering rather than leaving a half-drawn page.
 */
export function guard(action, fn, fallback) {
  try {
    return fn();
  } catch (error) {
    showError(`Something went wrong while ${action}.`, describeError(error), `guard:${action}`);
    return fallback;
  }
}

/** `guard` for async work (file reading, parsing). */
export async function guardAsync(action, fn, fallback) {
  try {
    return await fn();
  } catch (error) {
    showError(`Something went wrong while ${action}.`, describeError(error), `guard:${action}`);
    return fallback;
  }
}

/** Wraps an event handler so a throw inside it surfaces instead of vanishing. */
export function guarded(action, handler) {
  return (...args) => guard(action, () => handler(...args));
}

/**
 * Catches anything that escapes the guards above — including errors thrown
 * from browser-invoked callbacks and rejected promises nobody awaited.
 */
export function installGlobalErrorHandlers() {
  window.addEventListener('error', (event) => {
    const detail = event.error ? describeError(event.error) : event.message || 'Unknown error.';
    const where = event.filename ? ` (${event.filename.split('/').pop()}:${event.lineno})` : '';
    showError('Something went wrong. The last action may not have completed.', detail + where, 'global:error');
  });

  window.addEventListener('unhandledrejection', (event) => {
    showError(
      'Something went wrong. The last action may not have completed.',
      describeError(event.reason),
      'global:rejection'
    );
  });
}
