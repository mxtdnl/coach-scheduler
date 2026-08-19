// The previous run's schedule, read back in (SPEC.md §19) — pure, DOM-free.
//
// Modify-existing mode adds students to a term that has already been
// scheduled. The evidence for what was scheduled is the appointments export
// the earlier run produced (§7.1), so this module turns those rows back into
// the two things the engine needs:
//
//   1. **Occupancy** — the (coach, weekday, start time, offset) places the
//      existing bookings hold, so a new student is never given one of them;
//   2. **Load** — how many students each coach already has, so the §5.1 quota
//      and the §4.7 day balance are computed over the coach's whole week
//      rather than over the part of it this run is filling.
//
// It also reports every way the existing schedule and the freshly uploaded
// coach availability / class schedule can disagree (§19.3). Those are flags,
// never silent corrections: an existing booking is a meeting a real person
// has in their calendar, so this tool says what looks wrong and leaves the
// decision to the user.
//
// Nothing here reads the DOM, localStorage or the clock.

import {
  slotAllowsClassBlock,
  classBlockKey,
  weekAndDayForDate,
  offsetForWeek,
  placeKey,
  minutesToTime,
  MAX_STUDENTS_PER_SLOT,
  MEETING_MINUTES,
} from './scheduler.js';

/** The §19.3 flags. Each one names a disagreement, not a correction. */
export const EXISTING_FLAGS = {
  OUTSIDE_TERM: 'outside term',
  EXCLUDED_WEEK: 'excluded week',
  COACH_NOT_FOUND: 'coach not found',
  OUTSIDE_AVAILABILITY: 'outside availability',
  CLASS_CLASH: 'class clash',
  CLASS_BLOCK_UNKNOWN: 'class block unknown',
  DOUBLE_BOOKED: 'double booked',
  SPLIT_PLACEMENT: 'split placement',
  MEETING_COUNT: 'meeting count',
  SLOT_OVER_CAPACITY: 'slot over capacity',
};

const idOf = (student) => String(student?.contactSfId ?? '');

function flag(list, code, message, extra = {}) {
  list.push({ code, message, ...extra });
}

/** "Monday 09:00" — one place, in prose, for a flag message. */
function whenLabel(day, start) {
  return `${day} ${minutesToTime(start)}`;
}

/**
 * The classes in one class block that a meeting overlaps. Used both for a
 * student whose block is known (a real §4.4a clash) and for one whose block is
 * not (a clash this tool cannot confirm either way).
 */
function overlappingClasses(block, day, start, end) {
  return (block?.classes || []).filter((cls) => cls.day === day && cls.start < end && start < cls.end);
}

/**
 * Groups the parsed appointment rows of a previous run into one entry per
 * student, resolves each meeting to its term week and offset, and reports
 * everything the rows and the current uploads disagree about.
 *
 * @param {Array<object>} rows parsed rows from `parseExistingAppointments`
 * @param {{slots?:Array<object>, classBlocks?:Array<object>,
 *          startMonday?:string|Date, students?:Array<object>,
 *          coaches?:Array<string>}} context
 * @returns {{students:Array<object>, meetings:Array<object>,
 *            placements:Array<object>, occupied:Set<string>,
 *            counts:Object<string,number>, coaches:Array<string>,
 *            flags:Array<object>, meetingCount:number}}
 */
