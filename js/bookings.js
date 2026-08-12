// Results booking views (SPEC.md §14) — pure view models, no DOM.
//
// Both views are built from the *final* schedule: the appointment rows that
// come out of expandToAppointments and the §11.3 blocking post-pass, plus the
// scheduler's own `assignments`/`unassigned` structures. Nothing here keeps a
// second copy of the schedule, and nothing here recalculates a date, a time or
// a coach — a booking view that could disagree with the export would be worse
// than no booking view at all.

import { expandClassSessions, classBlockKey, blockOfWeek } from './scheduler.js';

/** Chronological order: date, then start time, then a stable tiebreak. */
function byDateTime(tiebreak) {
  return (a, b) =>
    String(a.date).localeCompare(String(b.date)) ||
    String(a.startTime).localeCompare(String(b.startTime)) ||
    tiebreak(a, b);
}

/**
 * The coaches a booking view can offer: every coach in the run, in coach-file
 * order, so a coach who ended up with no meetings is still selectable and can
 * be shown their (empty) diary rather than vanishing from the list.
 *
 * @param {Array<string>} coaches coach names from the availability file
 * @param {Array<object>} appointments the final schedule
 */
export function bookingCoaches(coaches, appointments) {
  const names = [...(coaches || [])];
  (appointments || []).forEach((row) => {
    if (row.coachName && !names.includes(row.coachName)) names.push(row.coachName);
  });
  return names;
}

/**
 * One coach's bookings (SPEC.md §14.1): every scheduled meeting that coach
 * has, in chronological order, with the totals that answer "who am I meeting,
 * and how much of my term is this?".
 *
 * Rows are the appointment objects themselves — the same objects the
 * appointments export writes — not copies with re-derived values.
 *
 * @param {Array<object>} appointments the final schedule
 * @param {string} coachName
 * @returns {{coach:string, rows:Array<object>, studentCount:number,
 *            meetingCount:number, students:Array<{contactSfId:string, studentName:string,
 *            classBlock:string, meetingCount:number}>}}
 */
export function buildCoachBookings(appointments, coachName) {
  const coach = coachName ?? '';
  const rows = (appointments || [])
    .filter((row) => row && row.coachName === coach)
    .slice()
    .sort(byDateTime((a, b) => String(a.studentName).localeCompare(String(b.studentName))));

  const students = [];
  const byStudent = new Map();
  rows.forEach((row) => {
    const key = row.contactSfId || row.studentName || '';
    if (!byStudent.has(key)) {
      const entry = {
        contactSfId: row.contactSfId || '',
        studentName: row.studentName || '',
        classBlock: row.classBlock || '',
        meetingCount: 0,
      };
      byStudent.set(key, entry);
      students.push(entry);
    }
    byStudent.get(key).meetingCount += 1;
  });

  return { coach, rows, students, studentCount: students.length, meetingCount: rows.length };
}

/** The class block a student belongs to, or null when it is missing/unknown. */
export function classBlockForStudent(classBlocks, student) {
  const key = classBlockKey(student?.classBlock);
  if (!key) return null;
  return (classBlocks || []).find((block) => block.id === key) || null;
}

/**
 * One student's whole term (SPEC.md §14.2): their class sessions and their
 * coaching meetings on a single chronological timeline, plus who their coach
 * is and whether anything about them is exceptional.
 *
 * Only the student's **own** class block is expanded. Another cohort's classes
 * are irrelevant to them (§4.4a) and showing them would be a plain factual
 * error about that student's week.
 *
 * Unassigned students are handled by telling the truth: their classes still
 * appear, their coaching list is empty, and the reason the scheduler gave is
 * carried through. No appointment is ever invented.
 *
 * @param {object} student a student row from the student list
 * @param {{appointments:Array<object>, assignments:Array<object>,
 *          unassigned:Array<{student:object, reason:string}>,
 *          exceptions:Array<object>, classBlocks:Array<object>,
 *          startMonday:string|Date}} context
 */
export function buildStudentTimeline(student, context = {}) {
  const { appointments = [], assignments = [], unassigned = [], exceptions = [], classBlocks = [], startMonday } =
    context;

  if (!student) {
    return {
      student: null,
      coach: null,
      unassignedReason: '',
      classBlock: null,
      classBlockName: '',
      classBlockKnown: false,
      entries: [],
      classCount: 0,
      coachingCount: 0,
      exceptions: [],
    };
  }

  const id = student.contactSfId;
  const assignment = (assignments || []).find(
    (entry) => entry?.student === student || (id && entry?.student?.contactSfId === id)
  );
  const unassignedEntry = (unassigned || []).find(
    (entry) => entry?.student === student || (id && entry?.student?.contactSfId === id)
  );

  const block = classBlockForStudent(classBlocks, student);
  const classEntries = expandClassSessions(block, startMonday).map((session) => ({
    type: 'class',
    date: session.date,
    dateValue: session.dateValue,
    day: session.day,
    startTime: session.startTime,
    endTime: session.endTime,
    weekNumber: session.weekNumber,
    termBlock: blockOfWeek(session.weekNumber),
    label: session.className || 'Class',
    classBlock: session.classBlock,
    coachName: '',
    meetingNumber: null,
  }));

  const coachingEntries = (appointments || [])
    .filter((row) => row && id && row.contactSfId === id)
    .map((row) => ({
      type: 'coaching',
      date: row.date,
      dateValue: row.dateValue,
      day: row.day,
      startTime: row.startTime,
      endTime: row.endTime,
      weekNumber: row.weekNumber,
      termBlock: blockOfWeek(row.weekNumber),
      label: row.serviceName,
      classBlock: row.classBlock || '',
      coachName: row.coachName,
      meetingNumber: row.meetingNumber,
      rescheduledFromWeek: row.rescheduledFromWeek,
      appointment: row,
    }));

  // Class before coaching when both start at the same minute: the class is the
  // fixed commitment, and the ordering has to be stable either way.
  const entries = [...classEntries, ...coachingEntries].sort(
    byDateTime((a, b) => (a.type === b.type ? String(a.label).localeCompare(String(b.label)) : a.type === 'class' ? -1 : 1))
  );

  const studentExceptions = (exceptions || []).filter(
    (entry) => id && entry?.student?.contactSfId === id
  );

  return {
    student,
    coach: assignment ? assignment.coach : null,
    unassignedReason: unassignedEntry ? unassignedEntry.reason : '',
    classBlock: block,
    classBlockName: block ? block.name : String(student.classBlock || ''),
    classBlockKnown: Boolean(block),
    entries,
    classCount: classEntries.length,
    coachingCount: coachingEntries.length,
    exceptions: studentExceptions,
  };
}

/**
 * Students matching a search box, in student-file order. Matching is on name
 * and Contact SF ID, case-insensitively — an empty query matches everything,
 * so the caller decides how many to show.
 */
export function filterStudents(students, query) {
  const needle = String(query ?? '').trim().toLowerCase();
  if (needle === '') return [...(students || [])];
  return (students || []).filter((student) => {
    const name = String(student.studentName || '').toLowerCase();
    const id = String(student.contactSfId || '').toLowerCase();
    return name.includes(needle) || id.includes(needle);
  });
}
