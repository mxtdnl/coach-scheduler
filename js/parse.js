// Excel parsing + validation for the 4 file types (SPEC.md §3, §8).
//
// Every parse* function returns { rows, errors, warnings }, where errors and
// warnings are arrays of { file, row, message }. `row` is the 1-based
// spreadsheet row number (header is row 1) or null for file-level problems
// (missing column, empty file). Times are represented as minutes since
// midnight (integers) so overlap/boundary arithmetic in scheduler.js is
// simple arithmetic rather than string parsing.

import { getXLSX, XLSX_MISSING } from './xlsx-loader.js';
import { describeError } from './errors.js';

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAY_ABBREVIATIONS = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
const TIME_PATTERN = /^(\d{1,2}):(\d{2})$/;

function addIssue(list, file, row, message) {
  list.push({ file, row, message });
}

function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

function isBlankRow(row) {
  return row.every((cell) => isBlank(cell));
}

function isCommentRow(row) {
  return String(row[0] ?? '').trim().startsWith('#');
}

function buildHeaderIndex(headerRow) {
  const index = {};
  headerRow.forEach((cell, i) => {
    const key = String(cell ?? '').trim().toLowerCase();
    if (key && !(key in index)) index[key] = i;
  });
  return index;
}

function findMissingColumns(headerIndex, requiredColumns) {
  return requiredColumns.filter((name) => headerIndex[name.toLowerCase()] === undefined);
}

function parseDayValue(raw) {
  const trimmed = String(raw).trim();
  const lower = trimmed.toLowerCase();
  const full = DAY_NAMES.find((d) => d.toLowerCase() === lower);
  if (full) return full;
  if (DAY_ABBREVIATIONS[lower]) return DAY_ABBREVIATIONS[lower];
  return null;
}

function parseTimeValue(raw) {
  if (raw instanceof Date) {
    return raw.getHours() * 60 + raw.getMinutes();
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const fraction = raw - Math.floor(raw);
    return Math.round(fraction * 24 * 60);
  }
  if (typeof raw === 'string') {
    const match = TIME_PATTERN.exec(raw.trim());
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) return null;
    return hours * 60 + minutes;
  }
  return null;
}

async function readSheetRows(file) {
  const XLSX = getXLSX();
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
    throw new Error('The workbook has no sheets.');
  }
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error(`Sheet "${workbook.SheetNames[0]}" could not be read.`);
  return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
}

/**
 * Runs the shared read/header/blank-row/comment-row/empty-file machinery
 * and hands each remaining data row to `parseRow`, which returns either a
 * parsed row object or null (if it pushed its own errors and the row
 * should be dropped).
 */
async function parseSheet(file, requiredColumns, parseRow) {
  const fileName = file.name;
  const errors = [];
  const warnings = [];

  let sheetRows;
  try {
    sheetRows = await readSheetRows(file);
  } catch (e) {
    // A missing SheetJS is an app-level problem, not a problem with this
    // file — let it reach the global error surface unchanged.
    if (e && e.code === XLSX_MISSING) throw e;
    addIssue(
      errors,
      fileName,
      null,
      `Could not read this file. Make sure it is a valid .xlsx file saved from Excel. (${describeError(e)})`
    );
    return { rows: [], errors, warnings };
  }

  if (sheetRows.length === 0) {
    addIssue(errors, fileName, null, 'File contains no data rows.');
    return { rows: [], errors, warnings };
  }

  const headerIndex = buildHeaderIndex(sheetRows[0]);
  const missing = findMissingColumns(headerIndex, requiredColumns);
  if (missing.length > 0) {
    missing.forEach((name) => addIssue(errors, fileName, 1, `Missing required column "${name}".`));
    return { rows: [], errors, warnings };
  }

  const rows = [];
  for (let i = 1; i < sheetRows.length; i++) {
    const raw = sheetRows[i];
    const rowNumber = i + 1;
    if (isBlankRow(raw) || isCommentRow(raw)) continue;

    const parsed = parseRow(raw, rowNumber, headerIndex, fileName, errors);
    if (parsed) rows.push(parsed);
  }

  if (rows.length === 0 && errors.length === 0) {
    addIssue(errors, fileName, null, 'File contains no data rows.');
  }

  return { rows, errors, warnings };
}

function parseDayAndTimeFields(raw, rowNumber, headerIndex, fileName, errors) {
  const dayCol = headerIndex['day'];
  const startCol = headerIndex['start time'];
  const endCol = headerIndex['end time'];

  let ok = true;

  const dayRaw = raw[dayCol];
  let day = null;
  if (isBlank(dayRaw)) {
    addIssue(errors, fileName, rowNumber, 'Missing Day value.');
    ok = false;
  } else {
    day = parseDayValue(dayRaw);
    if (day === null) {
      addIssue(errors, fileName, rowNumber, `Unknown day name "${String(dayRaw).trim()}".`);
      ok = false;
    }
  }

  const startRaw = raw[startCol];
  let start = null;
  if (isBlank(startRaw)) {
    addIssue(errors, fileName, rowNumber, 'Missing Start Time value.');
    ok = false;
  } else {
    start = parseTimeValue(startRaw);
    if (start === null) {
      addIssue(errors, fileName, rowNumber, `Could not understand Start Time "${String(startRaw).trim()}". Use 24-hour HH:MM.`);
      ok = false;
    }
  }

  const endRaw = raw[endCol];
  let end = null;
  if (isBlank(endRaw)) {
    addIssue(errors, fileName, rowNumber, 'Missing End Time value.');
    ok = false;
  } else {
    end = parseTimeValue(endRaw);
    if (end === null) {
      addIssue(errors, fileName, rowNumber, `Could not understand End Time "${String(endRaw).trim()}". Use 24-hour HH:MM.`);
      ok = false;
    }
  }

  if (ok && end <= start) {
    addIssue(errors, fileName, rowNumber, 'End Time must be after Start Time.');
    ok = false;
  }

  return ok ? { day, start, end } : null;
}

