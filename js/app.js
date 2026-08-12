// UI wiring, state, step flow (SPEC.md §6).
// Upload parsing/validation is wired against parse.js; Review and Results
// are wired against scheduler.js (SPEC.md §5, §9); export (§7, default and
// customisable) is wired against exporter.js.

import {
  getStartDate,
  setStartDate,
  getMode,
  setMode,
  getCampus,
  setCampus,
  getFteMap,
  setFte,
  getExportMapping,
  setExportMapping,
  getBlocks,
  setBlocks,
  clearSettings,
} from './storage.js';
import {
  installGlobalErrorHandlers,
  showError,
  clearAlerts,
  guard,
  guardAsync,
  guarded,
  describeError,
} from './errors.js';
import { isXLSXAvailable, XLSX_MISSING_MESSAGE } from './xlsx-loader.js';
import { escapeHtml } from './html.js';
import { renderTermRibbon } from './ribbon.js';
import { CAMPUSES, DEFAULT_CAMPUS_ID, campusOrDefault } from './timezone.js';
import {
  parseClassSchedule,
  parseCoachAvailability,
  parseStudentList,
  parsePairings,
  checkPairingsReferences,
  checkStudentClassBlocks,
} from './parse.js';
import {
  buildSlots,
  buildClassBlocks,
  classBlockKey,
  slotsForClassBlock,
  computeQuotas,
  schedule,
  expandToAppointments,
  applyBlocks,
  weekAndDayForDate,
  blockOfWeek,
  EXCLUDED_WEEKS,
  TERM_WEEKS,
  MAX_STUDENTS_PER_SLOT,
  CLASS_BLOCK_TOTAL_MINUTES,
  REASONS,
} from './scheduler.js';
import {
  bookingCoaches,
  buildCoachBookings,
  buildStudentTimeline,
  filterStudents,
} from './bookings.js';
import {
  getDefaultMapping,
  createConstantColumn,
  buildPreviewRows,
  exportableCoachMeetings,
  exportCoachCalendar,
  exportAppointments,
  exportCoachAssignments,
  buildCoachAssignmentRows,
  COACH_ASSIGNMENT_HEADERS,
  findCoachesWithoutSfId,
  coachSfIdErrorMessage,
  sanitiseMapping,
  FIELD_LABELS,
} from './exporter.js';

// Installed before anything else runs, so a failure during start-up is
// reported rather than leaving a blank page (SPEC.md §6).
installGlobalErrorHandlers();

const STEPS = ['setup', 'upload', 'review', 'results'];

// Parsed upload data lives only in memory (state.uploads) for the session —
// per SPEC.md §2 it must never be written to localStorage.
const UPLOAD_KEYS = ['classSchedule', 'coachAvailability', 'studentList', 'pairings'];
const UPLOAD_PARSERS = {
  classSchedule: parseClassSchedule,
  coachAvailability: parseCoachAvailability,
  studentList: parseStudentList,
  pairings: parsePairings,
};

/** Human names for the four uploads, used in messages. */
const UPLOAD_LABELS = {
  classSchedule: 'class schedule',
  coachAvailability: 'coach availability',
  studentList: 'student list',
  pairings: 'pairings',
};

const storedMode = getMode();
const storedCampus = getCampus();

const state = {
  stepIndex: 0,
  startDate: getStartDate() || null, // ISO yyyy-mm-dd, Monday-normalised
  mode: storedMode === 'pre-allocated' ? 'pre-allocated' : 'auto',
  // One campus per run (SPEC.md §6.1): its timezone is what turns naive slot
  // times into the offset-bearing instants the export requires.
  campusId: campusOrDefault(storedCampus).id,
  uploads: { classSchedule: null, coachAvailability: null, studentList: null, pairings: null },
  exportMapping: sanitiseMapping(getExportMapping()) || getDefaultMapping(),
  // Blocked coach weeks/dates (SPEC.md §11.2) and the coach the panel is
  // currently editing.
  blocks: [],
  blockingCoach: null,
  // The Results booking views (SPEC.md §14). Only the current selection lives
  // here — the bookings themselves are always read from the freshly computed
  // schedule, never cached.
  bookings: { view: 'coach', coach: null, studentId: null, studentQuery: '' },
};

/** Looks up a required element, failing with a message that names it. */
function mustFind(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`The page is missing the "${id}" element, so the app cannot start.`);
  return el;
}

const startDateInput = mustFind('start-date-input');
const dateNotice = mustFind('date-notice');
const campusSelect = mustFind('campus-select');
const campusNotice = mustFind('campus-notice');
const modeAutoInput = mustFind('mode-auto');
const modePreAllocatedInput = mustFind('mode-pre-allocated');
const pairingsUploadCard = mustFind('pairings-upload-card');
const backBtn = mustFind('back-btn');
const nextBtn = mustFind('next-btn');
const startOverBtn = mustFind('start-over-btn');
const startOverDialog = mustFind('start-over-dialog');
const startOverForm = mustFind('start-over-form');
const startOverClearSettings = mustFind('start-over-clear-settings');
const blockingToggle = mustFind('blocking-toggle');
const blockingSheet = mustFind('blocking-sheet');
const blockingClose = mustFind('blocking-close');
const blockingCoachSelect = mustFind('blocking-coach');
const blockingRibbon = mustFind('blocking-ribbon');
const blockingWeekInput = mustFind('blocking-week-input');
const blockingAddWeek = mustFind('blocking-add-week');
const blockingDateInput = mustFind('blocking-date-input');
const blockingAddDate = mustFind('blocking-add-date');
const blockingNotice = mustFind('blocking-notice');
const blockingList = mustFind('blocking-list');
const blockingClear = mustFind('blocking-clear');
const blockingSummary = mustFind('blocking-summary');
const stepperItems = document.querySelectorAll('.stepper-item');
const stepPanels = document.querySelectorAll('.step-panel');

/**
 * Returns the ISO (yyyy-mm-dd) date of the Monday on or before the given
 * ISO date, per SPEC.md §4.1 ("normalises to the Monday of that week").
 */
function normaliseToMonday(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const weekday = date.getDay(); // 0 = Sunday ... 6 = Saturday
  const diffToMonday = weekday === 0 ? -6 : 1 - weekday;
  date.setDate(date.getDate() + diffToMonday);
  return toISODate(date);
}

function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatReadable(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
}

function handleStartDateChange() {
  const pickedDate = startDateInput.value;

  // Clearing the field is a normal thing to do — reflect it rather than
  // leaving Results showing a schedule built from the old date.
  if (!pickedDate) {
    state.startDate = null;
    setStartDate('');
    dateNotice.hidden = true;
    refreshComputedSteps();
    return;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(pickedDate)) {
    throw new Error(`"${pickedDate}" is not a date the app can read. Use the date picker, or type it as YYYY-MM-DD.`);
  }

  const monday = normaliseToMonday(pickedDate);
  state.startDate = monday;
  setStartDate(monday);
  startDateInput.value = monday;

  if (monday !== pickedDate) {
    dateNotice.textContent = `Week 1 will start ${formatReadable(monday)} (moved from your selected date).`;
    dateNotice.hidden = false;
  } else {
    dateNotice.hidden = true;
  }

  refreshComputedSteps();
}

/**
 * Describes the campus in the terms the export uses, so the offset is
 * visible before anyone opens the file.
 */
function renderCampusNotice() {
  const campus = campusOrDefault(state.campusId);
  campusNotice.textContent = `Meeting times will be exported in ${campus.label} local time (${campus.timeZone}, ${campus.example}).`;
}

function handleCampusChange(campusId) {
  state.campusId = campusOrDefault(campusId).id;
  setCampus(state.campusId);
  renderCampusNotice();
  refreshComputedSteps();
}

function handleModeChange(mode) {
  state.mode = mode;
  setMode(mode);
  pairingsUploadCard.hidden = mode !== 'pre-allocated';
  refreshComputedSteps();
}

function renderStep() {
  const currentStep = STEPS[state.stepIndex];

  stepPanels.forEach((panel) => {
    panel.hidden = panel.dataset.step !== currentStep;
  });

  stepperItems.forEach((item) => {
    const stepName = item.dataset.step;
    const itemIndex = STEPS.indexOf(stepName);
    item.classList.toggle('active', stepName === currentStep);
    item.classList.toggle('completed', itemIndex < state.stepIndex);
  });

  backBtn.disabled = state.stepIndex === 0;
  nextBtn.textContent = state.stepIndex === STEPS.length - 1 ? 'Done' : 'Continue';
  nextBtn.disabled = state.stepIndex === STEPS.length - 1;
}

function goToStep(index) {
  state.stepIndex = Math.min(Math.max(index, 0), STEPS.length - 1);
  renderStep();
}

// ---- Upload step ----

function getUploadElements(key) {
  const dropzone = document.querySelector(`.dropzone[data-upload="${key}"]`);
  if (!dropzone) throw new Error(`The page is missing the drop zone for the ${UPLOAD_LABELS[key] || key} file.`);
  const card = dropzone.closest('.upload-card');
  if (!card) throw new Error(`The drop zone for the ${UPLOAD_LABELS[key] || key} file is not inside an upload card.`);
  return {
    dropzone,
    fileInput: dropzone.querySelector('.file-input'),
    promptEl: dropzone.querySelector('.dropzone-text'),
    checkEl: dropzone.querySelector('.dropzone-check'),
    filenameEl: dropzone.querySelector('.dropzone-filename'),
    metaEl: dropzone.querySelector('.dropzone-meta'),
    replaceEl: dropzone.querySelector('.dropzone-replace'),
    resultEl: card.querySelector('.upload-result'),
  };
}

/**
 * Validation output per DESIGN.md §3.5: a tinted bordered list inside the
 * file's card, one line per issue, row numbers in mono.
 */
function renderIssueList(label, issues, kind) {
  const items = issues
    .map((issue) => {
      const rowPrefix = issue.row ? `<span class="issue-row">Row ${issue.row}</span> — ` : '';
      return `<li>${rowPrefix}${escapeHtml(issue.message)}</li>`;
    })
    .join('');
  const groupClass = kind === 'warning' ? 'issue-group issue-group-warning' : 'issue-group';
  return `<div class="${groupClass}"><div class="issue-group-title">${label}</div><ul class="issue-list">${items}</ul></div>`;
}

/**
 * For pairings, cross-file reference warnings (SPEC.md §8) depend on
 * whatever the student list / coach availability uploads currently
 * contain, so they're computed at display time rather than stored.
 */
