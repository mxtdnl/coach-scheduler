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
import {
  buildClassBlocks,
  classBlockKey,
  minutesToHours,
  minutesToTime,
  CLASS_BLOCK_TOTAL_HOURS,
  CLASS_BLOCK_TOTAL_MINUTES,
} from './scheduler.js';

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAY_ABBREVIATIONS = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
const TIME_PATTERN = /^(\d{1,2}):(\d{2})$/;
// Deliberately permissive: this catches the real mistakes (a name in the
// email column, a missing @, a stray space) without rejecting the valid but
// unusual addresses a stricter pattern would.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

  let sheetRows;
  try {
    sheetRows = await readSheetRows(file);
  } catch (e) {
    // A missing SheetJS is an app-level problem, not a problem with this
    // file — let it reach the global error surface unchanged.
    if (e && e.code === XLSX_MISSING) throw e;
    return {
      rows: [],
      errors: [
        {
          file: fileName,
          row: null,
          message: `Could not read this file. Make sure it is a valid .xlsx file saved from Excel. (${describeError(e)})`,
        },
      ],
      warnings: [],
    };
  }

  return parseSheetRows(fileName, sheetRows, requiredColumns, parseRow);
}

/**
 * The sheet-shaped half of `parseSheet`: everything from the header row down,
 * with no file or SheetJS involved. Split out so the validation rules can be
 * exercised directly from tests.html against an array-of-arrays.
 */
