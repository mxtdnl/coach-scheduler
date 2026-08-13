// Manual editing of a generated schedule (SPEC.md §17) — pure, DOM-free.
//
// Two jobs, and nothing else:
//
//   1. **Validate a proposed edit.** Given the current placements, decide
//      whether a move, a tray placement or a swap is allowed, and say why not
//      when it is not. Every refusal here is one of the §9/§11.5 invariants
//      (§17.4), which is what lets the rest of the app treat an edited
//      schedule exactly like a generated one.
//   2. **Replay a list of committed edits** over a finished schedule
//      (§17.5), producing the edited appointment rows, assignments and
//      unassigned list every consumer then reads (§17.8).
//
// The engine is never re-run. An edit is an overlay applied *after* §5
// assignment and *after* the §11.3 blocking post-pass, so a student nobody
// touched keeps their exact rows — including a meeting §11.3 moved and the
// week it was moved from.
//
// app.js owns all the wiring; nothing in this module reads the DOM,
// localStorage or the clock.

import {
  MAX_STUDENTS_PER_SLOT,
  weeksForOffset,
  minutesToTime,
  slotAllowsClassBlock,
  classBlockKey,
  balancedDayTargets,
  blockedWeekLookup,
  expandToAppointments,
  sortAppointments,
  DAY_ORDER,
} from './scheduler.js';

/** The §17.4 hard refusals. Each one is an invariant, not a preference. */
export const EDIT_REFUSALS = {
  UNKNOWN_STUDENT: 'unknown student',
  UNKNOWN_SLOT: 'outside availability',
  NOT_PLACED: 'not placed',
  SAME_POSITION: 'same position',
  CLASS_CLASH: 'class clash',
  NO_CLASS_BLOCK: 'class block unknown',
  SLOT_FULL: 'slot full',
  DOUBLE_BOOKED: 'double booked',
  BLOCKED_WEEK: 'coach blocked',
};

/** The §17.6 soft warnings: the edit is applied, and the warning sticks to it. */
export const EDIT_WARNINGS = {
  QUOTA: 'quota exceeded',
  DAY_BALANCE: 'day balance',
};

const idOf = (student) => String(student?.contactSfId ?? '');

/** The (coach, slot) cell a position belongs to (SPEC.md §17.2). */
export function positionKey(coach, day, start) {
  return `${coach}|${day}|${start}`;
}

/** The coach's slot at that weekday and start time, or null if there is none. */
export function slotAt(slots, coach, day, start) {
  const minutes = Number(start);
  return (slots || []).find((slot) => slot.coach === coach && slot.day === day && slot.start === minutes) || null;
}

/**
 * The editable form of a schedule: one entry per scheduled student, in the
 * scheduler's own assignment order (SPEC.md §7.3's determinism clause depends
 * on that order surviving an edit).
 */
export function placementsFromAssignments(assignments) {
  return (assignments || [])
    .filter((assignment) => assignment && assignment.student && assignment.slot)
    .map((assignment) => ({
      student: assignment.student,
      coach: assignment.coach ?? assignment.slot.coach,
      slot: assignment.slot,
      offset: assignment.offset,
    }));
}

/** cell key → { offset: placement } — the §4.5 three-position view of a cell. */
export function occupancyOf(placements) {
  const cells = new Map();
  (placements || []).forEach((placement) => {
    const key = positionKey(placement.coach, placement.slot.day, placement.slot.start);
    if (!cells.has(key)) cells.set(key, {});
    cells.get(key)[placement.offset] = placement;
  });
  return cells;
}

/**
 * The offsets still open in a cell, ignoring the named students — which is
 * what makes a swap, and a move within the student's own cell, legal.
 */
