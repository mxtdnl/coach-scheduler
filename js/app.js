// UI wiring, state, step flow (SPEC.md §6).
// Upload parsing/validation is wired against parse.js; Review and Results
// are wired against scheduler.js (SPEC.md §5, §9); export (§7, default and
// customisable) is wired against exporter.js.

import {
  getStartDate,
  setStartDate,
  getMode,
  setMode,
  getFteMap,
  setFte,
  getExportMapping,
  setExportMapping,
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
import { renderTermRibbon } from './ribbon.js';
import {
  parseClassSchedule,
  parseCoachAvailability,
  parseStudentList,
  parsePairings,
  checkPairingsReferences,
} from './parse.js';
import {
  buildSlots,
  computeQuotas,
  schedule,
  expandToAppointments,
  MAX_STUDENTS_PER_SLOT,
  REASONS,
} from './scheduler.js';
import {
  getDefaultMapping,
  createConstantColumn,
  buildPreviewRows,
  exportAppointments,
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

const state = {
  stepIndex: 0,
  startDate: getStartDate() || null, // ISO yyyy-mm-dd, Monday-normalised
  mode: storedMode === 'pre-allocated' ? 'pre-allocated' : 'auto',
  uploads: { classSchedule: null, coachAvailability: null, studentList: null, pairings: null },
  exportMapping: sanitiseMapping(getExportMapping()) || getDefaultMapping(),
};

/** Looks up a required element, failing with a message that names it. */
function mustFind(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`The page is missing the "${id}" element, so the app cannot start.`);
  return el;
}

const startDateInput = mustFind('start-date-input');
const dateNotice = mustFind('date-notice');
const modeAutoInput = mustFind('mode-auto');
const modePreAllocatedInput = mustFind('mode-pre-allocated');
const pairingsUploadCard = mustFind('pairings-upload-card');
const backBtn = mustFind('back-btn');
const nextBtn = mustFind('next-btn');
const startOverBtn = mustFind('start-over-btn');
const startOverDialog = mustFind('start-over-dialog');
const startOverForm = mustFind('start-over-form');
const startOverClearSettings = mustFind('start-over-clear-settings');
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

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value;
  return div.innerHTML;
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
  if (key !== 'pairings') return upload.result;

  const studentIds = new Set((state.uploads.studentList?.result.rows ?? []).map((r) => r.contactSfId));
  const coachNames = new Set((state.uploads.coachAvailability?.result.rows ?? []).map((r) => r.coachName));
  const crossWarnings = checkPairingsReferences(upload.fileName, upload.result.rows, studentIds, coachNames);
  return {
    rows: upload.result.rows,
    errors: upload.result.errors,
    warnings: [...upload.result.warnings, ...crossWarnings],
  };
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
  const classBlocks = rowsFor('classSchedule');
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
    ({ assignments, unassigned } = schedule(studentRows, slots, 'pre-allocated', pairingRows, coaches));
  } else {
    quotas = computeQuotas(coaches, fte, studentCount, slotCounts);
    ({ assignments, unassigned } = schedule(studentRows, slots, 'auto', quotas));
  }

  const appointments = state.startDate ? expandToAppointments(assignments, state.startDate) : [];

  const scheduledByCoach = {};
  coaches.forEach((c) => {
    scheduledByCoach[c] = 0;
  });
  assignments.forEach((a) => {
    scheduledByCoach[a.coach] = (scheduledByCoach[a.coach] || 0) + 1;
  });

  return {
    coaches,
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
    scheduledByCoach,
  };
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

function renderUnassignedTable(eng) {
  if (eng.unassigned.length === 0) {
    return `
    <div class="card">
      <h2>Unassigned students</h2>
      <div class="table-wrap"><p class="table-empty">All students were scheduled.</p></div>
    </div>`;
  }

  const rows = eng.unassigned
    .map(
      ({ student, reason }) => `
    <tr>
      <td>${escapeHtml(student.studentName)} <span class="mono">${escapeHtml(student.contactSfId)}</span></td>
      <td><span class="chip chip-exception">${escapeHtml(capitalize(reason))}</span></td>
    </tr>`
    )
    .join('');

  return `
    <div class="card">
      <h2>Unassigned students</h2>
      <p class="help-text">${eng.unassigned.length} student${eng.unassigned.length === 1 ? '' : 's'} could not be scheduled.</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Student</th><th>Reason</th></tr></thead>
          <tbody>${rows}</tbody>
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

  sub.innerHTML = `<span class="mono-500">${scheduledCount}</span> of <span class="mono-500">${eng.studentCount}</span> students scheduled · <span class="mono-500">${eng.appointments.length}</span> appointments${unassignedChip}`;

  const parts = [renderUtilisationTable(eng), renderUnassignedTable(eng), renderAppointmentsPreview(eng)];

  container.innerHTML = parts.join('');
  attachExportButtonHandler();
}

/**
 * Recomputes and re-renders Review and Results together, regardless of
 * which step is currently visible, so both stay in sync with uploads, mode,
 * FTE values, start date, and the export mapping (SPEC.md §5, §6, §7).
 */
function refreshComputedSteps() {
  guard('working out coach capacity', renderReview);
  guard('building the schedule', renderResults);
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

  if (alsoClearSettings) {
    clearSettings();
    state.startDate = null;
    state.mode = 'auto';
    state.exportMapping = getDefaultMapping();
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

  startDateInput.addEventListener('change', guarded('reading the start date', handleStartDateChange));
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
    document.querySelectorAll('.ribbon-mount').forEach((mount) => {
      renderTermRibbon(mount, { label: 'Term structure' });
    });
  });

  UPLOAD_KEYS.forEach((key) => guard(`setting up the ${UPLOAD_LABELS[key]} upload`, () => setupUpload(key)));
  mustFind('clear-uploads-btn').addEventListener('click', guarded('clearing the uploads', clearAllUploads));

  setupStartOver();
  guard('setting up the export settings panel', setupExportSettings);

  renderStep();
  refreshComputedSteps();
}

try {
  init();
} catch (error) {
  showError('The app could not start.', describeError(error), 'init');
}
