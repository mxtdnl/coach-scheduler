// UI wiring, state, step flow (SPEC.md §6).
// Upload parsing/validation is wired against parse.js; Review and Results
// are wired against scheduler.js (SPEC.md §5, §9). Export is a later
// session's work.

import { getStartDate, setStartDate, getMode, setMode, getFteMap, setFte } from './storage.js';
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

const state = {
  stepIndex: 0,
  startDate: getStartDate() || null, // ISO yyyy-mm-dd, Monday-normalised
  mode: getMode() || 'auto',
  uploads: { classSchedule: null, coachAvailability: null, studentList: null, pairings: null },
};

const startDateInput = document.getElementById('start-date-input');
const dateNotice = document.getElementById('date-notice');
const modeAutoInput = document.getElementById('mode-auto');
const modePreAllocatedInput = document.getElementById('mode-pre-allocated');
const pairingsUploadCard = document.getElementById('pairings-upload-card');
const backBtn = document.getElementById('back-btn');
const nextBtn = document.getElementById('next-btn');
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
  return date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function handleStartDateChange() {
  const pickedDate = startDateInput.value;
  if (!pickedDate) return;

  const monday = normaliseToMonday(pickedDate);
  state.startDate = monday;
  setStartDate(monday);
  startDateInput.value = monday;

  if (monday !== pickedDate) {
    dateNotice.textContent = `Adjusted to ${formatReadable(monday)} — the Monday of that week.`;
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
  nextBtn.textContent = state.stepIndex === STEPS.length - 1 ? 'Done' : 'Next';
  nextBtn.disabled = state.stepIndex === STEPS.length - 1;
}

function goToStep(index) {
  state.stepIndex = Math.min(Math.max(index, 0), STEPS.length - 1);
  renderStep();
}

// ---- Upload step ----

function getUploadElements(key) {
  const dropzone = document.querySelector(`.dropzone[data-upload="${key}"]`);
  const card = dropzone.closest('.upload-card');
  return {
    dropzone,
    fileInput: dropzone.querySelector('.file-input'),
    filenameEl: dropzone.querySelector('.dropzone-filename'),
    resultEl: card.querySelector('.upload-result'),
  };
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value;
  return div.innerHTML;
}

function renderIssueList(label, issues) {
  const items = issues
    .map((issue) => `<li>${issue.row ? `Row ${issue.row}: ` : ''}${escapeHtml(issue.message)}</li>`)
    .join('');
  return `<div class="issue-group"><strong>${label}</strong><ul>${items}</ul></div>`;
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
  const { filenameEl, resultEl } = getUploadElements(key);
  const upload = state.uploads[key];

  if (!upload) {
    filenameEl.hidden = true;
    filenameEl.textContent = '';
    resultEl.hidden = true;
    resultEl.innerHTML = '';
    resultEl.classList.remove('upload-result-success', 'upload-result-error');
    return;
  }

  filenameEl.hidden = false;
  filenameEl.textContent = upload.fileName;

  const display = computeDisplayResult(key);
  const hasErrors = display.errors.length > 0;

  resultEl.hidden = false;
  resultEl.classList.toggle('upload-result-error', hasErrors);
  resultEl.classList.toggle('upload-result-success', !hasErrors);

  const parts = [];
  if (hasErrors) {
    const count = display.errors.length;
    parts.push(`<p class="upload-result-summary">${count} error${count === 1 ? '' : 's'} found — fix and re-upload.</p>`);
    parts.push(renderIssueList('Errors', display.errors));
    if (display.warnings.length > 0) parts.push(renderIssueList('Warnings', display.warnings));
  } else {
    const count = display.rows.length;
    parts.push(`<p class="upload-result-summary">${count} row${count === 1 ? '' : 's'} parsed successfully.</p>`);
    if (display.warnings.length > 0) parts.push(renderIssueList('Warnings', display.warnings));
  }
  resultEl.innerHTML = parts.join('');
}

async function handleFileForKey(key, file) {
  const result = await UPLOAD_PARSERS[key](file);
  state.uploads[key] = { fileName: file.name, result };
  renderUploadResult(key);

  // Pairings' displayed warnings depend on these two files; refresh it too.
  if (key === 'studentList' || key === 'coachAvailability') {
    renderUploadResult('pairings');
  }

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
  dropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    dropzone.classList.remove('dropzone-active');
    const file = event.dataTransfer.files[0];
    if (!file) return;
    fileInput.files = event.dataTransfer.files;
    handleFileForKey(key, file);
  });
}

// ---- Review & Results steps (SPEC.md §5, §6, §9) ----

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function hasCoreUploads() {
  return Boolean(state.uploads.classSchedule && state.uploads.coachAvailability && state.uploads.studentList);
}

function hasResultsInputs() {
  if (!hasCoreUploads()) return false;
  if (state.mode === 'pre-allocated' && !state.uploads.pairings) return false;
  return Boolean(state.startDate);
}