export function freeOffsetsIn(placements, slot, ignoreIds = new Set()) {
  const taken = new Set();
  (placements || []).forEach((placement) => {
    if (ignoreIds.has(idOf(placement.student))) return;
    if (placement.coach !== slot.coach || placement.slot.day !== slot.day || placement.slot.start !== slot.start) return;
    taken.add(placement.offset);
  });
  const free = [];
  for (let offset = 1; offset <= MAX_STUDENTS_PER_SLOT; offset++) {
    if (!taken.has(offset)) free.push(offset);
  }
  return free;
}

/** A position in the form the edits list and the replay both store. */
function positionOf(coach, slot, offset) {
  return { coach, day: slot.day, start: slot.start, offset };
}

/** "Coach A, Monday 09:00, offset 2" — one position, in prose. */
export function describePosition(position) {
  if (!position) return 'unassigned';
  return `${position.coach}, ${position.day} ${minutesToTime(position.start)}, offset ${position.offset}`;
}

/** "weeks 2, 6, 10 and 14" — the four weeks an offset produces (§4.2). */
export function describeWeeks(offset) {
  const weeks = weeksForOffset(offset);
  return `weeks ${weeks.slice(0, -1).join(', ')} and ${weeks[weeks.length - 1]}`;
}

/** One line for the §17.7 edits list: who moved, from where, to where. */
export function describeEdit(edit) {
  if (!edit) return '';
  if (edit.kind === 'swap') {
    return `${edit.student.studentName} and ${edit.partner.student.studentName} swapped places: ${
      edit.student.studentName
    } to ${describePosition(edit.to)}, ${edit.partner.student.studentName} to ${describePosition(edit.partner.to)}`;
  }
  if (edit.kind === 'place') {
    return `${edit.student.studentName} placed at ${describePosition(edit.to)}`;
  }
  return `${edit.student.studentName} moved from ${describePosition(edit.from)} to ${describePosition(edit.to)}`;
}

// ---- SPEC.md §17.4 — the hard refusals ----

function refusal(code, message) {
  return { code, message };
}

/** The class in the student's own block that a slot overlaps, for the message. */
function clashingClass(classBlocks, student, slot) {
  const key = classBlockKey(student?.classBlock);
  const block = (classBlocks || []).find((entry) => entry.id === key);
  if (!block) return null;
  const cls = (block.classes || []).find(
    (entry) => entry.day === slot.day && entry.start < slot.end && slot.start < entry.end
  );
  return cls ? { block, cls } : { block, cls: null };
}

/**
 * Every §17.4 check for one student at one position, in the order §17.4 lists
 * them. Returns null when the position is allowed.
 *
 * `ignoreIds` names the students whose current positions do not count as
 * occupied — the student being moved, and (for a swap) their partner.
 */
