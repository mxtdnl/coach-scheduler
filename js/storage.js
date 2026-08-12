// localStorage read/write helpers.
// Per SPEC.md §2, only settings are persisted here (start date, mode, FTE
// values, custom export mapping). Uploaded data is never persisted.

const KEYS = {
  START_DATE: 'coachScheduler.startDate',
  MODE: 'coachScheduler.mode',
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