/**
 * Runs the scheduling engine end-to-end against the current uploads, mode,
 * FTE values, and start date. Cheap and pure, so it's safe to call on every
 * render rather than caching — this is what keeps Review/Results in sync
 * whenever an input changes.
 */
function computeEngineState() {
  const availabilityRows = state.uploads.coachAvailability?.result.rows ?? [];
  const classBlocks = state.uploads.classSchedule?.result.rows ?? [];
  const studentRows = state.uploads.studentList?.result.rows ?? [];
  const pairingRows = state.uploads.pairings?.result.rows ?? [];

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

/** SPEC.md §11.1 term structure — Block N = weeks; weeks 4/8/12 excluded. */
function renderTermRibbon() {
  const block = (n, weeks) =>
    `<div class="blockgroup g${n}"><span>Block ${n}</span><div class="weeks">${weeks
      .map((w) => `<div class="wk">${w}</div>`)
      .join('')}</div></div>`;
  const dead = (n) =>
    `<div class="blockgroup"><span>&nbsp;</span><div class="weeks"><div class="wk dead" title="No meetings — excluded week">${n}</div></div></div>`;

  return `<div class="ribbon" aria-label="Term structure">${block(1, [1, 2, 3])}${dead(4)}${block(2, [5, 6, 7])}${dead(8)}${block(3, [9, 10, 11])}${dead(12)}${block(4, [13, 14, 15])}</div>`;
}

function renderFteAndCapacityTable(eng) {
  const rows = eng.coaches
    .map(
      (c) => `
    <tr>
      <td>${escapeHtml(c)}</td>
      <td class="mono num">${eng.slotCounts[c] || 0}</td>
      <td class="mono num">${eng.capacity[c] || 0}</td>
      <td><input type="number" class="fte-input" data-coach="${escapeHtml(c)}" min="0.05" max="1.00" step="0.05" value="${eng.fte[c].toFixed(2)}" aria-label="FTE for ${escapeHtml(c)}" /></td>
      <td class="mono5 num">${eng.quotas[c] || 0}</td>
    </tr>`
    )
    .join('');

  return `
    <div class="rcard">
      <div class="rcard-header">
        <h3>Coach capacity</h3>
        <p class="rcard-desc">FTE changes recalculate quotas immediately.</p>
      </div>
      <div class="table-scroll">
        <table>
          <thead><tr><th>Coach</th><th class="num">Valid slots</th><th class="num">Capacity</th><th>FTE</th><th class="num">Quota</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="5" class="rcard-empty">No coaches found in the availability file.</td></tr>`}</tbody>
        </table>
      </div>
    </div>`;
}

function attachFteInputHandlers() {
  document.querySelectorAll('#review-content .fte-input').forEach((input) => {
    input.addEventListener('change', () => {
      const coach = input.dataset.coach;
      let value = Number(input.value);
      if (!Number.isFinite(value)) value = 1;
      value = Math.round(Math.min(1, Math.max(0.05, value)) * 100) / 100;
      setFte(coach, value);
      refreshComputedSteps();
    });
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
  const requested = computeRequestedPairings(eng);

  const rows = eng.coaches
    .map((c) => {
      const req = requested[c] || 0;
      const capacity = eng.capacity[c] || 0;
      const statusChip = req > capacity ? `<span class="chip exc">Over capacity by ${req - capacity}</span>` : `<span class="chip ok">OK</span>`;
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
    <div class="rcard">
      <div class="rcard-header">
        <h3>Pairings coverage</h3>
        <p class="rcard-desc">${summaryBits.join(' · ')}</p>
      </div>
      <div class="table-scroll">
        <table>
          <thead><tr><th>Coach</th><th class="num">Valid slots</th><th class="num">Capacity</th><th class="num">Paired students</th><th>Status</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="5" class="rcard-empty">No coaches found in the availability file.</td></tr>`}</tbody>
        </table>
      </div>
    </div>`;
}

function renderReview() {
  const container = document.getElementById('review-content');
  const parts = [renderTermRibbon()];

  if (!hasCoreUploads()) {
    const need =
      state.mode === 'pre-allocated'
        ? 'the class schedule, coach availability, student list, and pairings files'
        : 'the class schedule, coach availability, and student list files';
    parts.push(`<div class="rcard"><p class="rcard-empty">Upload ${need} to see capacity.</p></div>`);
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
    if (!state.uploads.pairings) {
      parts.push(`<div class="rcard"><p class="rcard-empty">Upload the pairings file to see coverage.</p></div>`);
    } else {
      parts.push(renderPairingsCoverage(eng));
    }
  } else {
    parts.push(renderFteAndCapacityTable(eng));
  }

  container.innerHTML = parts.join('');

  if (state.mode === 'auto') attachFteInputHandlers();
}

function renderUtilisationTable(eng) {
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
      <td class="mono5 num">${pct}%</td>
    </tr>`;
    })
    .join('');

  return `
    <div class="rcard">
      <div class="rcard-header"><h3>Coach utilisation</h3></div>
      <div class="table-scroll">
        <table>
          <thead><tr><th>Coach</th><th class="num">Capacity</th><th class="num">Scheduled</th><th class="num">Utilisation</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="4" class="rcard-empty">No coaches found in the availability file.</td></tr>`}</tbody>
        </table>
      </div>
    </div>`;
}

function renderUnassignedTable(eng) {
  if (eng.unassigned.length === 0) {
    return `<div class="rcard"><div class="rcard-header"><h3>Unassigned students</h3></div><p class="rcard-empty">All students were scheduled.</p></div>`;
  }

  const rows = eng.unassigned
    .map(
      ({ student, reason }) => `
    <tr>
      <td>${escapeHtml(student.studentName)} <span class="mono">${escapeHtml(student.contactSfId)}</span></td>
      <td><span class="chip exc">${escapeHtml(capitalize(reason))}</span></td>
    </tr>`
    )
    .join('');

  return `
    <div class="rcard">
      <div class="rcard-header">
        <h3>Unassigned students</h3>
        <p class="rcard-desc">${eng.unassigned.length} student${eng.unassigned.length === 1 ? '' : 's'} could not be scheduled.</p>
      </div>
      <div class="table-scroll">
        <table>
          <thead><tr><th>Student</th><th>Reason</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