function parseSheetRows(fileName, sheetRows, requiredColumns, parseRow) {
  const errors = [];
  const warnings = [];

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

/**
 * A required free-text cell: present, non-blank, trimmed. Returns null (and
 * records a named error) when the cell is empty. Every export column is a
 * hard requirement (SPEC.md §3, §7.1), so this is the common case.
 */
function requiredText(raw, headerIndex, columnName, rowNumber, fileName, errors) {
  const value = raw[headerIndex[columnName.toLowerCase()]];
  if (isBlank(value)) {
    addIssue(errors, fileName, rowNumber, `Missing ${columnName} value.`);
    return null;
  }
  return String(value).trim();
}

/** As requiredText, plus a shape check so a non-address never reaches the export. */
function requiredEmail(raw, headerIndex, columnName, rowNumber, fileName, errors) {
  const value = requiredText(raw, headerIndex, columnName, rowNumber, fileName, errors);
  if (value === null) return null;
  if (!EMAIL_PATTERN.test(value)) {
    addIssue(errors, fileName, rowNumber, `"${value}" is not a valid ${columnName} — expected an address like name@example.com.`);
    return null;
  }
  return value;
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

/**
 * A cell that names exactly one class block. Two names in one cell (a comma,
 * semicolon, slash, "&" or " and ") is rejected rather than guessed at:
 * SPEC.md §3.1 gives every class row exactly one block.
 */
const MULTI_VALUE_PATTERN = /,|;|\/|\||&|\band\b|\+/i;

function requiredClassBlock(raw, headerIndex, columnName, rowNumber, fileName, errors) {
  const value = requiredText(raw, headerIndex, columnName, rowNumber, fileName, errors);
  if (value === null) return null;
  if (MULTI_VALUE_PATTERN.test(value)) {
    addIssue(
      errors,
      fileName,
      rowNumber,
      `"${value}" names more than one class block. Put exactly one class block name in the ${columnName} column.`
    );
    return null;
  }
  return value;
}

/**
 * SPEC.md §3.1 — each class block is one cohort's complete timetable and is
 * expected to total 13.5 hours of class. The total is the sum of every class
 * row in the block, so a block that is short or long is named here with the
 * total it actually came to. This is a warning, not an error: the file is
 * still accepted and schedulable, because a cohort's real timetable may
 * legitimately differ and only the user can say whether it is a mistake.
 */
function checkClassBlockTotals(fileName, rows, warnings) {
  buildClassBlocks(rows).forEach((block) => {
    if (block.minutes === CLASS_BLOCK_TOTAL_MINUTES) return;
    const firstRow = block.rowNumbers[0] ?? null;
    const direction = block.minutes < CLASS_BLOCK_TOTAL_MINUTES ? 'short of' : 'over';
    const difference = minutesToHours(Math.abs(block.minutes - CLASS_BLOCK_TOTAL_MINUTES));
    addIssue(
      warnings,
      fileName,
      firstRow,
      `Class block "${block.name}" totals ${minutesToHours(block.minutes)} hours across ${block.classes.length} class${
        block.classes.length === 1 ? '' : 'es'
      } — ${difference} hour${difference === 1 ? '' : 's'} ${direction} the expected ${CLASS_BLOCK_TOTAL_HOURS} hours. The file has been accepted; check the class times for this block if that is not intended.`
    );
  });
}

/**
 * Two classes of the same block overlapping would make its hour total
 * meaningless (the same hour counted twice), so they are a named error rather
 * than a silent inflation of the hours check. The same clock hour in two
 * *different* blocks is normal and untouched.
 */
function checkClassOverlaps(fileName, rows, errors) {
  buildClassBlocks(rows).forEach((block) => {
    const byDay = new Map();
    block.classes.forEach((row) => {
      if (!byDay.has(row.day)) byDay.set(row.day, []);
      const earlier = byDay.get(row.day).find((other) => other.start < row.end && row.start < other.end);
      if (earlier) {
        addIssue(
          errors,
          fileName,
          row._row,
          `Class block "${block.name}" has two overlapping classes on ${row.day}: ${minutesToTime(earlier.start)}–${minutesToTime(
            earlier.end
          )} (row ${earlier._row}) and ${minutesToTime(row.start)}–${minutesToTime(row.end)} (row ${row._row}).`
        );
      }
      byDay.get(row.day).push(row);
    });
  });
}

const CLASS_SCHEDULE_COLUMNS = ['Class Block', 'Day', 'Start Time', 'End Time'];

function parseClassScheduleRow(raw, rowNumber, headerIndex, fileName, errors) {
  const classBlock = requiredClassBlock(raw, headerIndex, 'Class Block', rowNumber, fileName, errors);
  const timing = parseDayAndTimeFields(raw, rowNumber, headerIndex, fileName, errors);
  if (classBlock === null || !timing) return null;
  const classNameCol = headerIndex['class name'];
  const className = classNameCol !== undefined ? String(raw[classNameCol] ?? '').trim() : '';
  return { classBlock, day: timing.day, start: timing.start, end: timing.end, className, _row: rowNumber };
}

/** The whole-file class checks, which only make sense once every row is parsed. */
function finishClassSchedule(fileName, result) {
  if (result.rows.length > 0) {
    checkClassOverlaps(fileName, result.rows, result.errors);
    checkClassBlockTotals(fileName, result.rows, result.warnings);
  }
  return result;
}

/** The class-schedule rules applied to an already-read sheet (see parseSheetRows). */
export function parseClassScheduleSheet(fileName, sheetRows) {
  return finishClassSchedule(fileName, parseSheetRows(fileName, sheetRows, CLASS_SCHEDULE_COLUMNS, parseClassScheduleRow));
}

export async function parseClassSchedule(file) {
  return finishClassSchedule(file.name, await parseSheet(file, CLASS_SCHEDULE_COLUMNS, parseClassScheduleRow));
}

/**
 * The run's class blocks in first-appearance order, for the UI and the engine.
 * Only cleanly parsed rows should be passed in.
 */
export function classBlocksOf(classRows) {
  return buildClassBlocks(classRows);
}

/**
 * Coach identity (SF ID, email) repeats on every availability row for a
 * coach, so the file can contradict itself. Taking the first value silently
 * would put an arbitrary one of two addresses into the export, so a coach
 * whose rows disagree is a named error instead (SPEC.md §8).
 */
function checkCoachConsistency(fileName, rows, errors) {
  const seen = new Map(); // coach name → { coachSfId, coachEmail, row }
  rows.forEach((row) => {
    const first = seen.get(row.coachName);
    if (!first) {
      seen.set(row.coachName, row);
      return;
    }
    [
      ['Coach SF ID', 'coachSfId'],
      ['Coach Email', 'coachEmail'],
    ].forEach(([label, field]) => {
      if (row[field] !== first[field]) {
        addIssue(
          errors,
          fileName,
          row._row,
          `Coach "${row.coachName}" has two different ${label} values: "${first[field]}" (row ${first._row}) and "${row[field]}" (row ${row._row}).`
        );
      }
    });
  });
}

export async function parseCoachAvailability(file) {
  const result = await parseSheet(
    file,
    ['Coach Name', 'Coach SF ID', 'Coach Email', 'Day', 'Start Time', 'End Time'],
    (raw, rowNumber, headerIndex, fileName, errors) => {
      const coachName = requiredText(raw, headerIndex, 'Coach Name', rowNumber, fileName, errors);
      const coachSfId = requiredText(raw, headerIndex, 'Coach SF ID', rowNumber, fileName, errors);
      const coachEmail = requiredEmail(raw, headerIndex, 'Coach Email', rowNumber, fileName, errors);
      const timing = parseDayAndTimeFields(raw, rowNumber, headerIndex, fileName, errors);
      if (coachName === null || coachSfId === null || coachEmail === null || !timing) return null;
      return {
        coachName,
        coachSfId,
        coachEmail,
        day: timing.day,
        start: timing.start,
        end: timing.end,
        _row: rowNumber,
      };
    }
  );

  checkCoachConsistency(file.name, result.rows, result.errors);
  result.rows = result.rows.map(({ _row, ...row }) => row);
  return result;
}

const STUDENT_LIST_COLUMNS = ['Contact SF ID', 'Student Name', 'Student Email', 'Class Block'];

function parseStudentRow(raw, rowNumber, headerIndex, fileName, errors) {
  const contactSfId = requiredText(raw, headerIndex, 'Contact SF ID', rowNumber, fileName, errors);
  const studentName = requiredText(raw, headerIndex, 'Student Name', rowNumber, fileName, errors);
  const studentEmail = requiredEmail(raw, headerIndex, 'Student Email', rowNumber, fileName, errors);
  // SPEC.md §3.3: exactly one class block per student — blank, or two names
  // in one cell, is an error rather than a guess.
  const classBlock = requiredClassBlock(raw, headerIndex, 'Class Block', rowNumber, fileName, errors);
  if (contactSfId === null || studentName === null || studentEmail === null || classBlock === null) return null;
  return { contactSfId, studentName, studentEmail, classBlock, _row: rowNumber };
}

/** The student-list rules applied to an already-read sheet (see parseSheetRows). */
export function parseStudentListSheet(fileName, sheetRows) {
  return finishStudentList(fileName, parseSheetRows(fileName, sheetRows, STUDENT_LIST_COLUMNS, parseStudentRow));
}

export async function parseStudentList(file) {
  return finishStudentList(file.name, await parseSheet(file, STUDENT_LIST_COLUMNS, parseStudentRow));
}

/** Duplicate-ID detection, which only makes sense once every row is parsed. */
function finishStudentList(fileName, result) {
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
      addIssue(result.errors, fileName, rowNumbers[0], `Duplicate Contact SF ID "${id}" appears in rows ${rowNumbers.join(', ')}.`);
    }
  });

  result.rows = result.rows
    .filter((row) => !duplicateIds.has(row.contactSfId))
    .map(({ contactSfId, studentName, studentEmail, classBlock, _row }) => ({
      contactSfId,
      studentName,
      studentEmail,
      classBlock,
      _row,
    }));

  return result;
}