function computeDisplayResult(key) {
  const upload = state.uploads[key];
  if (!upload) return null;

  if (key === 'pairings') {
    const studentIds = new Set((state.uploads.studentList?.result.rows ?? []).map((r) => r.contactSfId));
    const coachNames = new Set((state.uploads.coachAvailability?.result.rows ?? []).map((r) => r.coachName));
    const crossWarnings = checkPairingsReferences(upload.fileName, upload.result.rows, studentIds, coachNames);
    return {
      rows: upload.result.rows,
      errors: upload.result.errors,
      warnings: [...upload.result.warnings, ...crossWarnings],
    };
  }

  // A student naming a class block the class schedule does not define
  // (SPEC.md §5.3) — cross-file, so computed against whatever class schedule
  // is currently loaded rather than stored on the student upload.
  if (key === 'studentList') {
    const crossWarnings = checkStudentClassBlocks(upload.fileName, upload.result.rows, currentClassBlocks());
    return {
      rows: upload.result.rows,
      errors: upload.result.errors,
      warnings: [...upload.result.warnings, ...crossWarnings],
    };
  }

  return upload.result;
}

/** The run's class blocks, from the class schedule upload if it parsed cleanly. */
function currentClassBlocks() {
  return buildClassBlocks(rowsFor('classSchedule'));
}

function renderUploadResult(key) {
  const { dropzone, promptEl, checkEl, filenameEl, metaEl, replaceEl, resultEl } = getUploadElements(key);
  const upload = state.uploads[key];

  if (!upload) {
    dropzone.classList.remove('dropzone-loaded');
    promptEl.hidden = false;
    checkEl.hidden = true;
    filenameEl.hidden = true;
    filenameEl.textContent = '';
    metaEl.hidden = true;
    metaEl.textContent = '';
    replaceEl.hidden = true;
    resultEl.hidden = true;
    resultEl.innerHTML = '';
    resultEl.classList.remove('upload-result-success', 'upload-result-error');
    return;
  }

  const display = computeDisplayResult(key);
  const hasErrors = display.errors.length > 0;
  const rowCount = display.rows.length;

  // On success the drop zone collapses to a compact row (§3.4); with errors
  // it stays open so the file can be replaced straight away.
  dropzone.classList.toggle('dropzone-loaded', !hasErrors);
  promptEl.hidden = !hasErrors;
  checkEl.hidden = hasErrors;
  replaceEl.hidden = hasErrors;
  filenameEl.hidden = hasErrors;
  filenameEl.textContent = upload.fileName;
  metaEl.hidden = hasErrors;
  metaEl.textContent = `${rowCount} row${rowCount === 1 ? '' : 's'}`;

  resultEl.hidden = false;
  resultEl.classList.toggle('upload-result-error', hasErrors);
  resultEl.classList.toggle('upload-result-success', !hasErrors);

  const parts = [];
  if (hasErrors) {
    const count = display.errors.length;
    parts.push(
      `<p class="upload-result-summary"><span class="mono-500">${count}</span> error${count === 1 ? '' : 's'} to fix. Correct these rows and upload the file again.</p>`
    );
    parts.push(renderIssueList('Errors', display.errors, 'error'));
    if (display.warnings.length > 0) parts.push(renderIssueList('Warnings', display.warnings, 'warning'));
  } else {
    parts.push(
      `<p class="upload-result-summary"><span class="mono-500">${rowCount}</span> row${rowCount === 1 ? '' : 's'} read. <span class="chip chip-ok">Ready</span></p>`
    );
    if (display.warnings.length > 0) parts.push(renderIssueList('Warnings', display.warnings, 'warning'));
  }
  resultEl.innerHTML = parts.join('');
}

/**
 * Reads and validates one upload. Every failure path is visible: a file the
 * parser rejects shows its errors in the card, and anything unexpected
 * (unreadable file, missing SheetJS) surfaces as an alert rather than
 * leaving the drop zone looking as though nothing happened.
 */
async function handleFileForKey(key, file) {
  const label = UPLOAD_LABELS[key] || key;

  const parsed = await guardAsync(`reading the ${label} file "${file.name}"`, async () => {
    const parser = UPLOAD_PARSERS[key];
    if (!parser) throw new Error(`No parser is registered for the ${label} file.`);
    return parser(file);
  });

  // guardAsync already reported the problem; leave any previous good upload
  // in place rather than silently replacing it with nothing.
  if (!parsed) return;

  state.uploads[key] = { fileName: file.name, result: parsed };

  guard(`showing the results for the ${label} file`, () => {
    renderUploadResult(key);
    // Pairings' displayed warnings depend on these two files; refresh it too.
    if (key === 'studentList' || key === 'coachAvailability') renderUploadResult('pairings');
    // The student list's class-block warnings depend on the class schedule.
    if (key === 'classSchedule') renderUploadResult('studentList');
  });

  refreshComputedSteps();
}

function clearAllUploads() {
  UPLOAD_KEYS.forEach((key) => {
    state.uploads[key] = null;
    const { fileInput } = getUploadElements(key);
    fileInput.value = '';
    renderUploadResult(key);
  });
  refreshComputedSteps();
}

function setupUpload(key) {
  const { dropzone, fileInput } = getUploadElements(key);
  const label = UPLOAD_LABELS[key] || key;

  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (file) handleFileForKey(key, file);
  });

  dropzone.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropzone.classList.add('dropzone-active');
  });
  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dropzone-active');
  });
  dropzone.addEventListener(
    'drop',
    guarded(`opening the dropped ${label} file`, (event) => {
      event.preventDefault();
      dropzone.classList.remove('dropzone-active');
      const dropped = event.dataTransfer?.files;
      if (!dropped || dropped.length === 0) {
        showError(
          `That drop did not contain a file. Drag an .xlsx file onto the ${label} box, or click it to choose one.`,
          null,
          `drop:${key}`
        );
        return;
      }
      if (dropped.length > 1) {
        showError(
          `Only one file can be used for the ${label}. Drop a single .xlsx file.`,
          `${dropped.length} files were dropped.`,
          `drop:${key}`
        );
        return;
      }
      fileInput.files = dropped;
      handleFileForKey(key, dropped[0]);
    })
  );
}

// ---- Blocked weeks/dates (SPEC.md §11.2) ----
//
// Stored in the form the panel edits — { coach, kind: 'week', week } or
// { coach, kind: 'date', date } — rather than pre-resolved, so a date block
// still points at the right week if the term start date changes later.

