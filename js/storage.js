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
  // v3: the default columns changed again (SPEC.md §11.4 appends Rescheduled
  // From Week). As with v2, a mapping saved against an older default set is
  // ignored rather than partially restored, so a returning user gets the
  // current defaults instead of an export missing the new column.
  EXPORT_MAPPING: 'coachScheduler.exportMapping.v3',
  FTE: 'coachScheduler.fte',
  CAMPUS: 'coachScheduler.campus',
  // Blocked coach weeks/dates (SPEC.md §11.2), persisted alongside the other
  // settings. Uploaded rows are still never written here.
  BLOCKS: 'coachScheduler.blocks',
};

/** Keys written by earlier versions, removed by "Start over" so nothing lingers. */
const LEGACY_KEYS = ['coachScheduler.exportMapping', 'coachScheduler.exportMapping.v2'];

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

/**
 * Blocked coach weeks/dates (SPEC.md §11.2). Stored in the form the panel
 * edits — `{coach, kind:'week', week}` or `{coach, kind:'date', date}` — so a
 * date block re-resolves to the right week if the term start date changes.
 */
export function getBlocks() {
  const raw = readRaw(KEYS.BLOCKS);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    showWarning(
      'The saved blocked weeks and dates could not be read, so none are applied.',
      describeError(error),
      'storage:blocks'
    );
    return [];
  }
}

export function setBlocks(blocks) {
  writeRaw(KEYS.BLOCKS, JSON.stringify(blocks));
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
