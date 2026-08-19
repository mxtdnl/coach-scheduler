// Default + custom-mapped Excel export (SPEC.md §7).
//
// An export "mapping" is an ordered array of column definitions:
//   { id, type: 'field', field: <appointment field name>, header, included }
//   { id, type: 'constant', header, value, included }
// Column order in the array is column order in the output. `included`
// controls inclusion without losing the column's configuration, so a user
// can re-include it later without re-entering a header/value.

import { getXLSX } from './xlsx-loader.js';
import { buildCalendarIcs, isExportableMeeting, slugify } from './ics.js';

/**
 * The §7.1 default columns, in export order. Everything here is included by
 * default; the fields below this list are still selectable in the mapping
 * editor but start excluded.
 */
const DEFAULT_FIELDS = [
  ['studentName', 'Student Name'],
  ['contactSfId', 'Contact SF ID (Student)'],
  ['studentEmail', 'Student Email'],
  ['serviceName', 'Service Name'],
  ['coachName', 'Coach Name'],
  ['coachSfId', 'Coach SF ID'],
  ['coachEmail', 'Coach Email'],
  ['startDateTime', 'Meeting Start Date & Time'],
  ['endDateTime', 'Meeting End Date & Time'],
  ['meetingStatus', 'Meeting Status'],
  // Appended to the §7.1 defaults by SPEC.md §11.4: blank unless the blocking
  // post-pass moved the row, in which case it carries the week it moved from.
  ['rescheduledFromWeek', 'Rescheduled From Week'],
];

/**
 * Fields the schedule still carries but which the default export no longer
 * needs. Kept selectable so §7.2 customisation loses no capability — the
 * naive date/time columns in particular remain useful for eyeballing a run.
 */
const OPTIONAL_FIELDS = [
  // The student's class block (SPEC.md §3.1). Off by default so the §7.1
  // column set is unchanged, but available for anyone who wants the cohort
  // named in the output.
  ['classBlock', 'Class Block'],
  ['meetingNumber', 'Meeting Number'],
  ['weekNumber', 'Week Number'],
  ['date', 'Date'],
  ['day', 'Day'],
  ['startTime', 'Start Time'],
  ['endTime', 'End Time'],
  ['durationMins', 'Duration (mins)'],
];

/** Human labels for the appointment fields, shown in the mapping editor. */
export const FIELD_LABELS = Object.fromEntries([...DEFAULT_FIELDS, ...OPTIONAL_FIELDS]);

const DEFAULT_MAPPING = [
  ...DEFAULT_FIELDS.map(([field, header]) => ({ id: field, type: 'field', field, header, included: true })),
  ...OPTIONAL_FIELDS.map(([field, header]) => ({ id: field, type: 'field', field, header, included: false })),
];

const NUMERIC_FIELDS = new Set(['meetingNumber', 'weekNumber', 'durationMins']);

/** A fresh copy of the §7.1 default mapping — safe to mutate. */
export function getDefaultMapping() {
  return DEFAULT_MAPPING.map((col) => ({ ...col }));
}

/**
 * Validates a mapping restored from localStorage (SPEC.md §7.2). A payload
 * left over from an older version — or hand-edited — must not silently
 * produce an export with blank or missing columns, so anything that is not a
 * recognisable column definition is dropped, and a mapping with nothing
 * usable left returns null so the caller can fall back to the defaults.
 */
export function sanitiseMapping(mapping) {
  if (!Array.isArray(mapping) || mapping.length === 0) return null;

  const cleaned = mapping
    .filter((col) => col && typeof col === 'object')
    .map((col, i) => {
      if (col.type === 'constant') {
        return {
          id: typeof col.id === 'string' ? col.id : `constant-restored-${i}`,
          type: 'constant',
          header: String(col.header ?? ''),
          value: String(col.value ?? ''),
          included: col.included !== false,
        };
      }
      if (col.type === 'field' && Object.prototype.hasOwnProperty.call(FIELD_LABELS, col.field)) {
        return {
          id: col.field,
          type: 'field',
          field: col.field,
          header: String(col.header ?? FIELD_LABELS[col.field]),
          included: col.included !== false,
        };
      }
      return null;
    })
    .filter(Boolean);

  return cleaned.length > 0 ? cleaned : null;
}

let constantSeq = 0;