export function validatePosition(context, placements, { student, slot, offset, ignoreIds = new Set() }) {
  const coach = slot.coach;

  // (0) A student whose class block is missing or unknown (§5.3). The clash
  // check has nothing to check them against, so placing them would schedule a
  // student whose classes this tool has never seen — §5.3 sets these students
  // aside precisely so that cannot happen, and §14.3 calls inventing a
  // timetable for them a fabrication. The fix is in the student list, not here.
  const named = (context.classBlocks || []).filter((block) => block.id !== '');
  if (named.length > 0) {
    const key = classBlockKey(student?.classBlock);
    if (!key || !named.some((block) => block.id === key)) {
      return refusal(
        EDIT_REFUSALS.NO_CLASS_BLOCK,
        `${student?.studentName || 'That student'}${
          key ? ` names the class block "${student.classBlock}", which is not in the class schedule` : ' has no class block'
        }, so there is no timetable to check this slot against. Fix their class block in the student list and upload it again.`
      );
    }
  }

  // (1) The student's own class block (§4.4a). Another cohort's class here is
  // irrelevant to them, which is exactly why the message names the block.
  if (!slotAllowsClassBlock(slot, student.classBlock)) {
    const clash = clashingClass(context.classBlocks, student, slot);
    const where = clash?.cls
      ? `${clash.cls.className || 'a class'} runs ${clash.cls.day} ${minutesToTime(clash.cls.start)}–${minutesToTime(
          clash.cls.end
        )}`
      : 'that block has a class then';
    return refusal(
      EDIT_REFUSALS.CLASS_CLASH,
      `${student.studentName} is in ${clash?.block?.name || student.classBlock || 'their class block'}, and ${where}. A student is never scheduled during a class in their own block.`
    );
  }

  // (2)/(3) One cell is one coach at one weekday and hour, so double-booking
  // and the §4.5 three-per-slot capacity are the same check on the offsets.
  const occupant = (placements || []).find(
    (placement) =>
      !ignoreIds.has(idOf(placement.student)) &&
      placement.coach === coach &&
      placement.slot.day === slot.day &&
      placement.slot.start === slot.start &&
      placement.offset === offset
  );
  if (occupant) {
    return refusal(
      EDIT_REFUSALS.DOUBLE_BOOKED,
      `${coach} is already meeting ${occupant.student.studentName} on ${slot.day} at ${minutesToTime(
        slot.start
      )}, offset ${offset}. Two students on one offset would double-book the coach.`
    );
  }

  // (4) Every one of the four resulting meetings, against the target coach's
  // blocked weeks and dates (§11.2). No §11.3 rebooking is attempted here.
  const isBlocked = context.isBlocked || blockedWeekLookup(context.blocks || []);
  const blockedWeeks = weeksForOffset(offset).filter((week) => isBlocked(coach, week, slot.day));
  if (blockedWeeks.length > 0) {
    return refusal(
      EDIT_REFUSALS.BLOCKED_WEEK,
      `${coach} is blocked in ${blockedWeeks.length === 1 ? 'week' : 'weeks'} ${blockedWeeks.join(
        ', '
      )}. Offset ${offset} meets in ${describeWeeks(offset)}, so ${
        blockedWeeks.length === 1 ? 'that meeting' : 'those meetings'
      } could not go ahead. Blocked meetings are not rebooked automatically on a manual move.`
    );
  }

  return null;
}

// ---- SPEC.md §17.6 — the soft warnings ----

/**
 * The warnings a proposed state earns. Both are advisory: the edit is applied
 * either way, and the warning persists on the edit (§17.7).
 */
function warningsFor(context, placements, { coach, day }) {
  const warnings = [];
  const forCoach = placements.filter((placement) => placement.coach === coach);

  // §5.1 — the quota binds the automatic pass, not the person editing. There
  // is no quota at all in pre-allocated mode, so there is nothing to breach.
  const quota = context.mode === 'pre-allocated' ? null : Number(context.quotas?.[coach]);
  if (Number.isFinite(quota) && forCoach.length > quota) {
    warnings.push({
      code: EDIT_WARNINGS.QUOTA,
      message: `${coach} now has ${forCoach.length} students, above their FTE quota of ${quota}.`,
    });
  }

  // §4.7 — the day this landed on now holds more than its balanced share of
  // this coach's students.
  const coachSlots = (context.slots || []).filter((slot) => slot.coach === coach);
  const targets = balancedDayTargets(coachSlots, forCoach.length);
  const onDay = forCoach.filter((placement) => placement.slot.day === day).length;
  const target = targets[day] ?? 0;
  if (onDay > target) {
    warnings.push({
      code: EDIT_WARNINGS.DAY_BALANCE,
      message: `${coach}'s week is no longer evenly spread: ${day} now holds ${onDay} of their ${forCoach.length} students, against a balanced share of ${target}.`,
    });
  }

  return warnings;
}

// ---- validation of a proposed edit ----

let editSeq = 0;

function nextEditId() {
  editSeq += 1;
  return `edit-${editSeq}`;
}

/** Resets the edit-id counter. Test-only; ids are opaque everywhere else. */
export function resetEditIds() {
  editSeq = 0;
}

