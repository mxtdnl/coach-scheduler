// localStorage read/write helpers.
// Per SPEC.md §2, only settings are persisted here (start date, mode, FTE
// values, custom export mapping). Uploaded data is never persisted.

const KEYS = {
  START_DATE: 'coachScheduler.startDate',
  MODE: 'coachScheduler.mode',
  EXPORT_MAPPING: 'coachScheduler.exportMapping',
};

export function getStartDate() {
  return localStorage.getItem(KEYS.START_DATE);
}

export function setStartDate(isoDate) {
  localStorage.setItem(KEYS.START_DATE, isoDate);
}

export function getMode() {
  return localStorage.getItem(KEYS.MODE);
}

export function setMode(mode) {
  localStorage.setItem(KEYS.MODE, mode);
}

/** The customisable export mapping (SPEC.md §7.2), or null if unset/invalid. */
export function getExportMapping() {
  const raw = localStorage.getItem(KEYS.EXPORT_MAPPING);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function setExportMapping(mapping) {
  localStorage.setItem(KEYS.EXPORT_MAPPING, JSON.stringify(mapping));
}
