// localStorage read/write helpers.
// Per SPEC.md §2, only settings are persisted here: start date, mode, FTE
// values, and the custom export mapping — the four keys in STORAGE_KEYS and
// nothing else. Uploaded data is held in memory only and never written here.
//
// Every access goes through readRaw/writeRaw so that a browser which refuses
// localStorage (private mode, disabled storage, quota exhausted) produces a
// visible message rather than a silent no-op (SPEC.md §6).

import { showWarning, describeError } from './errors.js';

const KEYS = {
  START_DATE: 'coachScheduler.startDate',
  MODE: 'coachScheduler.mode',
  // v2: the default columns changed (SPEC.md §7.1), and a v1 payload names
  // fields that no longer exist. sanitiseMapping would drop those and leave a
  // returning user with a half-right export, so the new key deliberately
  // ignores the old one and starts them on the new defaults.
  EXPORT_MAPPING: 'coachScheduler.exportMapping.v2',
  FTE: 'coachScheduler.fte',
  CAMPUS: 'coachScheduler.campus',
};

/** Keys written by earlier versions, removed by "Start over" so nothing lingers. */
const LEGACY_KEYS = ['coachScheduler.exportMapping'];

/** The complete set of keys this app is allowed to write (SPEC.md §2). */
export const STORAGE_KEYS = Object.values(KEYS);

function readRaw(key) {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    showWarning(
      'Saved settings could not be read, so defaults are being used. Scheduling still works.',
      describeError(error),
      'storage:read'
    );
    return null;
  }
}

function writeRaw(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (error) {
    showWarning(
      'This setting could not be saved for next time, so it will be lost when you reload. Everything on screen still works.',
      describeError(error),
      'storage:write'
    );
    return false;
  }
}

export function getStartDate() {
  return readRaw(KEYS.START_DATE);
}

export function setStartDate(isoDate) {
  writeRaw(KEYS.START_DATE, isoDate);
}

/** The run's campus id (SPEC.md §6.1), or null if never chosen. */
export function getCampus() {
  return readRaw(KEYS.CAMPUS);
}

export function setCampus(campusId) {
  writeRaw(KEYS.CAMPUS, campusId);
}

export function getMode() {
  return readRaw(KEYS.MODE);
}

export function setMode(mode) {
  writeRaw(KEYS.MODE, mode);
}

/** The customisable export mapping (SPEC.md §7.2), or null if unset/invalid. */
export function getExportMapping() {
  const raw = readRaw(KEYS.EXPORT_MAPPING);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch (error) {
    showWarning(
      'The saved export layout could not be read, so the default columns are being used.',
      describeError(error),
      'storage:mapping'
    );
    return null;
  }
}

export function setExportMapping(mapping) {
  writeRaw(KEYS.EXPORT_MAPPING, JSON.stringify(mapping));
}

/** coach name → FTE (SPEC.md §5.1: persisted to localStorage keyed by coach name). */
export function getFteMap() {
  const raw = readRaw(KEYS.FTE);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    showWarning(
      'The saved FTE values could not be read, so every coach starts at 1.00.',
      describeError(error),
      'storage:fte'
    );
    return {};
  }
}

export function setFte(coachName, value) {
  const map = getFteMap();
  map[coachName] = value;
  writeRaw(KEYS.FTE, JSON.stringify(map));
}

/** Removes exactly this app's settings keys — used by "Start over" (SPEC.md §2). */
export function clearSettings() {
  try {
    [...STORAGE_KEYS, ...LEGACY_KEYS].forEach((key) => localStorage.removeItem(key));
    return true;
  } catch (error) {
    showWarning('Saved settings could not be cleared.', describeError(error), 'storage:clear');
    return false;
  }
}