/**
 * Cross-file check (SPEC.md §8): a student naming a class block the class
 * schedule does not define. A warning at parse time — the class schedule may
 * simply not be uploaded yet — which becomes the `class block not found`
 * unassigned reason at scheduling (SPEC.md §5.3).
 */
export function checkStudentClassBlocks(fileName, rows, classBlocks) {
  const warnings = [];
  const known = new Set((classBlocks || []).map((block) => block.id));
  if (known.size === 0) return warnings;
  const names = (classBlocks || []).map((block) => block.name).join(', ');
  rows.forEach((row) => {
    if (known.has(classBlockKey(row.classBlock))) return;
    addIssue(
      warnings,
      fileName,
      row._row,
      `Class block "${row.classBlock}" is not in the class schedule, so this student cannot be scheduled. Known class blocks: ${names}.`
    );
  });
  return warnings;
}

// ---- The previous run's appointments export (SPEC.md §19.1) ----
//
// Modify-existing mode reads back the appointments file an earlier run wrote
// (§7.1), so the columns expected here are that file's default columns. Only
// the ones the schedule is rebuilt from are required; the rest are read when
// present and ignored when not, which is what lets a file written with a
// §7.2 custom layout still be used as long as it kept the columns that say
// who met whom, and when.

/** Canonical header → the alternative spellings accepted for it. */
const APPOINTMENT_HEADER_ALIASES = {
  'contact sf id (student)': ['contact sf id', 'student contact sf id'],
  'meeting start date & time': ['meeting start date and time', 'meeting start', 'start date & time'],
  'meeting end date & time': ['meeting end date and time', 'meeting end', 'end date & time'],
};

