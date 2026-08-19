// Term ribbon (DESIGN.md §3.1) — the one place the 15 term weeks are drawn.
// Display-only by default (Review, Results); pass `interactive: true` to get
// the toggleable grid the blocking panel (§3.6) uses.

export const EXCLUDED_WEEKS = [4, 8, 12];

// [1 2 3] [4] [5 6 7] [8] [9 10 11] [12] [13 14 15]
export const RIBBON_GROUPS = [
  { block: 1, label: 'Block 1', weeks: [1, 2, 3] },
  { block: null, label: '', weeks: [4] },
  { block: 2, label: 'Block 2', weeks: [5, 6, 7] },
  { block: null, label: '', weeks: [8] },
  { block: 3, label: 'Block 3', weeks: [9, 10, 11] },
  { block: null, label: '', weeks: [12] },
  { block: 4, label: 'Block 4', weeks: [13, 14, 15] },
];

/**
 * Builds the ribbon element.
 *
 * options.weekStates — { [week]: { blocked?: boolean, everyone?: boolean, exceptions?: boolean } }
 *   `everyone` marks a week this coach inherits from an "all coaches" block,
 *   which is unblocked from the "All coaches" selection rather than here.
 * options.interactive — render week cells as buttons and call
 *   options.onToggleWeek(week) on click (excluded weeks are never clickable).
 */
export function createTermRibbon(options = {}) {
  const { weekStates = {}, interactive = false, onToggleWeek = null, label = 'Term structure' } = options;

  const ribbon = document.createElement('div');
  ribbon.className = 'ribbon';
  ribbon.setAttribute('role', 'group');
  ribbon.setAttribute('aria-label', label);

  RIBBON_GROUPS.forEach((group) => {
    const groupEl = document.createElement('div');
    groupEl.className = 'ribbon-group' + (group.block ? ` ribbon-group-b${group.block}` : '');

    const labelEl = document.createElement('span');
    labelEl.className = 'ribbon-label';
    if (group.label) {
      labelEl.textContent = group.label;
    } else {
      labelEl.innerHTML = '&nbsp;'; // keeps excluded weeks aligned with the blocks
      labelEl.setAttribute('aria-hidden', 'true');
    }
    groupEl.appendChild(labelEl);

    const weeksEl = document.createElement('div');
    weeksEl.className = 'ribbon-weeks';
    group.weeks.forEach((week) => {
      weeksEl.appendChild(createWeekCell(week, weekStates[week] || {}, interactive, onToggleWeek));
    });
    groupEl.appendChild(weeksEl);

    ribbon.appendChild(groupEl);
  });

  return ribbon;
}

function createWeekCell(week, state, interactive, onToggleWeek) {
  const isExcluded = EXCLUDED_WEEKS.includes(week);
  const clickable = interactive && !isExcluded;

  const cell = document.createElement(clickable ? 'button' : 'div');
  cell.className = 'wk';
  cell.textContent = String(week);

  if (clickable) {
    cell.type = 'button';
    cell.setAttribute('aria-pressed', state.blocked ? 'true' : 'false');
    cell.setAttribute('aria-label', state.everyone ? `Week ${week}, blocked for all coaches` : `Week ${week}`);
    if (onToggleWeek) cell.addEventListener('click', () => onToggleWeek(week));
  }

  if (isExcluded) {
    cell.classList.add('wk-dead');
    cell.title = 'No meetings — excluded week';
  }
  if (state.blocked) cell.classList.add('wk-blocked');
  if (state.everyone) {
    cell.classList.add('wk-blocked-all');
    cell.title = 'Blocked for all coaches';
  }
  if (state.exceptions) cell.classList.add('wk-exceptions');

  return cell;
}

/** Replaces the contents of `mount` with a freshly built ribbon. */
export function renderTermRibbon(mount, options = {}) {
  if (!mount) return null;
  const ribbon = createTermRibbon(options);
  mount.replaceChildren(ribbon);
  return ribbon;
}
