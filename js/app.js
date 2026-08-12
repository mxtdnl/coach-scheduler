// UI wiring, state, step flow (SPEC.md §6).
// Review and results are placeholders until scheduler.js / exporter.js are
// wired up in a later session. Upload parsing/validation is implemented
// here against parse.js.

import { getStartDate, setStartDate, getMode, setMode } from './storage.js';
import {
  parseClassSchedule,
  parseCoachAvailability,
  parseStudentList,
  parsePairings,
  checkPairingsReferences,
} from './parse.js';

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
}

function handleModeChange(mode) {
  state.mode = mode;
  setMode(mode);
  pairingsUploadCard.hidden = mode !== 'pre-allocated';
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
}

function clearAllUploads() {
  UPLOAD_KEYS.forEach((key) => {
    state.uploads[key] = null;
    const { fileInput } = getUploadElements(key);
    fileInput.value = '';
    renderUploadResult(key);
  });
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
}

init();
