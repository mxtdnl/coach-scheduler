// iCalendar (RFC 5545) serialiser for the coach calendar export (SPEC.md §7.4).
//
// One .ics file per scheduled coaching meeting, each holding exactly one
// VEVENT. Everything here is pure and DOM-free, so tests.html can assert on
// the exact bytes that end up inside the ZIP.
//
// Times are never recalculated here. Every appointment already carries the
// campus-aware, offset-bearing instants the export uses
// (`startDateTime`/`endDateTime`, SPEC.md §7.1), and this module only converts
// those same instants into the UTC form iCalendar writes.

/** Identifies the software that produced the calendar (RFC 5545 §3.7.3). */
export const ICS_PRODID = '-//Term Scheduler//Coaching meetings//EN';

/** iCalendar content lines are CRLF-terminated (RFC 5545 §3.1). */
export const CRLF = '\r\n';

/**
 * Escapes a TEXT value (RFC 5545 §3.3.11): backslash, semicolon and comma are
 * escaped, and a real newline becomes a literal `\n`. Order matters —
 * backslashes first, or the escapes would be escaped again.
 *
 * This is what keeps a student called "Smith, Jr." or a campus written
 * "London; Bloomsbury" from silently splitting a property into two values.
 */
export function escapeIcsText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

const encoder = new TextEncoder();

/**
 * Folds one content line to 75 octets (RFC 5545 §3.1), continuing with a
 * leading space. The limit is in octets, not characters, and a multi-byte
 * character may not be split across a fold, so this measures each character's
 * UTF-8 length as it goes.
 */
export function foldIcsLine(line) {
  const text = String(line ?? '');
  if (encoder.encode(text).length <= 75) return text;

  const out = [];
  let current = '';
  let bytes = 0;
  // Continuation lines start with a space, which counts towards their 75.
  let limit = 75;
  for (const char of text) {
    const size = encoder.encode(char).length;
    if (bytes + size > limit) {
      out.push(current);
      current = '';
      bytes = 1; // the leading space of the continuation line
      limit = 75;
    }
    current += char;
    bytes += size;
  }
  out.push(current);
  return out.join(`${CRLF} `);
}