export function buildExistingRun(rows, context = {}) {
  const slots = context.slots || [];
  const classBlocks = context.classBlocks || [];
  const startMonday = context.startMonday || null;
  const flags = [];

  // Class blocks named in the student list fill in for rows whose export had
  // no Class Block column (it is off by default, §7.1).
  const blockByStudent = new Map();
  (context.students || []).forEach((student) => {
    if (student?.classBlock) blockByStudent.set(idOf(student), student.classBlock);
  });

  const byStudent = new Map(); // contact id → student entry, in file order
  const meetings = [];

  rows.forEach((row) => {
    const id = String(row.contactSfId);
    if (!byStudent.has(id)) {
      byStudent.set(id, {
        contactSfId: id,
        studentName: row.studentName,
        studentEmail: row.studentEmail,
        classBlock: row.classBlock || blockByStudent.get(id) || '',
        coachName: row.coachName,
        coachSfId: row.coachSfId,
        coachEmail: row.coachEmail,
        meetings: [],
        placement: null,
      });
    }
    const student = byStudent.get(id);
    if (!student.classBlock && row.classBlock) student.classBlock = row.classBlock;

    const resolved = startMonday ? weekAndDayForDate(row.date, startMonday) : null;
    const week = resolved ? resolved.week : null;
    const offset = week === null ? null : offsetForWeek(week);
    const meeting = {
      ...row,
      week,
      offset,
      day: resolved ? resolved.day : row.day,
    };
    student.meetings.push(meeting);
    meetings.push(meeting);

    if (!startMonday) return;
    if (week === null) {
      flag(
        flags,
        EXISTING_FLAGS.OUTSIDE_TERM,
        `${row.studentName}'s meeting on ${row.date} at ${minutesToTime(row.start)} is outside the 15 term weeks that start on ${startMonday}. Check the term start date on Setup, or the file.`,
        { contactSfId: id, coach: row.coachName, row: row._row }
      );
    } else if (offset === null) {
      flag(
        flags,
        EXISTING_FLAGS.EXCLUDED_WEEK,
        `${row.studentName}'s meeting on ${row.date} falls in week ${week}, which holds no coaching meetings. It is counted as an existing booking, but nothing new is scheduled around it.`,
        { contactSfId: id, coach: row.coachName, row: row._row }
      );
    }
  });

  const students = [...byStudent.values()];

  // The placement each student holds: the (coach, weekday, start) their
  // meetings share, with the offset the weeks give. A §11.3 post-pass may have
  // moved one meeting elsewhere, so the placement is the one most of their
  // meetings sit at — and the odd meeting out is reported and still holds its
  // own place, so nothing new is ever booked over it.
  const occupied = new Set();
  const heldBy = new Map(); // place key → [contact ids]

  students.forEach((student) => {
    const usable = student.meetings.filter((meeting) => meeting.offset !== null);
    const tally = new Map();
    usable.forEach((meeting) => {
      const key = placeKey(student.coachName, meeting.day, meeting.start, meeting.offset);
      if (!tally.has(key)) tally.set(key, { key, meeting, count: 0 });
      tally.get(key).count += 1;
      occupied.add(key);
      if (!heldBy.has(key)) heldBy.set(key, []);
      if (!heldBy.get(key).includes(student.contactSfId)) heldBy.get(key).push(student.contactSfId);
    });

    const ranked = [...tally.values()].sort((a, b) => b.count - a.count || a.meeting.start - b.meeting.start);
    const main = ranked[0] || null;
    if (main) {
      student.placement = {
        coach: student.coachName,
        day: main.meeting.day,
        start: main.meeting.start,
        end: main.meeting.end,
        offset: main.meeting.offset,
      };
    }
    if (ranked.length > 1) {
      flag(
        flags,
        EXISTING_FLAGS.SPLIT_PLACEMENT,
        `${student.studentName}'s ${student.meetings.length} meetings are not all at the same time with ${
          student.coachName
        } — ${ranked
          .map((entry) => whenLabel(entry.meeting.day, entry.meeting.start))
          .join(' and ')}. Every one of them is treated as booked, so nothing new is scheduled over any of them.`,
        { contactSfId: student.contactSfId, coach: student.coachName }
      );
    }
    if (student.meetings.length !== 4) {
      flag(
        flags,
        EXISTING_FLAGS.MEETING_COUNT,
        `${student.studentName} has ${student.meetings.length} meeting${
          student.meetings.length === 1 ? '' : 's'
        } in the uploaded schedule, not the 4 a term gives a student. The file is used as it stands.`,
        { contactSfId: student.contactSfId, coach: student.coachName }
      );
    }
  });

  heldBy.forEach((ids, key) => {
    if (ids.length < 2) return;
    const [coach, day, start, offset] = key.split('|');
    const names = ids.map((id) => byStudent.get(id)?.studentName || id);
    flag(
      flags,
      EXISTING_FLAGS.DOUBLE_BOOKED,
      `${coach} has ${names.join(' and ')} booked at ${whenLabel(day, Number(start))} on the same offset (${offset}) in the uploaded schedule. One of those meetings cannot go ahead; fix it in the previous run's file.`,
      { coach }
    );
  });

  // ---- §19.3 — the existing bookings against the newly uploaded files ----

  const knownCoaches = new Set(
    (context.coaches || []).length > 0 ? context.coaches : slots.map((slot) => slot.coach)
  );
  const namedBlocks = classBlocks.filter((block) => block.id !== '');
  const blockNames = namedBlocks.map((block) => block.name).join(', ');
  const flaggedAvailability = new Set();
  const flaggedClash = new Set();
  const cellLoad = new Map(); // coach|day|start → set of student ids

  students.forEach((student) => {
    if (knownCoaches.size > 0 && !knownCoaches.has(student.coachName)) {
      flag(
        flags,
        EXISTING_FLAGS.COACH_NOT_FOUND,
        `${student.coachName} holds ${student.studentName}'s meetings in the uploaded schedule but is not in the coach availability file. Their bookings still hold their places; add them to the availability file if they are still coaching.`,
        { contactSfId: student.contactSfId, coach: student.coachName }
      );
    }

    student.meetings.forEach((meeting) => {
      if (meeting.offset === null) return;
      const cellKey = `${student.coachName}|${meeting.day}|${meeting.start}`;
      if (!cellLoad.has(cellKey)) cellLoad.set(cellKey, new Set());
      cellLoad.get(cellKey).add(student.contactSfId);

      const slot = slots.find(
        (candidate) =>
          candidate.coach === student.coachName &&
          candidate.day === meeting.day &&
          candidate.start === meeting.start
      );

      if (!slot && knownCoaches.has(student.coachName) && !flaggedAvailability.has(cellKey)) {
        flaggedAvailability.add(cellKey);
        flag(
          flags,
          EXISTING_FLAGS.OUTSIDE_AVAILABILITY,
          `${student.coachName} is booked with ${student.studentName} on ${whenLabel(
            meeting.day,
            meeting.start
          )}, which is not a valid slot in the uploaded coach availability. The booking stands; check the availability file covers it.`,
          { contactSfId: student.contactSfId, coach: student.coachName }
        );
      }

      const clashKey = `${student.contactSfId}|${meeting.day}|${meeting.start}`;
      if (flaggedClash.has(clashKey)) return;

      const key = classBlockKey(student.classBlock);
      const block = namedBlocks.find((entry) => entry.id === key);
      if (!key || !block) {
        if (namedBlocks.length === 0) return;
        const overlaps = namedBlocks.filter(
          (entry) => overlappingClasses(entry, meeting.day, meeting.start, meeting.end).length > 0
        );
        if (overlaps.length === 0) return;
        flaggedClash.add(clashKey);
        flag(
          flags,
          EXISTING_FLAGS.CLASS_BLOCK_UNKNOWN,
          `${student.studentName}'s booking on ${whenLabel(meeting.day, meeting.start)} overlaps a class in ${overlaps
            .map((entry) => entry.name)
            .join(' and ')}, and their own class block is ${
            key ? `"${student.classBlock}", which the class schedule does not define` : 'not in either file'
          }. Add them to the student list to have this checked properly. Known class blocks: ${blockNames}.`,
          { contactSfId: student.contactSfId, coach: student.coachName }
        );
        return;
      }

      const clashes = overlappingClasses(block, meeting.day, meeting.start, meeting.end);
      if (clashes.length === 0) return;
      flaggedClash.add(clashKey);
      const cls = clashes[0];
      flag(
        flags,
        EXISTING_FLAGS.CLASS_CLASH,
        `${student.studentName} is booked with ${student.coachName} on ${whenLabel(
          meeting.day,
          meeting.start
        )}, but ${cls.className || 'a class'} in ${block.name} runs ${minutesToTime(cls.start)}–${minutesToTime(
          cls.end
        )} that day. The booking stands; check the class schedule or move the meeting on the Edit step.`,
        { contactSfId: student.contactSfId, coach: student.coachName }
      );
    });
  });

  cellLoad.forEach((ids, key) => {
    if (ids.size <= MAX_STUDENTS_PER_SLOT) return;
    const [coach, day, start] = key.split('|');
    flag(
      flags,
      EXISTING_FLAGS.SLOT_OVER_CAPACITY,
      `${coach} already has ${ids.size} students at ${whenLabel(day, Number(start))} in the uploaded schedule, above the ${MAX_STUDENTS_PER_SLOT} one slot can take. No new student is added there.`,
      { coach }
    );
  });

  const counts = {};
  students.forEach((student) => {
    counts[student.coachName] = (counts[student.coachName] || 0) + 1;
  });

  const coaches = [];
  students.forEach((student) => {
    if (!coaches.includes(student.coachName)) coaches.push(student.coachName);
  });

  return {
    students,
    meetings,
    placements: existingPlacements(students, slots),
    occupied,
    counts,
    coaches,
    flags,
    meetingCount: meetings.length,
  };
}