function findPlacement(placements, contactSfId) {
  return (placements || []).find((placement) => idOf(placement.student) === String(contactSfId)) || null;
}

function studentSummary(student) {
  return { contactSfId: idOf(student), studentName: student?.studentName || '' };
}

/**
 * SPEC.md §17.3 (1) and (2) — a move to a different coach and/or slot, or a
 * placement of a student from the unassigned tray.
 *
 * The student takes the **first free offset** in the target cell (§17.2), so
 * the returned `weeks` are what the caller must show before committing.
 *
 * @returns {{ok:boolean, refusal:?{code:string,message:string}, offset:?number,
 *            weeks:Array<number>, warnings:Array<object>, edit:?object}}
 */
export function validateMove(context, placements, request) {
  const list = placements || [];
  const current = findPlacement(list, request.contactSfId);
  const student = current ? current.student : request.student;
  if (!student) {
    return { ok: false, refusal: refusal(EDIT_REFUSALS.UNKNOWN_STUDENT, 'That student is not in this run.'), weeks: [], warnings: [], offset: null, edit: null };
  }

  const slot = slotAt(context.slots, request.coach, request.day, request.start);
  if (!slot) {
    return {
      ok: false,
      refusal: refusal(
        EDIT_REFUSALS.UNKNOWN_SLOT,
        `${request.coach} is not available on ${request.day} at ${minutesToTime(request.start)}, so nothing can be placed there.`
      ),
      weeks: [],
      warnings: [],
      offset: null,
      edit: null,
    };
  }

  // The student's own current position is not an obstacle to their own move.
  const ignoreIds = new Set([idOf(student)]);
  const free = freeOffsetsIn(list, slot, ignoreIds);
  if (free.length === 0) {
    return {
      ok: false,
      refusal: refusal(
        EDIT_REFUSALS.SLOT_FULL,
        `${slot.coach} already has three students on ${slot.day} at ${minutesToTime(
          slot.start
        )}, which is the most one slot can take. Swap with one of them, or choose another slot.`
      ),
      weeks: [],
      warnings: [],
      offset: null,
      edit: null,
    };
  }

  // §17.2 — a move takes the first free offset. A caller naming an offset (the
  // replay, and the tests) gets that one or a refusal, never a silent
  // substitution: "put them on offset 2" and "put them wherever fits" are
  // different requests.
  if (request.offset && !free.includes(request.offset)) {
    const occupant = list.find(
      (placement) =>
        placement.coach === slot.coach &&
        placement.slot.day === slot.day &&
        placement.slot.start === slot.start &&
        placement.offset === request.offset
    );
    return {
      ok: false,
      refusal: refusal(
        EDIT_REFUSALS.DOUBLE_BOOKED,
        `${slot.coach} is already meeting ${occupant?.student?.studentName || 'another student'} on ${
          slot.day
        } at ${minutesToTime(slot.start)}, offset ${request.offset}. Two students on one offset would double-book the coach.`
      ),
      weeks: [],
      warnings: [],
      offset: null,
      edit: null,
    };
  }
  const offset = request.offset || free[0];

  if (
    current &&
    current.coach === slot.coach &&
    current.slot.day === slot.day &&
    current.slot.start === slot.start &&
    current.offset === offset
  ) {
    return {
      ok: false,
      refusal: refusal(
        EDIT_REFUSALS.SAME_POSITION,
        `${student.studentName} is already at ${describePosition(positionOf(slot.coach, slot, offset))}.`
      ),
      weeks: [],
      warnings: [],
      offset: null,
      edit: null,
    };
  }

  const blocked = validatePosition(context, list, { student, slot, offset, ignoreIds });
  if (blocked) {
    return { ok: false, refusal: blocked, weeks: [], warnings: [], offset: null, edit: null };
  }

  const next = nextPlacements(list, [{ student, coach: slot.coach, slot, offset }]);
  const warnings = warningsFor(context, next, { coach: slot.coach, day: slot.day });

  return {
    ok: true,
    refusal: null,
    offset,
    weeks: weeksForOffset(offset),
    warnings,
    edit: {
      id: nextEditId(),
      kind: current ? 'move' : 'place',
      student: studentSummary(student),
      from: current ? positionOf(current.coach, current.slot, current.offset) : null,
      to: positionOf(slot.coach, slot, offset),
      warnings,
    },
  };
}

