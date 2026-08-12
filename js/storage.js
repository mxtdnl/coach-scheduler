// localStorage read/write helpers.
// Per SPEC.md §2, only settings are persisted here (start date, mode, FTE
// values, custom export mapping). Uploaded data is never persisted.

const KEYS = {
  START_DATE: 'coachScheduler.startDate',
  MODE: 'coachScheduler.mode',
  FTE: 'coachScheduler.fte',
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

/** coach name → FTE (SPEC.md §5.1: persisted to localStorage keyed by coach name). */
export function getFteMap() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEYS.FTE));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function setFte(coachName, value) {
  const map = getFteMap();
  map[coachName] = value;
  localStorage.setItem(KEYS.FTE, JSON.stringify(map));
}