const EXISTING_APPOINTMENT_COLUMNS = [
  'Student Name',
  'Contact SF ID (Student)',
  'Student Email',
  'Coach Name',
  'Coach SF ID',
  'Coach Email',
  'Meeting Start Date & Time',
  'Meeting End Date & Time',
];

/**
 * Rewrites accepted header spellings to the canonical ones, so the row parser
 * below has exactly one name to look each column up by. A file that already
 * uses the canonical header is returned unchanged.
 */
function canonicaliseAppointmentHeaders(sheetRows) {
  if (!sheetRows || sheetRows.length === 0) return sheetRows;
  const header = (sheetRows[0] || []).map((cell) => String(cell ?? '').trim());
  const present = new Set(header.map((cell) => cell.toLowerCase()));
  const rewritten = header.map((cell) => {
    const lower = cell.toLowerCase();
    const canonical = Object.keys(APPOINTMENT_HEADER_ALIASES).find(
      (name) => !present.has(name) && APPOINTMENT_HEADER_ALIASES[name].includes(lower)
    );
    return canonical ? canonical : cell;
  });
  return [rewritten, ...sheetRows.slice(1)];
}

const ISO_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?/;

function pad(value, width = 2) {
  return String(value).padStart(width, '0');
}

/**
 * One `Meeting Start/End Date & Time` cell, as the campus wall-clock date and
 * minute it names (SPEC.md §7.1 writes these as offset-bearing local times, so
 * the naive half of the value *is* the campus clock and needs no conversion).
 * Excel date values and serials are accepted too, for a file that has been
 * through a spreadsheet's own formatting.
 */
function parseDateTimeValue(raw) {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return {
      date: `${raw.getFullYear()}-${pad(raw.getMonth() + 1)}-${pad(raw.getDate())}`,
      minutes: raw.getHours() * 60 + raw.getMinutes(),
    };
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    // Excel serial: whole days since 1899-12-30, fraction of a day for the time.
    const days = Math.floor(raw);
    const minutes = Math.round((raw - days) * 24 * 60);
    const date = new Date(Date.UTC(1899, 11, 30));
    date.setUTCDate(date.getUTCDate() + days);
    return {
      date: `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`,
      minutes,
    };
  }
  if (typeof raw === 'string') {
    const match = ISO_DATE_TIME.exec(raw.trim());
    if (!match) return null;
    const [, year, month, day, hours, minutes] = match;
    if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > 31) return null;
    if (Number(hours) > 23 || Number(minutes) > 59) return null;
    return { date: `${year}-${month}-${day}`, minutes: Number(hours) * 60 + Number(minutes) };
  }
  return null;
}

/** The weekday a `YYYY-MM-DD` date falls on. */
function dayOfIsoDate(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return null;
  return DAY_NAMES[(date.getDay() + 6) % 7];
}

function optionalText(raw, headerIndex, columnName) {
  const column = headerIndex[columnName.toLowerCase()];
  if (column === undefined) return '';
  const value = raw[column];
  return isBlank(value) ? '' : String(value).trim();
}