/**
 * SPEC.md §17.3 (3) / §17.4a — two students exchange cells and offsets.
 *
 * Both directions are checked against every §17.4 rule, with both students'
 * current positions ignored (they are both leaving), and the swap is refused
 * **whole** if either direction fails: no partial application, and never a
 * silent downgrade to a one-way move.
 */
export function validateSwap(context, placements, request) {
  const list = placements || [];
  const a = findPlacement(list, request.contactSfId);
  const b = findPlacement(list, request.withContactSfId);

  if (!a || !b) {
    const missing = !a ? request.student : request.withStudent;
    const name = missing?.studentName || 'That student';
    return {
      ok: false,
      refusal: refusal(
        EDIT_REFUSALS.NOT_PLACED,
        `${name} has no place in the schedule yet, so there is nothing to swap. Place them in a free position instead.`
      ),
      warnings: [],
      edit: null,
    };
  }
  if (a === b) {
    return {
      ok: false,
      refusal: refusal(EDIT_REFUSALS.SAME_POSITION, 'A student cannot be swapped with themselves.'),
      warnings: [],
      edit: null,
    };
  }

  const ignoreIds = new Set([idOf(a.student), idOf(b.student)]);
  const aTo = { student: a.student, coach: b.coach, slot: b.slot, offset: b.offset };
  const bTo = { student: b.student, coach: a.coach, slot: a.slot, offset: a.offset };

  for (const move of [aTo, bTo]) {
    const blocked = validatePosition(context, list, { ...move, ignoreIds });
    if (blocked) {
      return {
        ok: false,
        refusal: refusal(blocked.code, `The swap was refused whole, and neither student moved. ${blocked.message}`),
        warnings: [],
        edit: null,
      };
    }
  }

  const next = nextPlacements(list, [aTo, bTo]);
  const warnings = [
    ...warningsFor(context, next, { coach: aTo.coach, day: aTo.slot.day }),
    ...warningsFor(context, next, { coach: bTo.coach, day: bTo.slot.day }),
  ].filter((warning, index, all) => all.findIndex((other) => other.message === warning.message) === index);

  return {
    ok: true,
    refusal: null,
    warnings,
    edit: {
      id: nextEditId(),
      kind: 'swap',
      student: studentSummary(a.student),
      from: positionOf(a.coach, a.slot, a.offset),
      to: positionOf(b.coach, b.slot, b.offset),
      partner: {
        student: studentSummary(b.student),
        from: positionOf(b.coach, b.slot, b.offset),
        to: positionOf(a.coach, a.slot, a.offset),
      },
      warnings,
    },
  };
}

/** The placement list with the given (student, coach, slot, offset) entries applied. */
function nextPlacements(placements, moves) {
  const byId = new Map(moves.map((move) => [idOf(move.student), move]));
  const seen = new Set();
  const next = (placements || []).map((placement) => {
    const move = byId.get(idOf(placement.student));
    if (!move) return placement;
    seen.add(idOf(placement.student));
    return { student: placement.student, coach: move.coach, slot: move.slot, offset: move.offset };
  });
  moves.forEach((move) => {
    if (seen.has(idOf(move.student))) return;
    // A student placed from the unassigned tray joins the end of the list, so
    // the scheduler's own assignment order survives ahead of them (§7.3).
    next.push({ student: move.student, coach: move.coach, slot: move.slot, offset: move.offset });
  });
  return next;
}

// ---- SPEC.md §17.5 / §17.7 — replaying the edit list ----