export async function parseClassSchedule(file) {
  return parseSheet(file, ['Day', 'Start Time', 'End Time'], (raw, rowNumber, headerIndex, fileName, errors) => {
    const timing = parseDayAndTimeFields(raw, rowNumber, headerIndex, fileName, errors);
    if (!timing) return null;
    const classNameCol = headerIndex['class name'];
    const className = classNameCol !== undefined ? String(raw[classNameCol] ?? '').trim() : '';
    return { day: timing.day, start: timing.start, end: timing.end, className };
  });
}

export async function parseCoachAvailability(file) {
  return parseSheet(file, ['Coach Name', 'Day', 'Start Time', 'End Time'], (raw, rowNumber, headerIndex, fileName, errors) => {
    const coachNameCol = headerIndex['coach name'];
    const coachNameRaw = raw[coachNameCol];
    if (isBlank(coachNameRaw)) {
      addIssue(errors, fileName, rowNumber, 'Missing Coach Name value.');
      return null;
    }
    const timing = parseDayAndTimeFields(raw, rowNumber, headerIndex, fileName, errors);
    if (!timing) return null;
    const coachIdCol = headerIndex['coach id'];
    const coachId = coachIdCol !== undefined ? String(raw[coachIdCol] ?? '').trim() : '';
    return { coachName: String(coachNameRaw).trim(), coachId, day: timing.day, start: timing.start, end: timing.end };
  });
}

export async function parseStudentList(file) {
  const result = await parseSheet(file, ['Contact SF ID', 'Student Name'], (raw, rowNumber, headerIndex, fileName, errors) => {
    const idCol = headerIndex['contact sf id'];
    const nameCol = headerIndex['student name'];
    const idRaw = raw[idCol];
    const nameRaw = raw[nameCol];
    let ok = true;
    if (isBlank(idRaw)) {
      addIssue(errors, fileName, rowNumber, 'Missing Contact SF ID value.');
      ok = false;
    }
    if (isBlank(nameRaw)) {
      addIssue(errors, fileName, rowNumber, 'Missing Student Name value.');
      ok = false;
    }
    if (!ok) return null;
    return { contactSfId: String(idRaw).trim(), studentName: String(nameRaw).trim(), _row: rowNumber };
  });

  if (result.rows.length === 0) return result;

  const rowsById = new Map();
  result.rows.forEach((row) => {
    if (!rowsById.has(row.contactSfId)) rowsById.set(row.contactSfId, []);
    rowsById.get(row.contactSfId).push(row._row);
  });

  const duplicateIds = new Set();
  rowsById.forEach((rowNumbers, id) => {
    if (rowNumbers.length > 1) {
      duplicateIds.add(id);
      addIssue(result.errors, file.name, rowNumbers[0], `Duplicate Contact SF ID "${id}" appears in rows ${rowNumbers.join(', ')}.`);
    }
  });

  result.rows = result.rows
    .filter((row) => !duplicateIds.has(row.contactSfId))
    .map(({ contactSfId, studentName }) => ({ contactSfId, studentName }));

  return result;
}

export async function parsePairings(file) {
  return parseSheet(file, ['Contact SF ID', 'Coach Name'], (raw, rowNumber, headerIndex, fileName, errors) => {
    const idCol = headerIndex['contact sf id'];
    const coachCol = headerIndex['coach name'];
    const idRaw = raw[idCol];
    const coachRaw = raw[coachCol];
    let ok = true;
    if (isBlank(idRaw)) {
      addIssue(errors, fileName, rowNumber, 'Missing Contact SF ID value.');
      ok = false;
    }
    if (isBlank(coachRaw)) {
      addIssue(errors, fileName, rowNumber, 'Missing Coach Name value.');
      ok = false;
    }
    if (!ok) return null;
    return { contactSfId: String(idRaw).trim(), coachName: String(coachRaw).trim(), _row: rowNumber };
  });
}

/**
 * Cross-file check (SPEC.md §8): pairings referencing unknown students or
 * coaches are warnings at parse time, not errors — they only become
 * "unassigned" reasons at scheduling. `rows` are the parsed pairings rows
 * (with the internal `_row` field still attached).
 */
export function checkPairingsReferences(fileName, rows, studentIds, coachNames) {
  const warnings = [];
  rows.forEach((row) => {
    if (!studentIds.has(row.contactSfId)) {
      addIssue(warnings, fileName, row._row, `Contact SF ID "${row.contactSfId}" does not appear in the student list.`);
    }
    if (!coachNames.has(row.coachName)) {
      addIssue(warnings, fileName, row._row, `Coach Name "${row.coachName}" does not appear in the coach availability file.`);
    }
  });
  return warnings;
}