function parseExistingAppointmentRow(raw, rowNumber, headerIndex, fileName, errors) {
  const studentName = requiredText(raw, headerIndex, 'Student Name', rowNumber, fileName, errors);
  const contactSfId = requiredText(raw, headerIndex, 'Contact SF ID (Student)', rowNumber, fileName, errors);
  const studentEmail = requiredEmail(raw, headerIndex, 'Student Email', rowNumber, fileName, errors);
  const coachName = requiredText(raw, headerIndex, 'Coach Name', rowNumber, fileName, errors);
  const coachSfId = requiredText(raw, headerIndex, 'Coach SF ID', rowNumber, fileName, errors);
  const coachEmail = requiredEmail(raw, headerIndex, 'Coach Email', rowNumber, fileName, errors);

  const startRaw = raw[headerIndex['meeting start date & time']];
  const endRaw = raw[headerIndex['meeting end date & time']];
  let start = null;
  let end = null;

  if (isBlank(startRaw)) {
    addIssue(errors, fileName, rowNumber, 'Missing Meeting Start Date & Time value.');
  } else {
    start = parseDateTimeValue(startRaw);
    if (start === null) {
      addIssue(
        errors,
        fileName,
        rowNumber,
        `Could not understand Meeting Start Date & Time "${String(startRaw).trim()}". Use the exported form, 2026-09-07T09:00:00+01:00.`
      );
    }
  }
  if (isBlank(endRaw)) {
    addIssue(errors, fileName, rowNumber, 'Missing Meeting End Date & Time value.');
  } else {
    end = parseDateTimeValue(endRaw);
    if (end === null) {
      addIssue(
        errors,
        fileName,
        rowNumber,
        `Could not understand Meeting End Date & Time "${String(endRaw).trim()}". Use the exported form, 2026-09-07T10:00:00+01:00.`
      );
    }
  }

  if (start && end) {
    if (start.date !== end.date) {
      addIssue(errors, fileName, rowNumber, 'A meeting must start and end on the same day.');
      end = null;
    } else if (end.minutes <= start.minutes) {
      addIssue(errors, fileName, rowNumber, 'Meeting End Date & Time must be after Meeting Start Date & Time.');
      end = null;
    }
  }

  const day = start ? dayOfIsoDate(start.date) : null;
  if (start && day === null) {
    addIssue(errors, fileName, rowNumber, `"${start.date}" is not a real date.`);
  }

  if (
    studentName === null ||
    contactSfId === null ||
    studentEmail === null ||
    coachName === null ||
    coachSfId === null ||
    coachEmail === null ||
    !start ||
    !end ||
    day === null
  ) {
    return null;
  }

  return {
    studentName,
    contactSfId,
    studentEmail,
    classBlock: optionalText(raw, headerIndex, 'Class Block'),
    serviceName: optionalText(raw, headerIndex, 'Service Name'),
    coachName,
    coachSfId,
    coachEmail,
    date: start.date,
    day,
    start: start.minutes,
    end: end.minutes,
    _row: rowNumber,
  };
}

/**
 * Whole-file checks on a previous run's export: one student is one person, so
 * rows that disagree about their name, email or coach are named rather than
 * silently resolved to whichever row came first.
 */
function finishExistingAppointments(fileName, result) {
  const seen = new Map();
  result.rows.forEach((row) => {
    const first = seen.get(row.contactSfId);
    if (!first) {
      seen.set(row.contactSfId, row);
      return;
    }
    [
      ['Student Name', 'studentName'],
      ['Student Email', 'studentEmail'],
      ['Coach Name', 'coachName'],
    ].forEach(([label, field]) => {
      if (row[field] === first[field]) return;
      addIssue(
        result.warnings,
        fileName,
        row._row,
        `Contact SF ID "${row.contactSfId}" has two different ${label} values: "${first[field]}" (row ${first._row}) and "${row[field]}" (row ${row._row}). The first is used.`
      );
    });
    if (row.date === first.date && row.start === first.start && row.coachName === first.coachName) {
      addIssue(
        result.warnings,
        fileName,
        row._row,
        `${row.studentName} has the same meeting twice: ${row.date} at ${minutesToTime(row.start)} (rows ${first._row} and ${row._row}).`
      );
    }
  });
  return result;
}

/** The previous-export rules applied to an already-read sheet (see parseSheetRows). */
export function parseExistingAppointmentsSheet(fileName, sheetRows) {
  return finishExistingAppointments(
    fileName,
    parseSheetRows(
      fileName,
      canonicaliseAppointmentHeaders(sheetRows),
      EXISTING_APPOINTMENT_COLUMNS,
      parseExistingAppointmentRow
    )
  );
}

export async function parseExistingAppointments(file) {
  const fileName = file.name;
  let sheetRows;
  try {
    sheetRows = await readSheetRows(file);
  } catch (e) {
    if (e && e.code === XLSX_MISSING) throw e;
    return {
      rows: [],
      errors: [
        {
          file: fileName,
          row: null,
          message: `Could not read this file. Make sure it is a valid .xlsx file saved from Excel. (${describeError(e)})`,
        },
      ],
      warnings: [],
    };
  }
  return parseExistingAppointmentsSheet(fileName, sheetRows);
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