function renderAppointmentsPreview(eng) {
  const preview = eng.appointments.slice(0, 50);

  if (preview.length === 0) {
    return `<div class="rcard"><div class="rcard-header"><h3>Appointments</h3></div><p class="rcard-empty">No appointments were scheduled.</p></div>`;
  }

  const rows = preview
    .map(
      (a) => `
    <tr>
      <td class="mono">${a.date}</td>
      <td class="mono">${a.startTime}</td>
      <td>${escapeHtml(a.studentName)}</td>
      <td>${escapeHtml(a.coachName)}</td>
      <td class="mono num">${a.weekNumber}</td>
      <td class="mono num">${a.meetingNumber}</td>
    </tr>`
    )
    .join('');

  const note =
    eng.appointments.length > 50
      ? `Showing the first 50 of ${eng.appointments.length} appointments.`
      : `${eng.appointments.length} appointment${eng.appointments.length === 1 ? '' : 's'}.`;

  return `
    <div class="rcard">
      <div class="rcard-header">
        <h3>Appointments</h3>
        <p class="rcard-desc">${note}</p>
      </div>
      <div class="table-scroll table-scroll-tall">
        <table>
          <thead><tr><th>Date</th><th>Time</th><th>Student</th><th>Coach</th><th class="num">Week</th><th class="num">Meeting</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

function renderResults() {
  const container = document.getElementById('results-content');

  if (!hasResultsInputs()) {
    container.innerHTML = `<div class="rcard"><p class="rcard-empty">Complete setup and upload to see results.</p></div>`;
    return;
  }

  const eng = computeEngineState();
  const scheduledCount = eng.assignments.length;
  const unassignedChip = eng.unassigned.length > 0 ? ` · <span class="chip exc">${eng.unassigned.length} unassigned</span>` : '';

  const parts = [
    `<p class="summaryline"><span class="mono5">${scheduledCount}</span> of <span class="mono5">${eng.studentCount}</span> students scheduled · <span class="mono5">${eng.appointments.length}</span> appointments${unassignedChip}</p>`,
    renderUtilisationTable(eng),
    renderUnassignedTable(eng),
    renderAppointmentsPreview(eng),
  ];

  container.innerHTML = parts.join('');
}

/**
 * Recomputes and re-renders Review and Results together, regardless of
 * which step is currently visible, so both stay in sync with uploads, mode,
 * FTE values, and start date (SPEC.md §5, §6).
 */
function refreshComputedSteps() {
  renderReview();
  renderResults();
}

function init() {
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

  startDateInput.addEventListener('change', handleStartDateChange);
  modeAutoInput.addEventListener('change', () => handleModeChange('auto'));
  modePreAllocatedInput.addEventListener('change', () => handleModeChange('pre-allocated'));

  backBtn.addEventListener('click', () => goToStep(state.stepIndex - 1));
  nextBtn.addEventListener('click', () => goToStep(state.stepIndex + 1));

  stepperItems.forEach((item) => {
    item.addEventListener('click', () => goToStep(STEPS.indexOf(item.dataset.step)));
    item.style.cursor = 'pointer';
  });

  UPLOAD_KEYS.forEach(setupUpload);
  document.getElementById('clear-uploads-btn').addEventListener('click', clearAllUploads);

  renderStep();
  refreshComputedSteps();
}

init();
