// Campus-aware timezone conversion for the export (SPEC.md §7.1).
//
// The scheduling engine works in naive wall-clock terms — a day name plus
// minutes since midnight — and that stays true. Timezones enter only at the
// point where an appointment becomes a real instant for the export, and the
// zone used is the campus selected for the run (SPEC.md §6.1: one location
// per run), so a single IANA zone applies to every appointment.
//
// Offsets are never hard-coded. A 15-week term starting in September crosses
// both DST transitions (the UK leaves BST on the last Sunday in October, the
// US leaves EDT on the first Sunday in November), so a student's four
// meetings can legitimately carry different offsets. Every offset here is
// asked of Intl at the specific instant concerned.

/** Selectable campuses (SPEC.md §6.1). `id` is what persists to localStorage. */
export const CAMPUSES = [
  { id: 'london', label: 'London', timeZone: 'Europe/London', example: '+01:00 in BST, +00:00 in GMT' },
  { id: 'boston', label: 'Boston', timeZone: 'America/New_York', example: '-04:00 in EDT, -05:00 in EST' },
  { id: 'dubai', label: 'Dubai', timeZone: 'Asia/Dubai', example: '+04:00 all year' },
];

export const DEFAULT_CAMPUS_ID = 'london';

/** The campus record for an id, or null if the id is unknown. */
export function findCampus(id) {
  return CAMPUSES.find((campus) => campus.id === id) || null;
}

/**
 * The campus for an id, falling back to the default. Used wherever a missing
 * or stale localStorage value must not stop the app from producing an export.
 */
export function campusOrDefault(id) {
  return findCampus(id) || findCampus(DEFAULT_CAMPUS_ID);
}

const formatterCache = new Map();

function partsFormatter(timeZone) {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

/** The zone's wall-clock fields at a given instant (epoch ms). */
function zonedParts(epochMs, timeZone) {
  const parts = partsFormatter(timeZone).formatToParts(new Date(epochMs));
  const out = {};
  parts.forEach(({ type, value }) => {
    if (type !== 'literal') out[type] = Number(value);
  });
  // h23 should never yield 24, but a hostile/older ICU can — normalise so the
  // arithmetic below can never be off by a day.
  if (out.hour === 24) out.hour = 0;
  return out;
}

/**
 * The zone's UTC offset, in minutes, at a given instant. Positive is east of
 * UTC (London in summer → +60; Boston in summer → -240).
 */
export function offsetMinutesAt(epochMs, timeZone) {
  const p = zonedParts(epochMs, timeZone);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asIfUtc - epochMs) / 60000);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Resolves a wall-clock time in a zone to an instant (epoch ms).
 *
 * The offset depends on the instant and the instant depends on the offset,
 * so this tests both offsets in force around the target day and keeps the
 * candidate that round-trips: an instant is the right answer only if the
 * zone's offset *at that instant* is the offset used to compute it.
 *
 * DST edge cases, one of which falls inside a September-start term:
 * - Ambiguous (clocks go back; 01:30 London happens twice on 25 Oct 2026):
 *   both candidates round-trip, and the earlier — still-in-DST — one wins.
 * - Non-existent (clocks go forward; 01:30 is skipped): neither candidate
 *   round-trips, and the time resolves to the instant just after the jump,
 *   i.e. 02:30 local.
 * Coaching slots start on :00/:30 boundaries during working hours, so
 * neither case can arise from real availability data — but the behaviour is
 * defined rather than accidental.
 */
export function wallClockToInstant(year, month, day, minutesSinceMidnight, timeZone) {
  const hour = Math.floor(minutesSinceMidnight / 60);
  const minute = minutesSinceMidnight % 60;
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0);

  // A transition is never within 24h of another, so these bracket the target.
  const offsetBefore = offsetMinutesAt(naive - DAY_MS, timeZone);
  const offsetAfter = offsetMinutesAt(naive + DAY_MS, timeZone);

  const candidates = [offsetBefore, offsetAfter]
    .map((offset) => naive - offset * 60000)
    .filter((instant, i, all) => all.indexOf(instant) === i)
    .filter((instant) => naive - offsetMinutesAt(instant, timeZone) * 60000 === instant);

  // Ambiguous → the earliest valid instant (the pre-transition occurrence).
  // Gap → nothing round-trips; the pre-transition offset lands just after it.
  return candidates.length > 0 ? Math.min(...candidates) : naive - offsetBefore * 60000;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatOffset(offsetMinutes) {
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  return `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

/**
 * An instant as ISO 8601 with the zone's offset at that instant:
 * `YYYY-MM-DDTHH:MM:SS+01:00`. This is the export format required by
 * SPEC.md §7.1 — note it carries an offset, which is precisely why these
 * columns are written as text rather than as Excel date serials (an Excel
 * serial has no timezone to carry).
 */
export function formatIsoWithOffset(epochMs, timeZone) {
  const offsetMinutes = offsetMinutesAt(epochMs, timeZone);
  const p = zonedParts(epochMs, timeZone);
  return (
    `${p.year}-${pad2(p.month)}-${pad2(p.day)}` +
    `T${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)}` +
    formatOffset(offsetMinutes)
  );
}

/**
 * The offset-bearing ISO strings for one appointment. `minutes` is the start
 * time as minutes since midnight; the end is 60 minutes later *in absolute
 * time*, so a meeting spanning a clocks-go-back hour ends with a different
 * offset from the one it started with — which is correct, and is why the end
 * is not computed by adding an hour to the wall clock.
 */
export function appointmentTimes(dateParts, minutes, durationMins, timeZone) {
  const { year, month, day } = dateParts;
  const startMs = wallClockToInstant(year, month, day, minutes, timeZone);
  const endMs = startMs + durationMins * 60000;
  return {
    startDateTime: formatIsoWithOffset(startMs, timeZone),
    endDateTime: formatIsoWithOffset(endMs, timeZone),
  };
}
