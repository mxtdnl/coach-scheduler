// UI wiring, state, step flow (SPEC.md §6).
// No scheduling logic here: uploads, review, and results are placeholders
// until later sessions wire up parse.js / scheduler.js / exporter.js.

import { getStartDate, setStartDate, getMode, setMode } from './storage.js';

const STEPS = ['setup', 'upload', 'review', 'results'];

const state = {
  stepIndex: 0,
  startDate: getStartDate() || null, // ISO yyyy-mm-dd, Monday-normalised
  mode: getMode() || 'auto',
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

  renderStep();
}

init();