/**
 * The existing students as **locked placements** (SPEC.md §19.5): the shape
 * `edits.js` reads, so an existing booking occupies its cell on the Edit grid
 * and refuses anything that would double-book it, while never being movable
 * itself — it belongs to a run that has already been exported and sent out.
 *
 * A booking whose slot is not in the uploaded availability keeps a slot-shaped
 * stand-in, so it still holds its place rather than quietly freeing it.
 */
export function existingPlacements(students, slots) {
  return (students || [])
    .filter((student) => student.placement)
    .map((student) => {
      const { coach, day, start, offset } = student.placement;
      const slot =
        (slots || []).find(
          (candidate) => candidate.coach === coach && candidate.day === day && candidate.start === start
        ) || { coach, day, start, end: start + MEETING_MINUTES, blockedFor: [] };
      return {
        student: {
          contactSfId: student.contactSfId,
          studentName: student.studentName,
          studentEmail: student.studentEmail,
          classBlock: student.classBlock,
        },
        coach,
        slot,
        offset,
        locked: true,
      };
    });
}

/**
 * SPEC.md §19.2 — which of the uploaded students still need a coach.
 *
 * The student list may hold the whole cohort or only the new arrivals: a
 * student the previous run already scheduled is recognised by their Contact SF
 * ID and left exactly as they are, so the same list can be uploaded again
 * without rescheduling anybody.
 */
export function splitExistingStudents(studentRows, existingRun) {
  const scheduled = new Set((existingRun?.students || []).map((student) => student.contactSfId));
  const newStudents = [];
  const alreadyScheduled = [];
  (studentRows || []).forEach((student) => {
    if (scheduled.has(idOf(student))) alreadyScheduled.push(student);
    else newStudents.push(student);
  });
  return { newStudents, alreadyScheduled };
}

/**
 * Every student in the run, existing and new — the number the §5.1 quota is
 * computed over (§19.4), and what the Review and Results counts report.
 */
export function totalStudentCount(existingRun, newStudentCount) {
  return (existingRun?.students?.length || 0) + Math.max(0, newStudentCount || 0);
}

/**
 * A slot's usability for one existing student, for the flags above. Exported
 * so tests can assert the check is the §4.4a one and not a second copy of it.
 */
export function existingBookingAllowed(slot, student) {
  return slotAllowsClassBlock(slot, student?.classBlock);
}