/** Joins content lines into a folded, CRLF-terminated iCalendar body. */
export function serialiseIcsLines(lines) {
  return `${lines.filter((line) => line !== null && line !== undefined && line !== '').map(foldIcsLine).join(CRLF)}${CRLF}`;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * An offset-bearing ISO instant (`2026-09-16T12:00:00+01:00`, as produced by
 * timezone.js and stored on every appointment) as an iCalendar UTC date-time:
 * `20260916T110000Z`.
 *
 * UTC form is used deliberately. It is the one date-time representation RFC
 * 5545 defines that needs no VTIMEZONE component to be unambiguous, and it is
 * derived from the very instant the appointments export writes — so the
 * calendar entry and the spreadsheet row can never disagree, including either
 * side of a daylight saving change. The campus zone still travels with the
 * calendar, as `X-WR-TIMEZONE`, so a calendar client shows the meeting in
 * campus local time.
 */
export function icsUtcStamp(isoWithOffset) {
  const ms = Date.parse(String(isoWithOffset ?? ''));
  if (!Number.isFinite(ms)) {
    throw new Error(`"${isoWithOffset}" is not a date and time this calendar export can read.`);
  }
  const date = new Date(ms);
  return (
    `${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}` +
    `T${pad2(date.getUTCHours())}${pad2(date.getUTCMinutes())}${pad2(date.getUTCSeconds())}Z`
  );
}

/** A Date as an iCalendar UTC date-time, for DTSTAMP. */
export function icsUtcStampFromDate(date) {
  const value = date instanceof Date && Number.isFinite(date.getTime()) ? date : new Date();
  return icsUtcStamp(value.toISOString());
}

/**
 * A name reduced to the characters that are safe and readable in a file name
 * or a UID. Accented letters are kept as-is only when they survive the filter;
 * everything else collapses to a hyphen, so two different names can still
 * collide — which is why file names are de-duplicated (zip.js) and UIDs carry
 * the meeting's own date, time and number.
 */
export function slugify(value, fallback = 'unknown') {
  const slug = String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining accents
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .toLowerCase();
  return slug === '' ? fallback : slug;
}

/**
 * A meeting's UID (RFC 5545 §3.8.4.7): unique per meeting and deterministic,
 * so re-exporting the same schedule updates the same calendar entries rather
 * than creating duplicates. Built from the values that identify the meeting —
 * the student, the meeting number, the instant, and the coach.
 */
export function meetingUid(appointment) {
  const student = slugify(appointment?.contactSfId || appointment?.studentName, 'student');
  const coach = slugify(appointment?.coachName, 'coach');
  const stamp = icsUtcStamp(appointment?.startDateTime);
  const meeting = Number(appointment?.meetingNumber) || 0;
  return `${student}-meeting-${meeting}-${stamp}-${coach}@term-scheduler`;
}

/** "Jane Doe — Coaching 1 - Meeting 2": who, and which of the four meetings. */
export function meetingSummary(appointment) {
  const student = appointment?.studentName || 'Student';
  const service = appointment?.serviceName || 'Coaching';
  return `${student} — ${service}`;
}

/** The DESCRIPTION body: the context a coach needs when the event is opened. */
export function meetingDescription(appointment, options = {}) {
  const lines = [`Coaching meeting with ${appointment?.studentName || 'the student'}.`];
  if (appointment?.studentEmail) lines.push(`Student email: ${appointment.studentEmail}`);
  if (appointment?.contactSfId) lines.push(`Contact SF ID: ${appointment.contactSfId}`);
  if (appointment?.classBlock) lines.push(`Class block: ${appointment.classBlock}`);
  if (appointment?.coachName) lines.push(`Coach: ${appointment.coachName}`);
  if (appointment?.weekNumber) lines.push(`Term week: ${appointment.weekNumber}`);
  if (appointment?.rescheduledFromWeek !== '' && appointment?.rescheduledFromWeek !== undefined && appointment?.rescheduledFromWeek !== null) {
    lines.push(`Moved from week ${appointment.rescheduledFromWeek}.`);
  }
  if (options.timeZone) lines.push(`Times are ${options.timeZone} local time.`);
  return lines.join('\n');
}

/**
 * One meeting as a complete .ics file: a VCALENDAR containing exactly one
 * VEVENT.
 *
 * @param {object} appointment a row from the final schedule (SPEC.md §7.1)
 * @param {{campusLabel?:string, timeZone?:string, dtstamp?:Date, prodId?:string}} [options]
 * @returns {string} the file's text, CRLF-terminated throughout
 */
export function buildMeetingIcs(appointment, options = {}) {
  if (!appointment) throw new Error('There is no meeting to turn into a calendar file.');

  const dtstamp = icsUtcStampFromDate(options.dtstamp);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${escapeIcsText(options.prodId || ICS_PRODID)}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  // The campus zone (SPEC.md §6.1) travels with the file, so a client shows
  // the meeting in campus local time even though the instants are in UTC.
  if (options.timeZone) lines.push(`X-WR-TIMEZONE:${escapeIcsText(options.timeZone)}`);
  lines.push(
    'BEGIN:VEVENT',
    `UID:${escapeIcsText(meetingUid(appointment))}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${icsUtcStamp(appointment.startDateTime)}`,
    `DTEND:${icsUtcStamp(appointment.endDateTime)}`,
    `SUMMARY:${escapeIcsText(meetingSummary(appointment))}`,
    `DESCRIPTION:${escapeIcsText(meetingDescription(appointment, options))}`
  );
  if (options.campusLabel) lines.push(`LOCATION:${escapeIcsText(options.campusLabel)}`);
  lines.push('STATUS:CONFIRMED', 'TRANSP:OPAQUE', 'END:VEVENT', 'END:VCALENDAR');

  return serialiseIcsLines(lines);
}

/**
 * The file name for one meeting's .ics: date, start time and student, so the
 * files sort chronologically inside the archive and are readable on sight.
 * Deterministic — the same meeting always produces the same name. Collisions
 * are resolved when the archive is built (zip.js `dedupeEntryNames`).
 */
export function icsFileNameForMeeting(appointment) {
  const date = String(appointment?.date || '').replace(/[^0-9-]/g, '') || 'undated';
  const time = String(appointment?.startTime || '').replace(':', '') || '0000';
  const student = slugify(appointment?.studentName, 'student');
  const meeting = Number(appointment?.meetingNumber) || 0;
  return `${date}_${time}_${student}_meeting-${meeting}.ics`;
}

/**
 * True when an appointment carries the instants an event needs. A row without
 * them cannot become a calendar entry, and inventing one would put a meeting
 * in a coach's diary that the schedule does not contain.
 */
export function isExportableMeeting(appointment) {
  if (!appointment) return false;
  return Number.isFinite(Date.parse(appointment.startDateTime)) && Number.isFinite(Date.parse(appointment.endDateTime));
}
