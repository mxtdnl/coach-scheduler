// Default + custom-mapped Excel export (SPEC.md §7).
//
// An export "mapping" is an ordered array of column definitions:
//   { id, type: 'field', field: <appointment field name>, header, included }
//   { id, type: 'constant', header, value, included }
// Column order in the array is column order in the output. `included`
// controls inclusion without losing the column's configuration, so a user
// can re-include it later without re-entering a header/value.

const XLSX = window.XLSX;

/** Human labels for the §7.1 appointment fields, shown in the mapping editor. */
export const FIELD_LABELS = {
  contactSfId: 'Contact SF ID',
  studentName: 'Student Name',
  coachName: 'Coach Name',
  coachId: 'Coach ID',
  meetingNumber: 'Meeting Number',
  weekNumber: 'Week Number',
  date: 'Date',
  day: 'Day',
  startTime: 'Start Time',
  endTime: 'End Time',
  durationMins: 'Duration (mins)',
};

const DEFAULT_MAPPING = Object.keys(FIELD_LABELS).map((field) => ({
  id: field,
  type: 'field',
  field,
  header: FIELD_LABELS[field],
  included: true,
}));

const NUMERIC_FIELDS = new Set(['meetingNumber', 'weekNumber', 'durationMins']);

/** A fresh copy of the §7.1 default mapping — safe to mutate. */
export function getDefaultMapping() {
  return DEFAULT_MAPPING.map((col) => ({ ...col }));
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

/**
 * Builds the workbook rows for export: the Date column carries a real JS
 * Date (so SheetJS writes a true Excel date) plus an explicit `yyyy-mm-dd`
 * number format, per SPEC.md §7.1 ("also stored as a real Excel date").
 */
function buildWorkbookAoa(appointments, columns) {
  const header = columns.map((col) => col.header);
  const rows = (appointments || []).map((row) =>
    columns.map((col) => {
      if (col.type === 'constant') return col.value ?? '';
      const value = valueForField(col.field, row);
      if (col.field === 'date') return value;
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
  const columns = (mapping && mapping.length ? mapping : getDefaultMapping()).filter((col) => col.included);
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

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Appointments');

  const filename = buildExportFilename();
  XLSX.writeFile(workbook, filename);
  return filename;
}