function sanitiseBlocks(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : [])
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const coach = typeof entry.coach === 'string' && entry.coach ? entry.coach : null;
      if (!coach) return null;
      if (entry.kind === 'date') {
        return /^\d{4}-\d{2}-\d{2}$/.test(String(entry.date)) ? { coach, kind: 'date', date: entry.date } : null;
      }
      const week = Number(entry.week);
      if (!Number.isInteger(week) || week < 1 || week > TERM_WEEKS) return null;
      return { coach, kind: 'week', week };
    })
    .filter((block) => {
      if (!block) return false;
      const key = blockKey(block);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function blockKey(block) {
  return block.kind === 'date' ? `${block.coach}|date|${block.date}` : `${block.coach}|week|${block.week}`;
}

/**
 * A stored block in the engine's `{coach, week, day}` form (SPEC.md §11.2:
 * a date is "internally resolved to coach + week + weekday"). Returns null
 * for a date that cannot be placed in the term yet — no start date chosen, or
 * a date outside the 15 weeks.
 */
function resolveBlock(block) {
  if (block.kind === 'week') return { coach: block.coach, week: block.week, day: null };
  if (!state.startDate) return null;
  const at = weekAndDayForDate(block.date, state.startDate);
  return at ? { coach: block.coach, week: at.week, day: at.day } : null;
}

function resolvedBlocks() {
  return state.blocks.map(resolveBlock).filter(Boolean);
}

/** The line shown for a block in the panel's list, with any no-op caveat. */
function describeBlock(block) {
  if (block.kind === 'week') {
    return {
      text: `Week ${block.week}`,
      note: EXCLUDED_WEEKS.includes(block.week) ? 'No meetings in this week, so this has no effect.' : '',
    };
  }
  const resolved = resolveBlock(block);
  if (!resolved) {
    return {
      text: state.startDate ? formatReadable(block.date) : block.date,
      note: state.startDate
        ? 'Outside the term, so this has no effect.'
        : 'Choose a term start date to place this date in a week.',
    };
  }
  return {
    text: `${formatReadable(block.date)} (week ${resolved.week})`,
    note: EXCLUDED_WEEKS.includes(resolved.week) ? 'No meetings in this week, so this has no effect.' : '',
  };
}

function persistBlocks() {
  setBlocks(state.blocks);
}

/** Adds a block unless it is already there; returns whether it was added. */
function addBlock(block) {
  const key = blockKey(block);
  if (state.blocks.some((existing) => blockKey(existing) === key)) return false;
  state.blocks.push(block);
  persistBlocks();
  refreshComputedSteps();
  return true;
}

function removeBlockByKey(key) {
  state.blocks = state.blocks.filter((block) => blockKey(block) !== key);
  persistBlocks();
  refreshComputedSteps();
}

function clearAllBlocks() {
  state.blocks = [];
  persistBlocks();
  refreshComputedSteps();
}

function showBlockingNotice(message) {
  blockingNotice.textContent = message;
  blockingNotice.hidden = !message;
}

/** Coaches offered in the panel: those with availability, plus any a stored block still names. */
function blockingCoaches() {
  const names = [];
  rowsFor('coachAvailability').forEach((row) => {
    if (!names.includes(row.coachName)) names.push(row.coachName);
  });
  state.blocks.forEach((block) => {
    if (!names.includes(block.coach)) names.push(block.coach);
  });
  return names;
}

function selectedBlockingCoach(coaches) {
  if (state.blockingCoach && coaches.includes(state.blockingCoach)) return state.blockingCoach;
  return coaches[0] || null;
}

/** Weeks the given coach is blocked in, as ribbon week states. */
function weekStatesForCoach(coach, exceptionWeeks = new Set()) {
  const states = {};
  resolvedBlocks()
    .filter((block) => block.coach === coach)
    .forEach((block) => {
      states[block.week] = { ...(states[block.week] || {}), blocked: true };
    });
  exceptionWeeks.forEach((week) => {
    states[week] = { ...(states[week] || {}), exceptions: true };
  });
  return states;
}

/** Toggling a week cell blocks it, or clears whatever already blocks it. */
function toggleWeekForCoach(coach, week) {
  const existing = state.blocks.filter((block) => {
    const resolved = resolveBlock(block);
    return resolved && resolved.coach === coach && resolved.week === week;
  });
  if (existing.length > 0) {
    const keys = new Set(existing.map(blockKey));
    state.blocks = state.blocks.filter((block) => !keys.has(blockKey(block)));
    persistBlocks();
    showBlockingNotice('');
    refreshComputedSteps();
    return;
  }
  showBlockingNotice('');
  addBlock({ coach, kind: 'week', week });
}

function termDateRange() {
  if (!state.startDate) return null;
  const [year, month, day] = state.startDate.split('-').map(Number);
  const first = new Date(year, month - 1, day);
  const last = new Date(first);
  last.setDate(last.getDate() + TERM_WEEKS * 7 - 1);
  return { first: toISODate(first), last: toISODate(last) };
}

function renderBlockingPanel(exceptionWeeksByCoach = new Map()) {
  const coaches = blockingCoaches();
  const coach = selectedBlockingCoach(coaches);
  state.blockingCoach = coach;

  blockingCoachSelect.innerHTML = coaches.length
    ? coaches.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('')
    : '<option value="">No coaches yet</option>';
  blockingCoachSelect.disabled = coaches.length === 0;
  if (coach) blockingCoachSelect.value = coach;

  const canEdit = Boolean(coach);
  blockingAddWeek.disabled = !canEdit;
  blockingAddDate.disabled = !canEdit;
  blockingWeekInput.disabled = !canEdit;
  blockingDateInput.disabled = !canEdit || !state.startDate;

  const range = termDateRange();
  if (range) {
    blockingDateInput.min = range.first;
    blockingDateInput.max = range.last;
  } else {
    blockingDateInput.removeAttribute('min');
    blockingDateInput.removeAttribute('max');
  }

  renderTermRibbon(blockingRibbon, {
    label: coach ? `Blocked weeks for ${coach}` : 'Term weeks',
    interactive: canEdit,
    weekStates: weekStatesForCoach(coach, exceptionWeeksByCoach.get(coach) || new Set()),
    onToggleWeek: (week) => guard('blocking or unblocking a week', () => toggleWeekForCoach(coach, week)),
  });

  blockingList.replaceChildren();
  if (state.blocks.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'block-empty';
    empty.textContent = 'No weeks or dates are blocked.';
    blockingList.appendChild(empty);
  } else {
    // Grouped by coach, each coach's blocks in the order they were added.
    const byCoach = new Map();
    state.blocks.forEach((block) => {
      if (!byCoach.has(block.coach)) byCoach.set(block.coach, []);
      byCoach.get(block.coach).push(block);
    });
    byCoach.forEach((blocks, name) => {
      blocks.forEach((block) => {
        const { text, note } = describeBlock(block);
        const item = document.createElement('li');
        const label = document.createElement('span');
        label.innerHTML = `${escapeHtml(name)} — <span class="mono">${escapeHtml(text)}</span>${
          note ? `<br /><span class="block-stale">${escapeHtml(note)}</span>` : ''
        }`;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'btn btn-destructive btn-small';
        remove.textContent = 'Remove';
        remove.setAttribute('aria-label', `Remove the block on ${name}, ${text}`);
        remove.addEventListener(
          'click',
          guarded('removing a block', () => removeBlockByKey(blockKey(block)))
        );
        item.append(label, remove);
        blockingList.appendChild(item);
      });
    });
  }

  blockingClear.disabled = state.blocks.length === 0;

  const coachCount = new Set(state.blocks.map((block) => block.coach)).size;
  blockingSummary.textContent =
    state.blocks.length === 0
      ? 'No weeks or dates are blocked.'
      : `${state.blocks.length} block${state.blocks.length === 1 ? '' : 's'} across ${coachCount} coach${
          coachCount === 1 ? '' : 'es'
        }.`;
}

function setBlockingSheetOpen(open) {
  blockingSheet.hidden = !open;
  blockingToggle.setAttribute('aria-expanded', String(open));
  document.querySelector('.app').classList.toggle('app-sheet-open', open);
  if (open) blockingCoachSelect.focus();
}

function setupBlockingPanel() {
  blockingToggle.addEventListener(
    'click',
    guarded('opening the blocked weeks and dates panel', () => {
      setBlockingSheetOpen(blockingSheet.hidden);
    })
  );

  blockingClose.addEventListener(
    'click',
    guarded('closing the blocked weeks and dates panel', () => {
      setBlockingSheetOpen(false);
      blockingToggle.focus();
    })
  );

  blockingCoachSelect.addEventListener(
    'change',
    guarded('choosing a coach', () => {
      state.blockingCoach = blockingCoachSelect.value || null;
      showBlockingNotice('');
      refreshComputedSteps();
    })
  );

  blockingAddWeek.addEventListener(
    'click',
    guarded('blocking a week', () => {
      const coach = state.blockingCoach;
      if (!coach) {
        showBlockingNotice('Upload the coach availability file to choose a coach.');
        return;
      }
      const week = Number(blockingWeekInput.value);
      if (!Number.isInteger(week) || week < 1 || week > TERM_WEEKS) {
        showBlockingNotice(`Enter a week number between 1 and ${TERM_WEEKS}.`);
        return;
      }
      // SPEC.md §11.2: weeks 4, 8 and 12 hold no meetings, so blocking one
      // would change nothing — say so rather than storing a block that does
      // nothing.
      if (EXCLUDED_WEEKS.includes(week)) {
        showBlockingNotice(`Week ${week} has no meetings, so blocking it changes nothing. It was not added.`);
        return;
      }
      const added = addBlock({ coach, kind: 'week', week });
      showBlockingNotice(added ? '' : `${coach} is already blocked for week ${week}.`);
      if (added) blockingWeekInput.value = '';
    })
  );

  blockingAddDate.addEventListener(
    'click',
    guarded('blocking a date', () => {
      const coach = state.blockingCoach;
      if (!coach) {
        showBlockingNotice('Upload the coach availability file to choose a coach.');
        return;
      }
      if (!state.startDate) {
        showBlockingNotice('Choose a term start date on the Setup step before blocking a date.');
        return;
      }
      const date = blockingDateInput.value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        showBlockingNotice('Choose a date with the date picker, or type it as YYYY-MM-DD.');
        return;
      }
      const at = weekAndDayForDate(date, state.startDate);
      if (!at) {
        const range = termDateRange();
        showBlockingNotice(
          `That date is outside the term. The term runs ${formatReadable(range.first)} to ${formatReadable(range.last)}.`
        );
        return;
      }
      if (EXCLUDED_WEEKS.includes(at.week)) {
        showBlockingNotice(`That date falls in week ${at.week}, which has no meetings, so it was not added.`);
        return;
      }
      const added = addBlock({ coach, kind: 'date', date });
      showBlockingNotice(added ? '' : `${coach} is already blocked on ${formatReadable(date)}.`);
      if (added) blockingDateInput.value = '';
    })
  );

  blockingClear.addEventListener(
    'click',
    guarded('clearing every block', () => {
      showBlockingNotice('');
      clearAllBlocks();
    })
  );
}

// ---- Review & Results steps (SPEC.md §5, §6, §9) ----

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const CORE_UPLOAD_KEYS = ['classSchedule', 'coachAvailability', 'studentList'];

/** The uploads the current mode actually uses (SPEC.md §5.2 adds pairings). */
function relevantUploadKeys() {
  return state.mode === 'pre-allocated' ? [...CORE_UPLOAD_KEYS, 'pairings'] : CORE_UPLOAD_KEYS;
}

/**
 * A file is only fed to the engine once it parses cleanly. A file with
 * errors is never used half-way: SPEC.md §8 rejects it, and Review/Results
 * say which file is holding things up rather than quietly scheduling from
 * whatever rows happened to survive.
 */
function isUploadUsable(key) {
  const upload = state.uploads[key];
  return Boolean(upload) && upload.result.errors.length === 0;
}

function missingUploadLabels() {
  return relevantUploadKeys()
    .filter((key) => !state.uploads[key])
    .map((key) => UPLOAD_LABELS[key]);
}

function erroredUploadLabels() {
  return relevantUploadKeys()
    .filter((key) => state.uploads[key] && state.uploads[key].result.errors.length > 0)
    .map((key) => UPLOAD_LABELS[key]);
}

function rowsFor(key) {
  return isUploadUsable(key) ? state.uploads[key].result.rows : [];
}

function hasCoreUploads() {
  return CORE_UPLOAD_KEYS.every(isUploadUsable);
}

function hasResultsInputs() {
  return relevantUploadKeys().every(isUploadUsable) && Boolean(state.startDate);
}

/** Joins ["a", "b", "c"] as "a, b, and c". */
function listSentence(items) {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

/**
 * The one-line explanation of why Review/Results have nothing to show —
 * always naming the files involved rather than just going blank.
 */
function blockedExplanation() {
  const missing = missingUploadLabels();
  const errored = erroredUploadLabels();
  const sentences = [];
  if (missing.length > 0) {
    sentences.push(`Upload the ${listSentence(missing)} file${missing.length === 1 ? '' : 's'} on the Upload step.`);
  }
  if (errored.length > 0) {
    sentences.push(
      `Fix the errors listed on the ${listSentence(errored)} file${errored.length === 1 ? '' : 's'} and upload ${
        errored.length === 1 ? 'it' : 'them'
      } again.`
    );
  }
  if (!state.startDate) sentences.push('Choose a term start date on the Setup step.');
  return sentences.join(' ');
}

/**
 * Runs the scheduling engine end-to-end against the current uploads, mode,
 * FTE values, and start date. Cheap and pure, so it's safe to call on every
 * render rather than caching — this is what keeps Review/Results in sync
 * whenever an input changes.
 */
function computeEngineState() {
  const availabilityRows = rowsFor('coachAvailability');
  const classRows = rowsFor('classSchedule');
  const classBlocks = buildClassBlocks(classRows);
  const studentRows = rowsFor('studentList');
  const pairingRows = rowsFor('pairings');

  const coaches = [];
  const seenCoaches = new Set();
  availabilityRows.forEach((row) => {
    if (!seenCoaches.has(row.coachName)) {
      seenCoaches.add(row.coachName);
      coaches.push(row.coachName);
    }
  });

  const slots = buildSlots(availabilityRows, classBlocks);

  // Per-class-block usable slots and student counts (SPEC.md §6.3): a slot a
  // class blocks out for one cohort is still capacity for the others, so this
  // is what explains why a given hour is or is not on offer to a student.
  const classBlockStats = classBlocks.map((block) => ({
    ...block,
    usableSlots: slotsForClassBlock(slots, block.id).length,
    studentCount: studentRows.filter((s) => classBlockKey(s.classBlock) === block.id).length,
  }));

  const slotCounts = {};
  coaches.forEach((c) => {
    slotCounts[c] = 0;
  });
  slots.forEach((slot) => {
    slotCounts[slot.coach] = (slotCounts[slot.coach] || 0) + 1;
  });

  const capacity = {};
  coaches.forEach((c) => {
    capacity[c] = (slotCounts[c] || 0) * MAX_STUDENTS_PER_SLOT;
  });
  const totalCapacity = coaches.reduce((sum, c) => sum + capacity[c], 0);
  const studentCount = studentRows.length;

  const fteMap = getFteMap();
  const fte = {};
  coaches.forEach((c) => {
    const stored = Number(fteMap[c]);
    fte[c] = Number.isFinite(stored) && stored > 0 ? stored : 1;
  });

  let quotas = {};
  let assignments = [];
  let unassigned = [];

  if (state.mode === 'pre-allocated') {
    ({ assignments, unassigned } = schedule(studentRows, slots, 'pre-allocated', pairingRows, coaches, { classBlocks }));
  } else {
    quotas = computeQuotas(coaches, fte, studentCount, slotCounts);
    ({ assignments, unassigned } = schedule(studentRows, slots, 'auto', quotas, coaches, { classBlocks }));
  }

  const timeZone = campusOrDefault(state.campusId).timeZone;
  const expanded = state.startDate ? expandToAppointments(assignments, state.startDate, timeZone) : [];

  // SPEC.md §11.3 — the blocking post-pass runs over the finished §4/§5
  // schedule, so it re-runs automatically whenever a block changes.
  const engineBlocks = resolvedBlocks();
  const blocked = applyBlocks(expanded, engineBlocks, slots, {
    timeZone,
    startMonday: state.startDate || undefined,
  });
  const appointments = blocked.appointments;
  const exceptions = blocked.exceptions;

  const scheduledByCoach = {};
  coaches.forEach((c) => {
    scheduledByCoach[c] = 0;
  });
  assignments.forEach((a) => {
    scheduledByCoach[a.coach] = (scheduledByCoach[a.coach] || 0) + 1;
  });

  return {
    coaches,
    classBlocks,
    classBlockStats,
    slots,
    slotCounts,
    capacity,
    totalCapacity,
    studentCount,
    studentRows,
    pairingRows,
    fte,
    quotas,
    assignments,
    unassigned,
    appointments,
    exceptions,
    movedCount: blocked.movedCount,
    engineBlocks,
    scheduledByCoach,
  };
}

/**
 * The class blocks in the run (SPEC.md §6.3): what each cohort's timetable
 * totals, how many students are in it, and how many of the coaching slots it
 * can actually use once its own classes are taken out. The hours column is the
 * 15-hour rule made visible; the slots column is the answer to "why can this
 * student not be put at 10:00?".
 */
function renderClassBlocksCard(eng) {
  const totalSlots = eng.slots.length;

  if (eng.classBlockStats.length === 0) {
    return `
    <div class="card">
      <h2>Class blocks</h2>
      <div class="table-wrap"><p class="table-empty">Upload the class schedule to see the class blocks in this run.</p></div>
    </div>`;
  }

  const unknownBlockStudents = eng.studentRows.filter(
    (student) => !eng.classBlocks.some((block) => block.id === classBlockKey(student.classBlock))
  );

  const rows = eng.classBlockStats
    .map((block) => {
      const exact = block.minutes === CLASS_BLOCK_TOTAL_MINUTES;
      const hoursChip = exact
        ? '<span class="chip chip-ok">15 hours</span>'
        : `<span class="chip chip-exception">${block.hours} hours</span>`;
      return `
    <tr>
      <td>${escapeHtml(block.name || '(unnamed)')}</td>
      <td class="mono num">${block.classes.length}</td>
      <td>${hoursChip}</td>
      <td class="mono num">${block.studentCount}</td>
      <td class="mono num">${block.usableSlots} of ${totalSlots}</td>
    </tr>`;
    })
    .join('');

  const summaryBits = [
    `${eng.classBlockStats.length} class block${eng.classBlockStats.length === 1 ? '' : 's'}`,
    `${totalSlots} coaching slot${totalSlots === 1 ? '' : 's'} across all coaches`,
  ];
  if (unknownBlockStudents.length > 0) {
    summaryBits.push(
      unknownBlockStudents.length === 1
        ? '1 student names a class block that is not in the class schedule'
        : `${unknownBlockStudents.length} students name a class block that is not in the class schedule`
    );
  }

  return `
    <div class="card">
      <h2>Class blocks</h2>
      <p class="help-text">${summaryBits.join(' · ')}. Every class block must total exactly 15 hours. A coaching slot is offered to a student only when it misses every class in their own block.</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Class block</th><th class="num">Classes</th><th>Total hours</th><th class="num">Students</th><th class="num">Slots available</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

function renderFteAndCapacityTable(eng) {
  if (eng.coaches.length === 0) {
    return `
    <div class="card">
      <h2>Coach capacity</h2>
      <p class="help-text">FTE changes recalculate quotas immediately.</p>
      <div class="table-wrap"><p class="table-empty">No coaches found in the availability file.</p></div>
    </div>`;
  }

  const rows = eng.coaches
    .map(
      (c) => `
    <tr>
      <td>${escapeHtml(c)}</td>
      <td class="mono num">${eng.slotCounts[c] || 0}</td>
      <td class="mono num">${eng.capacity[c] || 0}</td>
      <td><input type="number" class="fte" data-coach="${escapeHtml(c)}" min="0.05" max="1.00" step="0.05" value="${eng.fte[c].toFixed(2)}" aria-label="FTE for ${escapeHtml(c)}" /></td>
      <td class="mono-500 num">${eng.quotas[c] || 0}</td>
    </tr>`
    )
    .join('');

  return `
    <div class="card">
      <h2>Coach capacity</h2>
      <p class="help-text">FTE changes recalculate quotas immediately.</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Coach</th><th class="num">Valid slots</th><th class="num">Capacity</th><th>FTE</th><th class="num">Quota</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

function attachFteInputHandlers() {
  document.querySelectorAll('#review-content input.fte').forEach((input) => {
    input.addEventListener('change', guarded('saving the FTE value', () => {
      const coach = input.dataset.coach;
      let value = Number(input.value);
      if (!Number.isFinite(value)) value = 1;
      value = Math.round(Math.min(1, Math.max(0.05, value)) * 100) / 100;
      input.value = value.toFixed(2);
      setFte(coach, value);
      refreshComputedSteps();
    }));
  });
}

/**
 * Informational "requested" pairing count per coach for the pre-allocated
 * coverage table — dedupes by first valid student row, same as
 * scheduler.js's assignPreAllocated, but doesn't cap at capacity (that's
 * what the "Status" column is for).
 */
function computeRequestedPairings(eng) {
  const studentIds = new Set(eng.studentRows.map((s) => s.contactSfId));
  const coachSet = new Set(eng.coaches);
  const counts = {};
  eng.coaches.forEach((c) => {
    counts[c] = 0;
  });

  const seenStudents = new Set();
  eng.pairingRows.forEach((row) => {
    if (!studentIds.has(row.contactSfId) || seenStudents.has(row.contactSfId)) return;
    seenStudents.add(row.contactSfId);
    if (coachSet.has(row.coachName)) {
      counts[row.coachName] = (counts[row.coachName] || 0) + 1;
    }
  });

  return counts;
}

function renderPairingsCoverage(eng) {
  if (eng.coaches.length === 0) {
    return `
    <div class="card">
      <h2>Pairings coverage</h2>
      <div class="table-wrap"><p class="table-empty">No coaches found in the availability file.</p></div>
    </div>`;
  }

  const requested = computeRequestedPairings(eng);

  const rows = eng.coaches
    .map((c) => {
      const req = requested[c] || 0;
      const capacity = eng.capacity[c] || 0;
      const statusChip =
        req > capacity
          ? `<span class="chip chip-exception">Over capacity by ${req - capacity}</span>`
          : `<span class="chip chip-ok">OK</span>`;
      return `
    <tr>
      <td>${escapeHtml(c)}</td>
      <td class="mono num">${eng.slotCounts[c] || 0}</td>
      <td class="mono num">${capacity}</td>
      <td class="mono num">${req}</td>
      <td>${statusChip}</td>
    </tr>`;
    })
    .join('');

  const reasonCounts = {};
  eng.unassigned.forEach(({ reason }) => {
    reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
  });
  const noPairing = reasonCounts[REASONS.NO_PAIRING] || 0;
  const coachNotFound = reasonCounts[REASONS.COACH_NOT_FOUND] || 0;
  const overCapacity = reasonCounts[REASONS.COACH_OVER_CAPACITY] || 0;
  const validPairings = eng.studentCount - noPairing - coachNotFound - overCapacity;

  const summaryBits = [`${validPairings} of ${eng.studentCount} students have a valid pairing`];
  if (noPairing) summaryBits.push(`${noPairing} have no pairing`);
  if (coachNotFound) summaryBits.push(`${coachNotFound} reference an unknown coach`);
  if (overCapacity) summaryBits.push(`${overCapacity} exceed their coach's capacity`);

  return `
    <div class="card">
      <h2>Pairings coverage</h2>
      <p class="help-text">${summaryBits.join(' · ')}</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Coach</th><th class="num">Valid slots</th><th class="num">Capacity</th><th class="num">Paired students</th><th>Status</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

/**
 * Parse warnings from every file the current mode uses, surfaced together on
 * Review (SPEC.md §6.3) so nothing that was flagged on Upload is lost once
 * the user has moved on.
 */
function renderWarningsCard() {
  const groups = relevantUploadKeys()
    .map((key) => ({ key, display: computeDisplayResult(key) }))
    .filter(({ display }) => display && display.warnings.length > 0);

  if (groups.length === 0) return '';

  const total = groups.reduce((sum, g) => sum + g.display.warnings.length, 0);
  const lists = groups
    .map(({ key, display }) => renderIssueList(capitalize(UPLOAD_LABELS[key]), display.warnings, 'warning'))
    .join('');

  return `
    <div class="card">
      <h2>Warnings</h2>
      <p class="help-text">${total} warning${total === 1 ? '' : 's'} from the uploaded files. Scheduling continues, but check these are intended.</p>
      ${lists}
    </div>`;
}

function renderReview() {
  const container = document.getElementById('review-content');
  if (!container) throw new Error('The page is missing the "review-content" element.');
  const parts = [];

  if (!hasCoreUploads()) {
    const heading = state.mode === 'pre-allocated' ? 'Pairings coverage' : 'Coach capacity';
    parts.push(
      `<div class="card"><h2>${heading}</h2><div class="table-wrap"><p class="table-empty">${escapeHtml(
        blockedExplanation()
      )}</p></div></div>`
    );
    parts.push(renderWarningsCard());
    container.innerHTML = parts.join('');
    return;
  }

  const eng = computeEngineState();

  if (eng.totalCapacity < eng.studentCount) {
    const shortBy = eng.studentCount - eng.totalCapacity;
    parts.push(
      `<div class="banner">Total capacity (${eng.totalCapacity}) is below the number of students (${eng.studentCount}). ${shortBy} student${shortBy === 1 ? '' : 's'} will be unassigned unless availability or FTE increases.</div>`
    );
  }

  parts.push(renderClassBlocksCard(eng));

  if (state.mode === 'pre-allocated') {
    if (!isUploadUsable('pairings')) {
      parts.push(
        `<div class="card"><h2>Pairings coverage</h2><div class="table-wrap"><p class="table-empty">${escapeHtml(
          blockedExplanation()
        )}</p></div></div>`
      );
    } else {
      parts.push(renderPairingsCoverage(eng));
    }
  } else {
    parts.push(renderFteAndCapacityTable(eng));
  }

  parts.push(renderWarningsCard());

  container.innerHTML = parts.join('');

  if (state.mode === 'auto') attachFteInputHandlers();
}

function renderUtilisationTable(eng) {
  if (eng.coaches.length === 0) {
    return `
    <div class="card">
      <h2>Coach utilisation</h2>
      <div class="table-wrap"><p class="table-empty">No coaches found in the availability file.</p></div>
    </div>`;
  }

  const rows = eng.coaches
    .map((c) => {
      const capacity = eng.capacity[c] || 0;
      const scheduled = eng.scheduledByCoach[c] || 0;
      const pct = capacity > 0 ? Math.round((scheduled / capacity) * 100) : 0;
      return `
    <tr>
      <td>${escapeHtml(c)}</td>
      <td class="mono num">${capacity}</td>
      <td class="mono num">${scheduled}</td>
      <td class="mono-500 num">${pct}%</td>
    </tr>`;
    })
    .join('');

  return `
    <div class="card">
      <h2>Coach utilisation</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Coach</th><th class="num">Capacity</th><th class="num">Scheduled</th><th class="num">Utilisation</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

/**
 * How each class block fared (SPEC.md §6.4): who is in it, how many were
 * scheduled, and how much of the coaching timetable its classes leave open.
 * Students whose class block is missing or unknown are listed separately —
 * they are never scheduled against a guessed block (§5.3).
 */
function renderClassBlockResults(eng) {
  if (eng.classBlockStats.length === 0) return '';

  const scheduledByBlock = new Map();
  eng.assignments.forEach(({ student }) => {
    const key = classBlockKey(student.classBlock);
    scheduledByBlock.set(key, (scheduledByBlock.get(key) || 0) + 1);
  });

  const knownIds = new Set(eng.classBlocks.map((block) => block.id));
  const strays = eng.studentRows.filter((student) => !knownIds.has(classBlockKey(student.classBlock)));

  const rows = eng.classBlockStats
    .map((block) => {
      const scheduled = scheduledByBlock.get(block.id) || 0;
      return `
    <tr>
      <td>${escapeHtml(block.name || '(unnamed)')}</td>
      <td class="mono num">${block.hours}</td>
      <td class="mono num">${block.studentCount}</td>
      <td class="mono-500 num">${scheduled}</td>
      <td class="mono num">${block.usableSlots} of ${eng.slots.length}</td>
    </tr>`;
    })
    .join('');

  const strayRow =
    strays.length > 0
      ? `
    <tr>
      <td>Not in the class schedule</td>
      <td class="mono num">—</td>
      <td class="mono num">${strays.length}</td>
      <td class="mono-500 num">0</td>
      <td class="mono num">—</td>
    </tr>`
      : '';

  return `
    <div class="card">
      <h2>Class blocks</h2>
      <p class="help-text">A student's coaching slot never overlaps a class in their own block. Classes in another block do not limit them.</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Class block</th><th class="num">Hours</th><th class="num">Students</th><th class="num">Scheduled</th><th class="num">Slots available</th></tr></thead>
          <tbody>${rows}${strayRow}</tbody>
        </table>
      </div>
    </div>`;
}

/**
 * Unassigned students (SPEC.md §5) and the per-meeting exceptions the
 * blocking post-pass could not rebook (§11.3(3), §11.4), in one table: both
 * are "this did not get scheduled, and here is why".
 */
function renderExceptionsTable(eng) {
  if (eng.unassigned.length === 0 && eng.exceptions.length === 0) {
    return `
    <div class="card">
      <h2>Unassigned students and exceptions</h2>
      <div class="table-wrap"><p class="table-empty">All students were scheduled, with no meetings displaced.</p></div>
    </div>`;
  }

  const unassignedRows = eng.unassigned.map(
    ({ student, reason }) => `
    <tr>
      <td>${escapeHtml(student.studentName)} <span class="mono">${escapeHtml(student.contactSfId)}</span></td>
      <td>${escapeHtml(student.classBlock || '—')}</td>
      <td>All 4 meetings</td>
      <td><span class="chip chip-exception">${escapeHtml(capitalize(reason))}</span></td>
    </tr>`
  );

  const exceptionRows = eng.exceptions.map(
    ({ student, coach, meetingNumber, week, reason }) => `
    <tr>
      <td>${escapeHtml(student.studentName)} <span class="mono">${escapeHtml(student.contactSfId)}</span></td>
      <td>${escapeHtml(student.classBlock || '—')}</td>
      <td>Meeting <span class="mono">${meetingNumber}</span> · week <span class="mono">${week}</span> · ${escapeHtml(coach)}</td>
      <td><span class="chip chip-exception">${escapeHtml(capitalize(reason))}</span></td>
    </tr>`
  );

  const summaryBits = [];
  if (eng.unassigned.length > 0) {
    summaryBits.push(
      `${eng.unassigned.length} student${eng.unassigned.length === 1 ? '' : 's'} could not be scheduled`
    );
  }
  if (eng.exceptions.length > 0) {
    summaryBits.push(
      `${eng.exceptions.length} meeting${eng.exceptions.length === 1 ? '' : 's'} could not be rebooked around a blocked week or date`
    );
  }

  return `
    <div class="card">
      <h2>Unassigned students and exceptions</h2>
      <p class="help-text">${summaryBits.join(' · ')}.</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Student</th><th>Class block</th><th>Meetings</th><th>Reason</th></tr></thead>
          <tbody>${[...unassignedRows, ...exceptionRows].join('')}</tbody>
        </table>
      </div>
    </div>`;
}

/**
 * Appointments preview + export (SPEC.md §6, §7): the table reflects the
 * current export mapping (order, renamed/excluded headers, constant
 * columns) rather than a fixed column set, so what's on screen matches
 * what "Export appointments" produces.
 */
function renderAppointmentsPreview(eng) {
  if (eng.appointments.length === 0) {
    return `
    <div class="card">
      <h2>Appointments</h2>
      <div class="table-wrap"><p class="table-empty">No appointments were scheduled.</p></div>
    </div>`;
  }

  const { columns, rows } = buildPreviewRows(eng.appointments, state.exportMapping, 50);
  const note =
    eng.appointments.length > 50
      ? `Showing the first 50 of ${eng.appointments.length} appointments, per the export mapping below.`
      : `${eng.appointments.length} appointment${eng.appointments.length === 1 ? '' : 's'}, per the export mapping below.`;

  const theadHtml = columns.length
    ? columns.map((col) => `<th>${escapeHtml(col.header || '(untitled)')}</th>`).join('')
    : '<th>&nbsp;</th>';
  const tbodyHtml =
    columns.length === 0
      ? '<tr><td class="table-empty">All columns are excluded. Include at least one in Export settings.</td></tr>'
      : rows
          .map((cells) => `<tr>${cells.map((value) => `<td class="mono">${escapeHtml(String(value))}</td>`).join('')}</tr>`)
          .join('');
  const exportDisabled = columns.length === 0 ? ' disabled' : '';

  return `
    <div class="card">
      <div class="section-head">
        <div>
          <h2>Appointments</h2>
          <p class="help-text" style="margin:0">${note}</p>
        </div>
        <button type="button" id="export-btn" class="btn btn-primary"${exportDisabled}>Export appointments</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr>${theadHtml}</tr></thead>
          <tbody>${tbodyHtml}</tbody>
        </table>
      </div>
    </div>`;
}

/**
 * The second export (SPEC.md §7.3): a Salesforce-style batch upload with one
 * row per scheduled student/coach assignment, not one row per meeting. Only
 * rendered in auto-assign mode — in pre-allocated mode the coach comes from
 * the user's own pairings file, so an "assignments" export would tell them
 * nothing they did not upload, and the spec scopes the file to auto-assign.
 */
function renderCoachAssignmentsExport(eng) {
  if (state.mode !== 'auto') return '';

  const rows = buildCoachAssignmentRows(eng.assignments);
  const missingSfId = findCoachesWithoutSfId(eng.assignments);

  // A blank Coach User ID would produce a batch upload Salesforce cannot
  // match, so the export is refused and the affected coaches are named
  // (DESIGN.md §3.5: errors state the fix).
  const issues =
    missingSfId.length > 0
      ? renderIssueList('Coach SF ID', [{ message: coachSfIdErrorMessage(missingSfId) }])
      : '';
  const disabled = rows.length === 0 || missingSfId.length > 0 ? ' disabled' : '';

  const shown = Math.min(rows.length, 50);
  const count =
    rows.length > 50
      ? `Showing the first ${shown} of ${rows.length} students`
      : `${rows.length} student${rows.length === 1 ? '' : 's'}`;
  const note =
    rows.length === 0
      ? 'No student has been assigned a coach, so there is nothing to upload yet.'
      : `${count}, one row each — the coach they were assigned, not their four meetings. Separate file from the appointments export above.`;

  return `
    <div class="card">
      <div class="section-head">
        <div>
          <h2>Coach assignments</h2>
          <p class="help-text" style="margin:0">${escapeHtml(note)}</p>
        </div>
        <button type="button" id="export-assignments-btn" class="btn btn-secondary"${disabled}>Export coach assignments</button>
      </div>
      ${issues}
      <div class="table-wrap">
        <table>
          <thead><tr>${COACH_ASSIGNMENT_HEADERS.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead>
          <tbody>${
            rows.length === 0
              ? `<tr><td class="table-empty" colspan="${COACH_ASSIGNMENT_HEADERS.length}">No coach assignments to export.</td></tr>`
              : rows
                  .slice(0, 50)
                  .map(
                    (row) =>
                      `<tr>${[
                        row.studentName,
                        row.recordType,
                        row.recordTypeName,
                        row.type,
                        row.coachName,
                        row.coachUserId,
                        row.status,
                      ]
                        .map((value) => `<td class="mono">${escapeHtml(String(value))}</td>`)
                        .join('')}</tr>`
                  )
                  .join('')
          }</tbody>
        </table>
      </div>
    </div>`;
}

/** Re-queries and (re-)wires the coach-assignments Export button after every re-render. */
function attachCoachAssignmentsButtonHandler() {
  const btn = document.getElementById('export-assignments-btn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    if (!hasResultsInputs()) {
      showError('There is nothing to export yet.', blockedExplanation(), 'export-assignments');
      return;
    }
    const eng = guard('rebuilding the schedule for export', computeEngineState);
    if (!eng) return;
    if (state.mode !== 'auto') {
      showError(
        'The coach assignments export is only available in auto-assign mode.',
        'In pre-allocated mode the student–coach pairings come from your own pairings file.',
        'export-assignments'
      );
      return;
    }
    if (eng.assignments.length === 0) {
      showError(
        'There is nothing to export: no student was assigned a coach.',
        'Check the unassigned students table for the reason.',
        'export-assignments'
      );
      return;
    }
    const missingSfId = findCoachesWithoutSfId(eng.assignments);
    if (missingSfId.length > 0) {
      showError(
        'The coach assignments export needs a Coach SF ID for every assigned coach.',
        coachSfIdErrorMessage(missingSfId),
        'export-assignments'
      );
      return;
    }
    guard('creating the coach assignments file', () => exportCoachAssignments(eng.assignments, 'auto'));
  });
}

/** Re-queries and (re-)wires the Export button after every results-content re-render. */
function attachExportButtonHandler() {
  const btn = document.getElementById('export-btn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    // Each refusal says why; the button is never a no-op.
    if (!hasResultsInputs()) {
      showError('There is nothing to export yet.', blockedExplanation(), 'export');
      return;
    }
    const eng = guard('rebuilding the schedule for export', computeEngineState);
    if (!eng) return;
    if (eng.appointments.length === 0) {
      showError(
        'There is nothing to export: no student could be scheduled.',
        'Check the unassigned students table for the reason.',
        'export'
      );
      return;
    }
    guard('creating the Excel file', () => exportAppointments(eng.appointments, state.exportMapping));
  });
}

// ---- Bookings (SPEC.md §14) ----
//
// A read-only inspection view over the finished schedule: pick a coach and see
// who they are meeting, or pick a student and see their whole term. Both are
// built from the same appointment rows the export writes (bookings.js), so the
// screen and the file can never drift apart. Nothing here edits a schedule.

/** The week number as a chip in its term block's colours (DESIGN.md §3.5). */
function weekChip(week) {
  const block = blockOfWeek(week);
  if (!block) return `<span class="mono">${escapeHtml(String(week))}</span>`;
  return `<span class="chip chip-wk-b${block}">Week ${escapeHtml(String(week))}</span>`;
}

/** The ICS/ZIP options for the current run: the campus is the meeting's location. */
function calendarOptions() {
  const campus = campusOrDefault(state.campusId);
  return { campusLabel: campus.label, timeZone: campus.timeZone };
}

function bookingsEmptyState(message) {
  return `<div class="table-wrap"><p class="table-empty">${escapeHtml(message)}</p></div>`;
}

/**
 * One coach's diary: every meeting they have, in date order, with the student
 * each one is with. The totals answer "how many students, how many hours".
 */
function renderCoachBookingsPanel(eng) {
  const coach = state.bookings.coach;
  if (!coach) {
    return bookingsEmptyState('Choose a coach to see the students they are meeting, and when.');
  }

  const view = buildCoachBookings(eng.appointments, coach);
  if (view.meetingCount === 0) {
    return bookingsEmptyState(`${coach} has no meetings in this schedule, so there is nothing to show or export.`);
  }

  const rows = view.rows
    .map(
      (row) => `
    <tr>
      <td class="mono">${escapeHtml(row.date)}</td>
      <td>${escapeHtml(row.day)}</td>
      <td class="mono">${escapeHtml(row.startTime)}</td>
      <td class="mono">${escapeHtml(row.endTime)}</td>
      <td>${escapeHtml(row.studentName)} <span class="mono">${escapeHtml(row.contactSfId)}</span></td>
      <td>${escapeHtml(row.classBlock || '—')}</td>
      <td class="mono-500 num">${escapeHtml(String(row.meetingNumber))}</td>
      <td>${escapeHtml(row.serviceName)}</td>
      <td>${weekChip(row.weekNumber)}${
        row.rescheduledFromWeek !== '' && row.rescheduledFromWeek !== undefined
          ? ` <span class="chip chip-warn">Moved from week ${escapeHtml(String(row.rescheduledFromWeek))}</span>`
          : ''
      }</td>
    </tr>`
    )
    .join('');

  const summary = `${view.studentCount} student${view.studentCount === 1 ? '' : 's'} · ${
    view.meetingCount
  } coaching appointment${view.meetingCount === 1 ? '' : 's'}`;

  return `
    <p class="help-text" id="bookings-summary">${escapeHtml(summary)}</p>
    <div class="table-wrap">
      <table class="bookings-table">
        <caption class="visually-hidden">Meetings for ${escapeHtml(coach)}, in date order</caption>
        <thead>
          <tr><th>Date</th><th>Day</th><th>Start</th><th>End</th><th>Student</th><th>Class block</th><th class="num">Meeting</th><th>Service name</th><th>Term week</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

/**
 * One student's term: their own class block's classes and their coaching
 * meetings on a single timeline, with the coach they were given. A student who
 * was never assigned still gets their classes and an explicit reason, rather
 * than an empty panel or an invented meeting.
 */
function renderStudentBookingsPanel(eng) {
  const student = eng.studentRows.find((row) => row.contactSfId === state.bookings.studentId);
  if (!student) {
    return bookingsEmptyState('Choose a student to see their classes, their coaching meetings, and their coach.');
  }

  const view = buildStudentTimeline(student, {
    appointments: eng.appointments,
    assignments: eng.assignments,
    unassigned: eng.unassigned,
    exceptions: eng.exceptions,
    classBlocks: eng.classBlocks,
    startMonday: state.startDate,
  });

  const coachLine = view.coach
    ? `Coach: <strong>${escapeHtml(view.coach)}</strong>`
    : `<span class="chip chip-exception">Unassigned${
        view.unassignedReason ? ` — ${escapeHtml(view.unassignedReason)}` : ''
      }</span>`;
  const blockLine = view.classBlockKnown
    ? `Class block: <strong>${escapeHtml(view.classBlockName || '(unnamed)')}</strong>`
    : `<span class="chip chip-exception">Class block ${
        view.classBlockName ? `"${escapeHtml(view.classBlockName)}" is not in the class schedule` : 'is missing'
      }</span>`;
  const exceptionLine =
    view.exceptions.length > 0
      ? ` · <span class="chip chip-exception">${view.exceptions.length} meeting${
          view.exceptions.length === 1 ? '' : 's'
        } could not be rebooked</span>`
      : '';

  const header = `
    <p class="help-text" id="bookings-summary">
      ${escapeHtml(student.studentName)} <span class="mono">${escapeHtml(student.contactSfId)}</span> ·
      ${coachLine} · ${blockLine} ·
      <span class="mono-500">${view.classCount}</span> class session${view.classCount === 1 ? '' : 's'} ·
      <span class="mono-500">${view.coachingCount}</span> coaching meeting${view.coachingCount === 1 ? '' : 's'}${exceptionLine}
    </p>`;

  if (view.entries.length === 0) {
    return `${header}${bookingsEmptyState(
      'This student has no class sessions and no coaching meetings in this schedule.'
    )}`;
  }

  const rows = view.entries
    .map((entry) => {
      const typeChip =
        entry.type === 'class'
          ? '<span class="chip chip-neutral">Class</span>'
          : '<span class="chip chip-ok">Coaching</span>';
      const detail =
        entry.type === 'class'
          ? escapeHtml(entry.label || 'Class')
          : escapeHtml(entry.label);
      const who = entry.type === 'coaching' ? escapeHtml(entry.coachName) : escapeHtml(entry.classBlock || '—');
      const moved =
        entry.type === 'coaching' && entry.rescheduledFromWeek !== '' && entry.rescheduledFromWeek !== undefined
          ? ` <span class="chip chip-warn">Moved from week ${escapeHtml(String(entry.rescheduledFromWeek))}</span>`
          : '';
      return `
    <tr>
      <td class="mono">${escapeHtml(entry.date)}</td>
      <td>${escapeHtml(entry.day)}</td>
      <td class="mono">${escapeHtml(entry.startTime)}</td>
      <td class="mono">${escapeHtml(entry.endTime)}</td>
      <td>${typeChip}</td>
      <td>${detail}</td>
      <td>${who}</td>
      <td>${weekChip(entry.weekNumber)}${moved}</td>
    </tr>`;
    })
    .join('');

  const coachingNote =
    view.coachingCount === 0
      ? '<p class="help-text">This student has no coaching meetings in this schedule. Their classes are shown so their week is still complete.</p>'
      : '';

  return `
    ${header}
    ${coachingNote}
    <div class="table-wrap">
      <table class="bookings-table">
        <caption class="visually-hidden">Classes and coaching meetings for ${escapeHtml(
          student.studentName
        )}, in date order</caption>
        <thead>
          <tr><th>Date</th><th>Day</th><th>Start</th><th>End</th><th>Type</th><th>Class or meeting</th><th>Coach / class block</th><th>Term week</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function bookingsPanelHtml(eng) {
  return state.bookings.view === 'student' ? renderStudentBookingsPanel(eng) : renderCoachBookingsPanel(eng);
}

/** Re-renders just the panel, so the selectors keep their focus and scroll position. */
function refreshBookingsPanel() {
  const panel = document.getElementById('bookings-panel');
  if (!panel) return;
  const eng = guard('showing the bookings', computeEngineState);
  if (!eng) return;
  panel.innerHTML = bookingsPanelHtml(eng);
  updateCoachCalendarButton(eng);
}

/**
 * The coach calendar button (SPEC.md §7.4). It names the selected coach, and
 * is only enabled when that coach actually has meetings to export — an empty
 * archive is not a useful download, so the panel says so instead.
 */
function updateCoachCalendarButton(eng) {
  const btn = document.getElementById('export-calendar-btn');
  if (!btn) return;
  const coach = state.bookings.coach;
  // Counted, not serialised: the button's state must not cost a calendar file
  // per meeting on every re-render.
  const exportable = coach ? exportableCoachMeetings(eng.appointments, coach) : [];
  btn.disabled = exportable.length === 0;
  btn.textContent = 'Export coach calendar (.zip)';
  btn.setAttribute(
    'aria-label',
    coach
      ? `Download a ZIP of calendar files, one .ics per meeting, for ${coach}`
      : 'Download a ZIP of calendar files for the selected coach — choose a coach first'
  );
  const note = document.getElementById('bookings-export-note');
  if (note) {
    const meetings = coach ? buildCoachBookings(eng.appointments, coach).meetingCount : 0;
    if (!coach) {
      note.textContent = 'Choose a coach to enable the calendar download.';
    } else if (exportable.length === 0 && meetings > 0) {
      note.textContent = `${coach}'s meetings have no usable date and time, so there is nothing to put in a calendar file.`;
    } else if (exportable.length === 0) {
      note.textContent = `${coach} has no meetings to export.`;
    } else {
      note.textContent = `${exportable.length} calendar file${
        exportable.length === 1 ? '' : 's'
      }, one per meeting, in a single .zip.`;
    }
  }
}

/** Fills the student <select> from the current search box contents. */
function fillStudentOptions(eng) {
  const select = document.getElementById('bookings-student');
  if (!select) return;
  const matches = filterStudents(eng.studentRows, state.bookings.studentQuery);
  const shown = matches.slice(0, 200);
  if (!shown.some((student) => student.contactSfId === state.bookings.studentId)) {
    state.bookings.studentId = null;
  }
  const options = [
    `<option value="">${matches.length === 0 ? 'No students match your search' : 'Choose a student'}</option>`,
    ...shown.map(
      (student) =>
        `<option value="${escapeHtml(student.contactSfId)}">${escapeHtml(student.studentName)} — ${escapeHtml(
          student.contactSfId
        )}</option>`
    ),
  ];
  select.innerHTML = options.join('');
  select.value = state.bookings.studentId || '';
  select.disabled = matches.length === 0;

  const note = document.getElementById('bookings-student-note');
  if (note) {
    note.textContent =
      matches.length > shown.length
        ? `Showing the first ${shown.length} of ${matches.length} matching students. Narrow the search to see the rest.`
        : `${matches.length} student${matches.length === 1 ? '' : 's'} to choose from.`;
  }
}

/**
 * The Bookings card (SPEC.md §14): a two-segment view toggle, a selector for
 * the chosen side, and one results panel. Built as real elements rather than a
 * markup string so the controls can be wired without re-rendering the whole of
 * Results on every keystroke.
 */
function renderBookingsSection(eng) {
  const mount = document.getElementById('bookings-mount');
  if (!mount) return;

  const isStudentView = state.bookings.view === 'student';
  const coaches = bookingCoaches(eng.coaches, eng.appointments);
  if (state.bookings.coach && !coaches.includes(state.bookings.coach)) state.bookings.coach = null;

  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <h2 id="bookings-heading">Bookings</h2>
    <p class="help-text">Look up the generated schedule from either side: a coach's students, or a student's week. This is a read-only view of the schedule above.</p>
    <div class="toggle-group bookings-toggle" role="radiogroup" aria-labelledby="bookings-heading">
      <label class="toggle-option">
        <input type="radio" name="bookings-view" value="coach"${isStudentView ? '' : ' checked'} />
        <span><strong>By coach</strong><small>Who is this coach meeting, and when?</small></span>
      </label>
      <label class="toggle-option">
        <input type="radio" name="bookings-view" value="student"${isStudentView ? ' checked' : ''} />
        <span><strong>By student</strong><small>When does this student have class and coaching?</small></span>
      </label>
    </div>
    <div class="bookings-controls">
      ${
        isStudentView
          ? `<label class="field">
               <span>Search students</span>
               <input type="search" id="bookings-student-search" placeholder="Name or Contact SF ID" value="${escapeHtml(
                 state.bookings.studentQuery
               )}" aria-describedby="bookings-student-note" />
             </label>
             <label class="field">
               <span>Student</span>
               <select id="bookings-student"></select>
             </label>`
          : `<label class="field">
               <span>Coach</span>
               <select id="bookings-coach">
                 <option value="">${coaches.length === 0 ? 'No coaches in this schedule' : 'Choose a coach'}</option>
                 ${coaches
                   .map(
                     (name) =>
                       `<option value="${escapeHtml(name)}"${
                         name === state.bookings.coach ? ' selected' : ''
                       }>${escapeHtml(name)}</option>`
                   )
                   .join('')}
               </select>
             </label>
             <div class="bookings-export">
               <button type="button" id="export-calendar-btn" class="btn btn-secondary" disabled>Export coach calendar (.zip)</button>
               <p class="help-text" id="bookings-export-note"></p>
             </div>`
      }
    </div>
    ${isStudentView ? '<p class="help-text" id="bookings-student-note"></p>' : ''}
    <div id="bookings-panel" role="region" aria-live="polite" aria-labelledby="bookings-heading"></div>`;

  mount.replaceChildren(card);

  card.querySelectorAll('input[name="bookings-view"]').forEach((radio) => {
    radio.addEventListener(
      'change',
      guarded('switching the bookings view', () => {
        if (!radio.checked) return;
        state.bookings.view = radio.value === 'student' ? 'student' : 'coach';
        const fresh = computeEngineState();
        renderBookingsSection(fresh);
        // The card was rebuilt, so move focus back to the segment just chosen.
        const focused = document.querySelector(`input[name="bookings-view"][value="${state.bookings.view}"]`);
        if (focused) focused.focus();
      })
    );
  });

  const coachSelect = card.querySelector('#bookings-coach');
  if (coachSelect) {
    coachSelect.disabled = coaches.length === 0;
    coachSelect.addEventListener(
      'change',
      guarded('choosing a coach to view', () => {
        state.bookings.coach = coachSelect.value || null;
        refreshBookingsPanel();
      })
    );
  }

  const search = card.querySelector('#bookings-student-search');
  if (search) {
    search.addEventListener(
      'input',
      guarded('searching for a student', () => {
        state.bookings.studentQuery = search.value;
        const fresh = computeEngineState();
        fillStudentOptions(fresh);
        refreshBookingsPanel();
      })
    );
  }

  const studentSelect = card.querySelector('#bookings-student');
  if (studentSelect) {
    fillStudentOptions(eng);
    studentSelect.addEventListener(
      'change',
      guarded('choosing a student to view', () => {
        state.bookings.studentId = studentSelect.value || null;
        refreshBookingsPanel();
      })
    );
  }

  const panel = card.querySelector('#bookings-panel');
  panel.innerHTML = bookingsPanelHtml(eng);
  updateCoachCalendarButton(eng);

  const exportBtn = card.querySelector('#export-calendar-btn');
  if (exportBtn) exportBtn.addEventListener('click', guarded('creating the coach calendar', handleCoachCalendarExport));
}

/** SPEC.md §7.4 — one .ics per meeting for the selected coach, in one .zip. */
function handleCoachCalendarExport() {
  if (!hasResultsInputs()) {
    showError('There is nothing to export yet.', blockedExplanation(), 'export-calendar');
    return;
  }
  const coach = state.bookings.coach;
  if (!coach) {
    showError('Choose a coach before exporting a calendar.', null, 'export-calendar');
    return;
  }
  // Rebuilt at click time, so the archive always reflects the current schedule.
  const eng = guard('rebuilding the schedule for the calendar export', computeEngineState);
  if (!eng) return;
  if (exportableCoachMeetings(eng.appointments, coach).length === 0) {
    showError(
      `${coach} has no scheduled meetings, so there is nothing to export.`,
      'Choose a coach with meetings, or check the unassigned students table.',
      'export-calendar'
    );
    return;
  }
  guard('creating the coach calendar file', () => exportCoachCalendar(eng.appointments, coach, calendarOptions()));
}

function renderResults() {
  const container = document.getElementById('results-content');
  const sub = document.getElementById('results-sub');
  if (!container || !sub) throw new Error('The page is missing the results content elements.');

  if (!hasResultsInputs()) {
    sub.textContent = 'The schedule, exceptions, and export appear here.';
    container.innerHTML = `<div class="card"><div class="table-wrap"><p class="table-empty">${escapeHtml(
      blockedExplanation()
    )}</p></div></div>`;
    return;
  }

  const eng = computeEngineState();
  const scheduledCount = eng.assignments.length;
  const unassignedChip = eng.unassigned.length > 0 ? ` · <span class="chip chip-exception">${eng.unassigned.length} unassigned</span>` : '';
  const exceptionChip =
    eng.exceptions.length > 0 ? ` · <span class="chip chip-exception">${eng.exceptions.length} exception${eng.exceptions.length === 1 ? '' : 's'}</span>` : '';
  const movedNote =
    eng.movedCount > 0
      ? ` · <span class="mono-500">${eng.movedCount}</span> meeting${eng.movedCount === 1 ? '' : 's'} moved around blocked weeks`
      : '';

  sub.innerHTML = `<span class="mono-500">${scheduledCount}</span> of <span class="mono-500">${eng.studentCount}</span> students scheduled · <span class="mono-500">${eng.appointments.length}</span> appointments${movedNote}${unassignedChip}${exceptionChip}`;

  const parts = [
    renderUtilisationTable(eng),
    renderClassBlockResults(eng),
    renderExceptionsTable(eng),
    renderAppointmentsPreview(eng),
    // The bookings card (SPEC.md §14) is built as elements after this markup
    // lands, so its selectors can be wired without re-rendering all of Results.
    '<div id="bookings-mount"></div>',
    renderCoachAssignmentsExport(eng),
  ];

  container.innerHTML = parts.join('');
  attachExportButtonHandler();
  attachCoachAssignmentsButtonHandler();
  guard('showing the bookings', () => renderBookingsSection(eng));
}

/**
 * Recomputes and re-renders Review and Results together, regardless of
 * which step is currently visible, so both stay in sync with uploads, mode,
 * FTE values, start date, and the export mapping (SPEC.md §5, §6, §7).
 */
function refreshComputedSteps() {
  guard('working out coach capacity', renderReview);
  guard('building the schedule', renderResults);
  guard('updating the blocked weeks and dates panel', renderBlockingContext);
}

/**
 * Keeps the blocking panel and the display-only ribbons in step with the
 * current schedule. The panel's ribbon is the coach view (DESIGN.md §3.1), so
 * it alone shows blocked weeks; the Review/Results ribbons only carry the
 * exception dot, which is not coach-specific.
 */
function renderBlockingContext() {
  const eng = hasCoreUploads() ? computeEngineState() : null;

  const exceptionWeeksByCoach = new Map();
  const exceptionWeeks = new Set();
  (eng?.exceptions || []).forEach(({ coach, week }) => {
    if (!exceptionWeeksByCoach.has(coach)) exceptionWeeksByCoach.set(coach, new Set());
    exceptionWeeksByCoach.get(coach).add(week);
    exceptionWeeks.add(week);
  });

  renderBlockingPanel(exceptionWeeksByCoach);

  const weekStates = {};
  exceptionWeeks.forEach((week) => {
    weekStates[week] = { exceptions: true };
  });
  document.querySelectorAll('.ribbon-mount[data-ribbon]').forEach((mount) => {
    renderTermRibbon(mount, { label: 'Term structure', weekStates });
  });
}

// ---- Export settings (SPEC.md §7.2) ----

function persistExportMapping() {
  setExportMapping(state.exportMapping);
}

/** The preview table follows the mapping, so every edit re-renders Results. */
function refreshResults() {
  guard('updating the appointments preview', renderResults);
}

function moveMappingColumn(index, direction) {
  const newIndex = index + direction;
  if (newIndex < 0 || newIndex >= state.exportMapping.length) return;
  const [col] = state.exportMapping.splice(index, 1);
  state.exportMapping.splice(newIndex, 0, col);
  persistExportMapping();
  renderMappingEditor();
  refreshResults();
}

function removeMappingColumn(index) {
  state.exportMapping.splice(index, 1);
  persistExportMapping();
  renderMappingEditor();
  refreshResults();
}

function renderMappingEditor() {
  const tbody = mustFind('mapping-tbody');
  tbody.innerHTML = '';

  state.exportMapping.forEach((col, index) => {
    const tr = document.createElement('tr');

    const orderTd = document.createElement('td');
    const upBtn = document.createElement('button');
    upBtn.type = 'button';
    upBtn.className = 'icon-btn';
    upBtn.textContent = '↑';
    upBtn.setAttribute('aria-label', `Move "${col.header || 'column'}" up`);
    upBtn.disabled = index === 0;
    upBtn.addEventListener('click', guarded('moving a column up', () => moveMappingColumn(index, -1)));
    const downBtn = document.createElement('button');
    downBtn.type = 'button';
    downBtn.className = 'icon-btn';
    downBtn.textContent = '↓';
    downBtn.setAttribute('aria-label', `Move "${col.header || 'column'}" down`);
    downBtn.disabled = index === state.exportMapping.length - 1;
    downBtn.addEventListener('click', guarded('moving a column down', () => moveMappingColumn(index, 1)));
    orderTd.append(upBtn, downBtn);

    const includeTd = document.createElement('td');
    const includeCheckbox = document.createElement('input');
    includeCheckbox.type = 'checkbox';
    includeCheckbox.checked = col.included;
    includeCheckbox.setAttribute('aria-label', `Include "${col.header || 'column'}" in the export`);
    includeCheckbox.addEventListener(
      'change',
      guarded('including or excluding a column', () => {
        col.included = includeCheckbox.checked;
        persistExportMapping();
        refreshResults();
      })
    );
    includeTd.appendChild(includeCheckbox);

    const headerTd = document.createElement('td');
    const headerInput = document.createElement('input');
    headerInput.type = 'text';
    headerInput.value = col.header;
    headerInput.setAttribute('aria-label', 'Column header');
    headerInput.addEventListener(
      'input',
      guarded('renaming a column', () => {
        col.header = headerInput.value;
        persistExportMapping();
        refreshResults();
      })
    );
    headerTd.appendChild(headerInput);

    const valueTd = document.createElement('td');
    if (col.type === 'constant') {
      const valueInput = document.createElement('input');
      valueInput.type = 'text';
      valueInput.value = col.value ?? '';
      valueInput.setAttribute('aria-label', 'Fixed value for every row');
      valueInput.addEventListener(
        'input',
        guarded('editing a constant value', () => {
          col.value = valueInput.value;
          persistExportMapping();
          refreshResults();
        })
      );
      valueTd.appendChild(valueInput);
    } else {
      const label = document.createElement('span');
      label.className = 'mono field-source';
      label.textContent = FIELD_LABELS[col.field] || col.field;
      valueTd.appendChild(label);
    }

    const removeTd = document.createElement('td');
    if (col.type === 'constant') {
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'btn btn-destructive btn-small';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', guarded('removing a column', () => removeMappingColumn(index)));
      removeTd.appendChild(removeBtn);
    }

    tr.append(orderTd, includeTd, headerTd, valueTd, removeTd);
    tbody.appendChild(tr);
  });
}

function setupExportSettings() {
  const toggleBtn = mustFind('export-settings-toggle');
  const body = mustFind('export-settings-body');
  toggleBtn.addEventListener(
    'click',
    guarded('opening the export settings', () => {
      const expanded = toggleBtn.getAttribute('aria-expanded') === 'true';
      toggleBtn.setAttribute('aria-expanded', String(!expanded));
      body.hidden = expanded;
    })
  );

  mustFind('add-constant-btn').addEventListener(
    'click',
    guarded('adding a constant column', () => {
      state.exportMapping.push(createConstantColumn('New column', ''));
      persistExportMapping();
      renderMappingEditor();
      refreshResults();
    })
  );

  mustFind('reset-mapping-btn').addEventListener(
    'click',
    guarded('resetting the export columns', () => {
      state.exportMapping = getDefaultMapping();
      persistExportMapping();
      renderMappingEditor();
      refreshResults();
    })
  );

  renderMappingEditor();
}

// ---- Start over ----

/**
 * Clears the session's in-memory data and, when asked, the saved settings
 * too. Uploaded rows only ever live in `state.uploads`, so dropping them
 * (plus resetting the file inputs) is all it takes to leave nothing behind.
 */
function startOver(alsoClearSettings) {
  clearAllUploads();
  clearAlerts();
  setBlockingSheetOpen(false);

  if (alsoClearSettings) {
    clearSettings();
    state.startDate = null;
    state.mode = 'auto';
    state.campusId = DEFAULT_CAMPUS_ID;
    state.exportMapping = getDefaultMapping();
    state.blocks = [];
    state.blockingCoach = null;
    showBlockingNotice('');
    campusSelect.value = DEFAULT_CAMPUS_ID;
    renderCampusNotice();
    startDateInput.value = '';
    dateNotice.hidden = true;
    modeAutoInput.checked = true;
    modePreAllocatedInput.checked = false;
    pairingsUploadCard.hidden = true;
    renderMappingEditor();
  }

  goToStep(0);
  refreshComputedSteps();
}

function setupStartOver() {
  const supportsDialog = typeof startOverDialog.showModal === 'function';

  startOverBtn.addEventListener(
    'click',
    guarded('opening the start over dialog', () => {
      startOverClearSettings.checked = false;
      if (supportsDialog) {
        startOverDialog.showModal();
        return;
      }
      // Very old browsers with no <dialog>: same two questions, plain confirms.
      if (!window.confirm('Start over? This clears the files you have uploaded and the schedule built from them.')) return;
      startOver(window.confirm('Also clear saved settings (start date, mode, FTE values, and export column layout)?'));
    })
  );

  startOverForm.addEventListener(
    'submit',
    guarded('starting over', (event) => {
      const choice = event.submitter ? event.submitter.value : startOverDialog.returnValue;
      if (choice !== 'confirm') return;
      startOver(startOverClearSettings.checked);
    })
  );
}

function init() {
  // SPEC.md §2's one dependency. Without it nothing can be read or written,
  // so say so up front instead of failing on the first upload.
  if (!isXLSXAvailable()) {
    showError(XLSX_MISSING_MESSAGE, null, 'xlsx');
    document.querySelectorAll('.dropzone').forEach((dropzone) => {
      dropzone.classList.add('dropzone-disabled');
      const input = dropzone.querySelector('.file-input');
      if (input) input.disabled = true;
    });
  }

  // Restore persisted settings into the controls.
  if (state.startDate) {
    startDateInput.value = state.startDate;
  }
  if (state.mode === 'pre-allocated') {
    modePreAllocatedInput.checked = true;
  } else {
    modeAutoInput.checked = true;
  }
  pairingsUploadCard.hidden = state.mode !== 'pre-allocated';

  campusSelect.innerHTML = CAMPUSES.map(
    (campus) => `<option value="${campus.id}">${escapeHtml(campus.label)}</option>`
  ).join('');
  campusSelect.value = state.campusId;
  renderCampusNotice();

  startDateInput.addEventListener('change', guarded('reading the start date', handleStartDateChange));
  campusSelect.addEventListener(
    'change',
    guarded('changing the campus', () => handleCampusChange(campusSelect.value))
  );
  modeAutoInput.addEventListener('change', guarded('switching to auto-assign mode', () => handleModeChange('auto')));
  modePreAllocatedInput.addEventListener(
    'change',
    guarded('switching to pre-allocated mode', () => handleModeChange('pre-allocated'))
  );

  backBtn.addEventListener('click', guarded('going back a step', () => goToStep(state.stepIndex - 1)));
  nextBtn.addEventListener('click', guarded('going to the next step', () => goToStep(state.stepIndex + 1)));

  stepperItems.forEach((item) => {
    item.addEventListener('click', guarded('changing step', () => goToStep(STEPS.indexOf(item.dataset.step))));
    item.style.cursor = 'pointer';
  });

  // Display-only term ribbon (DESIGN.md §3.1) on Review and Results. It is
  // also the basis for the §11 blocking grid, which reuses ribbon.js.
  guard('drawing the term ribbon', () => {
    document.querySelectorAll('.ribbon-mount[data-ribbon]').forEach((mount) => {
      renderTermRibbon(mount, { label: 'Term structure' });
    });
  });

  UPLOAD_KEYS.forEach((key) => guard(`setting up the ${UPLOAD_LABELS[key]} upload`, () => setupUpload(key)));
  mustFind('clear-uploads-btn').addEventListener('click', guarded('clearing the uploads', clearAllUploads));

  state.blocks = sanitiseBlocks(getBlocks());

  setupStartOver();
  guard('setting up the blocked weeks and dates panel', setupBlockingPanel);
  guard('setting up the export settings panel', setupExportSettings);

  renderStep();
  refreshComputedSteps();
}

try {
  init();
} catch (error) {
  showError('The app could not start.', describeError(error), 'init');
}