/**
 * Replays committed edits in the order they were made, re-validating each one
 * against the state the previous edits left behind.
 *
 * Re-validation is what makes per-edit undo honest (§17.7): removing edit *i*
 * can leave a later edit describing a position that no longer exists, and
 * dropping it is the only truthful answer — applying it blind would move a
 * student somewhere nobody asked for.
 *
 * @returns {{placements:Array<object>, applied:Array<object>, skipped:Array<object>}}
 */
export function replayEdits(context, basePlacements, edits) {
  let list = (basePlacements || []).map((placement) => ({ ...placement }));
  const applied = [];
  const skipped = [];

  (edits || []).forEach((edit) => {
    const outcome = replayOne(context, list, edit);
    if (!outcome.ok) {
      skipped.push({ edit, refusal: outcome.refusal });
      return;
    }
    list = outcome.placements;
    applied.push(edit);
  });

  return { placements: list, applied, skipped };
}

/** One committed edit, re-applied at its stored positions. */
function replayOne(context, placements, edit) {
  const moves = [];

  const resolve = (summary, position) => {
    const slot = slotAt(context.slots, position.coach, position.day, position.start);
    if (!slot) return null;
    const placement = findPlacement(placements, summary.contactSfId);
    const student =
      placement?.student ||
      (context.students || []).find((entry) => idOf(entry) === summary.contactSfId) ||
      null;
    if (!student) return null;
    return { student, coach: slot.coach, slot, offset: position.offset };
  };

  const primary = resolve(edit.student, edit.to);
  if (!primary) {
    return { ok: false, refusal: refusal(EDIT_REFUSALS.UNKNOWN_SLOT, 'That position is no longer in the schedule.') };
  }
  moves.push(primary);

  if (edit.kind === 'swap') {
    const partner = resolve(edit.partner.student, edit.partner.to);
    if (!partner) {
      return { ok: false, refusal: refusal(EDIT_REFUSALS.UNKNOWN_SLOT, 'That position is no longer in the schedule.') };
    }
    moves.push(partner);
  }

  const ignoreIds = new Set(moves.map((move) => idOf(move.student)));
  for (const move of moves) {
    const blocked = validatePosition(context, placements, { ...move, ignoreIds });
    if (blocked) return { ok: false, refusal: blocked };
  }

  return { ok: true, placements: nextPlacements(placements, moves) };
}

// ---- SPEC.md §17.5 — the overlay itself ----

function samePlacement(a, b) {
  return (
    Boolean(a) &&
    Boolean(b) &&
    a.coach === b.coach &&
    a.slot.day === b.slot.day &&
    a.slot.start === b.slot.start &&
    a.offset === b.offset
  );
}

/**
 * The edited schedule (SPEC.md §17.5): the finished §5 + §11.3 schedule with
 * the manual edits applied over it.
 *
 * A student nobody moved keeps their **exact** appointment rows, so a meeting
 * the blocking post-pass relocated keeps its new week and its "Rescheduled
 * from week N" mark. A student who moved has all four meetings regenerated
 * from their new (coach, slot, offset), which is also why their
 * `rescheduledFromWeek` comes back blank and any §11.3 exception of theirs is
 * resolved — §17.4 refuses a move that would land on a blocked week.
 *
 * @param {{assignments:Array<object>, unassigned:Array<object>,
 *          appointments:Array<object>, exceptions:Array<object>}} base
 * @param {Array<object>} edits the committed edits, in the order made
 * @param {{slots:Array<object>, classBlocks:Array<object>, blocks:Array<object>,
 *          quotas:Object, mode:string, startMonday:string|Date, timeZone:string,
 *          students:Array<object>}} context
 */