/** A new blank constant column (fixed header + fixed value on every row). */
export function createConstantColumn(header = '', value = '') {
  constantSeq += 1;
  return { id: `constant-${Date.now()}-${constantSeq}`, type: 'constant', header, value, included: true };
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** appointments_YYYY-MM-DD_HHMM.xlsx, using the generation timestamp (SPEC.md §7.1). */
export function buildExportFilename(now = new Date()) {
  const y = now.getFullYear();
  const m = pad2(now.getMonth() + 1);
  const d = pad2(now.getDate());
  const hh = pad2(now.getHours());
  const mm = pad2(now.getMinutes());
  return `appointments_${y}-${m}-${d}_${hh}${mm}.xlsx`;
}

/** coach_assignments_YYYY-MM-DD_HHMM.xlsx (SPEC.md §7.3). */
export function buildCoachAssignmentsFilename(now = new Date()) {
  const y = now.getFullYear();
  const m = pad2(now.getMonth() + 1);
  const d = pad2(now.getDate());
  const hh = pad2(now.getHours());
  const mm = pad2(now.getMinutes());
  return `coach_assignments_${y}-${m}-${d}_${hh}${mm}.xlsx`;
}

function valueForField(field, row) {
  if (field === 'date') return row.dateValue;
  const value = row[field];
  return value === undefined || value === null ? '' : value;
}

/**
 * Preview rows for the on-screen table (SPEC.md §6, §7.2): plain strings,
 * respecting the current mapping's order, headers, inclusion, and constants.
 */
export function buildPreviewRows(appointments, mapping, limit = 50) {
  const columns = (mapping || []).filter((col) => col.included);
  const rows = (appointments || []).slice(0, limit).map((row) =>
    columns.map((col) => {
      if (col.type === 'constant') return col.value ?? '';
      if (col.field === 'date') return row.date; // ISO display string
      const value = row[col.field];
      return value === undefined || value === null ? '' : String(value);
    })
  );
  return { columns, rows };
}

/** Columns whose value is an offset-bearing ISO string, written as text. */
const DATETIME_FIELDS = new Set(['startDateTime', 'endDateTime']);

/**
 * Builds the workbook rows for export.
 *
 * The Meeting Start/End Date & Time columns are written as **text**, not as
 * Excel date values. This is deliberate: an Excel date serial is a bare
 * number with no timezone, so storing one would silently discard the
 * `+01:00` / `-04:00` offset that SPEC.md §7.1 requires — and Excel would
 * then re-render the instant in whoever's local settings opened the file.
 * The optional legacy Date column keeps its real-Excel-date behaviour, since
 * a naive calendar day has no offset to lose.
 */
function buildWorkbookAoa(appointments, columns) {
  const header = columns.map((col) => col.header);
  const rows = (appointments || []).map((row) =>
    columns.map((col) => {
      if (col.type === 'constant') return col.value ?? '';
      const value = valueForField(col.field, row);
      if (col.field === 'date') return value;
      // Blank on every row that was never moved (§11.4), so it stays an empty
      // cell rather than becoming a misleading 0.
      if (col.field === 'rescheduledFromWeek') return value === '' ? '' : Number(value);
      if (NUMERIC_FIELDS.has(col.field)) return Number(value);
      return value === '' ? '' : String(value);
    })
  );
  return [header, ...rows];
}

/**
 * Generates the export workbook and triggers a download via SheetJS.
 * Returns the filename used.
 */
export function exportAppointments(appointments, mapping) {
  const XLSX = getXLSX();
  const columns = (mapping && mapping.length ? mapping : getDefaultMapping()).filter((col) => col.included);
  if (columns.length === 0) {
    throw new Error('Every column is excluded. Include at least one column in Export settings.');
  }
  if (!appointments || appointments.length === 0) {
    throw new Error('There are no appointments to export.');
  }
  const aoa = buildWorkbookAoa(appointments, columns);
  const worksheet = XLSX.utils.aoa_to_sheet(aoa);

  // aoa_to_sheet already turns each Date into a real Excel date serial (a
  // numeric cell, t:'n', which is what makes it a true Excel date) but
  // defaults its display format to the locale-dependent "m/d/yy" — override
  // it to the ISO display format required by SPEC.md §7.1.
  const dateColIndex = columns.findIndex((col) => col.type === 'field' && col.field === 'date');
  if (dateColIndex !== -1) {
    for (let r = 1; r < aoa.length; r++) {
      const address = XLSX.utils.encode_cell({ r, c: dateColIndex });
      const cell = worksheet[address];
      if (cell) cell.z = 'yyyy-mm-dd';
    }
  }

  // Pin the ISO datetime columns to text cells. SheetJS already infers 's'
  // for a string, but stating it here means a future change to the value
  // shape cannot quietly turn these into numbers and lose the offset.
  columns.forEach((col, c) => {
    if (col.type !== 'field' || !DATETIME_FIELDS.has(col.field)) return;
    for (let r = 1; r < aoa.length; r++) {
      const cell = worksheet[XLSX.utils.encode_cell({ r, c })];
      if (cell) {
        cell.t = 's';
        delete cell.z;
      }
    }
  });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Appointments');

  const filename = buildExportFilename();
  XLSX.writeFile(workbook, filename);
  return filename;
}

// ---- SPEC.md §7.3 — coach-assignments batch upload (auto-assign only) ----
//
// A fixed eight-column integration format, deliberately kept out of the §7.2
// mapping editor: the receiving batch-upload template matches on header text
// and constant values, so a user's renamed/reordered appointment columns must
// not be able to reshape this file. One row per scheduled student, never one
// per meeting.

/** The eight headers, in the exact required order (SPEC.md §7.3). */
export const COACH_ASSIGNMENT_HEADERS = Object.freeze([
  'Student Name',
  'Student Contact SF ID',
  'Record Type',
  'Record Type Name',
  'Type',
  'Coach Name',
  'Coach User ID',
  'Status',
]);

/** The constant values written on every row (SPEC.md §7.3). */
export const COACH_ASSIGNMENT_CONSTANTS = Object.freeze({
  recordType: '0121Q000001Dw6tQAC',
  recordTypeName: 'Institutional Relations',
  type: 'coach',
  status: 'current',
});

/**
 * The coach's Salesforce id for an assignment. `Coach User ID` is an export
 * header only: the underlying value is the `Coach SF ID` parsed from the
 * availability file (SPEC.md §3.2), carried onto every slot by `buildSlots`,
 * so there is no second input field and no second source of truth.
 */
function coachSfIdOf(assignment) {
  const raw = assignment?.slot?.coachSfId;
  return raw === undefined || raw === null ? '' : String(raw).trim();
}

/**
 * The student's Salesforce contact id for an assignment (SPEC.md §3.3). Like
 * `Coach User ID`, this is an existing input value rather than a new one: the
 * student list already requires a non-blank, unique `Contact SF ID` on every
 * row (§8), so the parser is the only validation this column needs and the
 * export has no refusal path of its own for it.
 */
function contactSfIdOf(student) {
  const raw = student?.contactSfId;
  return raw === undefined || raw === null ? '' : String(raw).trim();
}

/**
 * Coaches in the final schedule whose Coach SF ID is missing or blank, in
 * first-assignment order. The parser already rejects a blank Coach SF ID
 * (SPEC.md §8) and a coach whose rows disagree, so this is a last line of
 * defence rather than a second rule — but exporting a blank `Coach User ID`
 * would silently produce an unusable batch upload, so the export refuses
 * instead (SPEC.md §7.3).
 */
export function findCoachesWithoutSfId(assignments) {
  const bad = [];
  const seen = new Set();
  (assignments || []).forEach((assignment) => {
    const coach = assignment?.coach ?? assignment?.slot?.coach ?? '';
    if (seen.has(coach)) return;
    if (coachSfIdOf(assignment) !== '') return;
    seen.add(coach);
    bad.push(coach);
  });
  return bad;
}

/** The §7.3 refusal message for coaches with no usable Coach SF ID. */
export function coachSfIdErrorMessage(coaches) {
  const names = coaches.map((name) => `"${name || '(unnamed coach)'}"`).join(', ');
  return coaches.length === 1
    ? `Coach ${names} has no Coach SF ID, so Coach User ID would be blank. Add the Coach SF ID to the coach availability file and upload it again.`
    : `These coaches have no Coach SF ID, so Coach User ID would be blank: ${names}. Add the Coach SF ID values to the coach availability file and upload it again.`;
}

/**
 * One row per scheduled student (SPEC.md §7.3), built from the scheduler's
 * `assignments` — the authoritative final student → coach mapping. Meetings
 * are irrelevant here: a student with four meetings still gets one row, and
 * a student whose meeting was displaced or turned into an exception by the
 * §11.3 blocking post-pass keeps their row, because that post-pass never
 * changes a student's coach. Unassigned students are not in `assignments`,
 * so they are excluded by construction.
 *
 * Order is the scheduler's own assignment order (student file order in auto
 * mode), so identical inputs give an identical file.
 *
 * @param {Array<{student:object, coach:string, slot:object}>} assignments
 * @returns {Array<{studentName, contactSfId, recordType, recordTypeName, type, coachName, coachUserId, status}>}
 */
export function buildCoachAssignmentRows(assignments) {
  const rows = [];
  const seenStudents = new Set();
  (assignments || []).forEach((assignment) => {
    const student = assignment?.student;
    if (!student) return;
    // Belt and braces against a duplicate row for one student/coach pair: the
    // engine assigns each student at most once, and the key is the student's
    // unique Contact SF ID (SPEC.md §3.3) where one exists.
    const key = student.contactSfId || student.studentName || '';
    if (seenStudents.has(key)) return;
    seenStudents.add(key);
    rows.push({
      studentName: student.studentName || '',
      contactSfId: contactSfIdOf(student),
      recordType: COACH_ASSIGNMENT_CONSTANTS.recordType,
      recordTypeName: COACH_ASSIGNMENT_CONSTANTS.recordTypeName,
      type: COACH_ASSIGNMENT_CONSTANTS.type,
      coachName: assignment.coach ?? assignment.slot?.coach ?? '',
      coachUserId: coachSfIdOf(assignment),
      status: COACH_ASSIGNMENT_CONSTANTS.status,
    });
  });
  return rows;
}

/** The §7.3 workbook as an array of arrays: headers first, then one row per student. */
export function buildCoachAssignmentAoa(assignments) {
  const rows = buildCoachAssignmentRows(assignments).map((row) => [
    row.studentName,
    row.contactSfId,
    row.recordType,
    row.recordTypeName,
    row.type,
    row.coachName,
    row.coachUserId,
    row.status,
  ]);
  return [[...COACH_ASSIGNMENT_HEADERS], ...rows];
}

/**
 * Builds the §7.3 workbook without writing it, so the exact cells that reach
 * the file can be asserted in tests. Auto-assign only — the caller is
 * responsible for not offering the control in pre-allocated mode, and this
 * refuses as well so the rule holds however the function is reached.
 */
export function buildCoachAssignmentsWorkbook(assignments, mode = 'auto') {
  // Data problems are checked before SheetJS is touched, so a run with a
  // missing Coach SF ID reports that rather than an unrelated library error.
  // Auto-assign, and the modify-existing top-up that schedules by the same
  // rules (SPEC.md §19.6). Pre-allocated is refused: there the student→coach
  // mapping is the user's own pairings file.
  if (mode !== 'auto' && mode !== 'modify-existing') {
    throw new Error('The coach assignments export is only available in auto-assign mode.');
  }
  if (!assignments || assignments.length === 0) {
    throw new Error('There are no coach assignments to export.');
  }
  const missing = findCoachesWithoutSfId(assignments);
  if (missing.length > 0) {
    throw new Error(coachSfIdErrorMessage(missing));
  }

  const XLSX = getXLSX();
  const aoa = buildCoachAssignmentAoa(assignments);
  const worksheet = XLSX.utils.aoa_to_sheet(aoa);

  // Every cell is text. Salesforce ids such as 0121Q000001Dw6tQAC are opaque
  // 18-character strings; leaving a cell's type to inference risks Excel (or
  // a future SheetJS default) reading an all-digit id as a number and
  // rendering it in scientific notation or dropping its leading zeros.
  for (let r = 0; r < aoa.length; r++) {
    for (let c = 0; c < COACH_ASSIGNMENT_HEADERS.length; c++) {
      const cell = worksheet[XLSX.utils.encode_cell({ r, c })];
      if (cell) {
        cell.t = 's';
        cell.v = String(cell.v ?? '');
        delete cell.z;
      }
    }
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Coach Assignments');
  return workbook;
}

/**
 * Generates the coach-assignments batch upload (SPEC.md §7.3) and triggers a
 * download. Returns the filename used.
 */
export function exportCoachAssignments(assignments, mode = 'auto') {
  // Built first: it reports a data problem (wrong mode, nothing to export, a
  // missing Coach SF ID) before SheetJS is needed at all.
  const workbook = buildCoachAssignmentsWorkbook(assignments, mode);
  const XLSX = getXLSX();
  const filename = buildCoachAssignmentsFilename();
  XLSX.writeFile(workbook, filename);
  return filename;
}

// ---- SPEC.md §7.4 — coach calendar export (one .ics holding every meeting) ----
//
// A read-only view of the finished schedule in calendar form. It reads the
// same appointment rows the §7.1 export writes, so a coach's diary and the
// spreadsheet can never disagree, and it adds nothing to the schedule: a
// meeting that is not in `appointments` is not in the file.
//
// One file per coach, not one per meeting: the coach opens or imports a single
// download and their whole term appears in Outlook.

/** Every exportable meeting belonging to one coach, in the schedule's own order. */
export function coachMeetings(appointments, coachName) {
  return (appointments || []).filter((row) => row && row.coachName === coachName);
}

/**
 * `<coach-name>_calendar_YYYY-MM-DD_HHMM.ics` (SPEC.md §7.4), matching the
 * §7.1/§7.3 timestamp convention. The coach's name is slugified, so a name
 * with punctuation, spaces or accents cannot produce an awkward or unsafe
 * download name.
 */
export function buildCoachCalendarFilename(coachName, now = new Date()) {
  const y = now.getFullYear();
  const m = pad2(now.getMonth() + 1);
  const d = pad2(now.getDate());
  const hh = pad2(now.getHours());
  const mm = pad2(now.getMinutes());
  return `${slugify(coachName, 'coach')}_calendar_${y}-${m}-${d}_${hh}${mm}.ics`;
}

/**
 * The selected coach's meetings that can become calendar events, in
 * chronological order. Separate from the file building so the UI can enable or
 * disable its export control without serialising a single calendar.
 */
export function exportableCoachMeetings(appointments, coachName) {
  return coachMeetings(appointments, coachName)
    .filter(isExportableMeeting)
    .slice()
    .sort(
      (a, b) =>
        String(a.date).localeCompare(String(b.date)) ||
        String(a.startTime).localeCompare(String(b.startTime)) ||
        String(a.studentName).localeCompare(String(b.studentName))
    );
}

/**
 * The selected coach's whole term as one .ics file (SPEC.md §7.4): a single
 * VCALENDAR with one VEVENT per meeting, in chronological order, ready to be
 * saved. Pure — no DOM, no download, no mutation of the appointment rows — so
 * tests can assert on the exact text that is downloaded.
 *
 * Refuses a coach with no exportable meeting rather than handing over an empty
 * calendar, which imports as nothing at all.
 *
 * @param {Array<object>} appointments the final schedule
 * @param {string} coachName the selected coach
 * @param {{campusLabel?:string, timeZone?:string, dtstamp?:Date, now?:Date}} [options]
 * @returns {{content:string, filename:string, meetings:Array<object>}}
 */
export function buildCoachCalendar(appointments, coachName, options = {}) {
  if (!coachName) {
    throw new Error('Choose a coach before exporting a calendar.');
  }
  const meetings = exportableCoachMeetings(appointments, coachName);
  if (meetings.length === 0) {
    throw new Error(`${coachName} has no scheduled meetings, so there is nothing to export.`);
  }
  const now = options.now instanceof Date ? options.now : new Date();
  return {
    content: buildCalendarIcs(meetings, { calendarName: `${coachName} — coaching meetings`, ...options }),
    filename: buildCoachCalendarFilename(coachName, now),
    meetings,
  };
}

/**
 * Hands the browser a generated file to save. Used by the calendar export; the
 * Excel exports go through SheetJS's own writeFile, which does the same thing
 * internally.
 */
function downloadBytes(bytes, filename, mimeType) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked on the next tick: revoking synchronously can cancel the download
  // in some browsers before it has read the blob.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Generates the selected coach's calendar file and triggers the download
 * (SPEC.md §7.4). Returns the filename used.
 *
 * The file is written as UTF-8 text under the `text/calendar` type, which is
 * what makes a browser hand it to Outlook rather than open it as a document.
 */
export function exportCoachCalendar(appointments, coachName, options = {}) {
  const { content, filename } = buildCoachCalendar(appointments, coachName, options);
  downloadBytes(new TextEncoder().encode(content), filename, 'text/calendar;charset=utf-8');
  return filename;
}