export function buildEditedSchedule(base, edits, context) {
  const empty = {
    assignments: base?.assignments || [],
    unassigned: base?.unassigned || [],
    appointments: base?.appointments || [],
    exceptions: base?.exceptions || [],
    placements: placementsFromAssignments(base?.assignments),
    edits: [],
    skipped: [],
    movedCount: countMoved(base?.appointments),
  };

  // Nothing to overlay, or nothing to overlay onto.
  if (!base || !edits || edits.length === 0 || !context?.startMonday) return empty;

  const basePlacements = placementsFromAssignments(base.assignments);
  const { placements, applied, skipped } = replayEdits(context, basePlacements, edits);
  if (applied.length === 0) return { ...empty, skipped };

  const baseById = new Map(basePlacements.map((placement) => [idOf(placement.student), placement]));
  const changed = placements.filter((placement) => !samePlacement(baseById.get(idOf(placement.student)), placement));
  const changedIds = new Set(changed.map((placement) => idOf(placement.student)));

  const kept = (base.appointments || []).filter((row) => !changedIds.has(String(row.contactSfId)));
  const regenerated = expandToAppointments(
    changed.map((placement) => ({
      student: placement.student,
      coach: placement.coach,
      slot: placement.slot,
      offset: placement.offset,
    })),
    context.startMonday,
    context.timeZone
  );
  const appointments = sortAppointments([...kept, ...regenerated]);

  return {
    assignments: placements.map((placement) => ({
      student: placement.student,
      coach: placement.coach,
      slot: placement.slot,
      offset: placement.offset,
    })),
    unassigned: (base.unassigned || []).filter((entry) => !changedIds.has(idOf(entry.student))),
    appointments,
    // A moved student's meetings are all regenerated clear of every blocked
    // week, so an exception of theirs no longer describes anything.
    exceptions: (base.exceptions || []).filter((entry) => !changedIds.has(idOf(entry.student))),
    placements,
    edits: applied,
    skipped,
    movedCount: countMoved(appointments),
  };
}

/** How many rows the §11.3 post-pass moved and an edit did not overwrite (§11.4). */
function countMoved(appointments) {
  return (appointments || []).filter((row) => row.rescheduledFromWeek !== '' && row.rescheduledFromWeek !== undefined)
    .length;
}

/**
 * The grid one coach's week is drawn from (SPEC.md §17.2): rows are start
 * times, columns are the weekdays that coach works, and every cell carries its
 * three offsets — occupied, free, or absent because the coach is not available
 * then.
 *
 * Pure, so the whole shape of the grid can be asserted without a DOM.
 */
export function buildCoachGrid(context, placements, coach) {
  const coachSlots = (context.slots || []).filter((slot) => slot.coach === coach);
  const days = DAY_ORDER.filter((day) => coachSlots.some((slot) => slot.day === day));
  const times = [...new Set(coachSlots.map((slot) => slot.start))].sort((a, b) => a - b);
  const occupancy = occupancyOf(placements);
  const blockNames = new Map((context.classBlocks || []).map((block) => [block.id, block.name || '(unnamed)']));

  const rows = times.map((start) => ({
    start,
    startTime: minutesToTime(start),
    cells: days.map((day) => {
      const slot = coachSlots.find((candidate) => candidate.day === day && candidate.start === start) || null;
      if (!slot) return { day, start, slot: null, available: false, positions: [], clashes: [] };
      const held = occupancy.get(positionKey(coach, day, start)) || {};
      const positions = [];
      for (let offset = 1; offset <= MAX_STUDENTS_PER_SLOT; offset++) {
        const placement = held[offset] || null;
        positions.push({
          offset,
          weeks: weeksForOffset(offset),
          student: placement ? placement.student : null,
          free: !placement,
        });
      }
      return {
        day,
        start,
        slot,
        available: true,
        positions,
        // Named, not just flagged: a cell one cohort cannot use is still on
        // offer to every other cohort (§4.4a).
        clashes: (slot.blockedFor || []).map((id) => blockNames.get(id) || id),
      };
    }),
  }));

  return { coach, days, rows, slotCount: coachSlots.length };
}
