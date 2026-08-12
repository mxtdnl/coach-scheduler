# Coaching Meeting Scheduler — Technical Specification

Version 1.1 — 12 August 2026 (adds §11 Blocked weeks/dates)

## 1. Purpose

A browser-based tool that allocates recurring 1-hour coaching meetings to students and coaches for a 15-week term. It reads Excel uploads (class timetable, coach availability, student list, optional student–coach pairings), computes a clash-free schedule under fixed cadence rules, and exports one Excel row per appointment. No server. No data leaves the browser. Hosted on GitHub Pages.

## 2. Architecture

- **Stack:** plain HTML + CSS + vanilla JavaScript (ES modules). No framework, no build step, no npm. This is deliberate: the repo deploys to GitHub Pages by pushing files, with nothing to compile.
- **Excel I/O:** SheetJS (`xlsx`) loaded from CDN (`https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js`). Used for both parsing uploads and generating the export.
- **Persistence:** `localStorage` only, for settings (start date, mode, FTE values, custom export mapping). Uploaded data is held in memory for the session and never persisted.
- **Hosting:** GitHub Pages, deploy-from-branch (`main`, root). No Actions workflow required.

### Repo structure

```
/
├── index.html          # Single-page app: all UI
├── styles.css
├── js/
│   ├── app.js          # UI wiring, state, step flow
│   ├── parse.js        # Excel parsing + validation for the 4 file types
│   ├── scheduler.js    # Pure scheduling engine (no DOM access)
│   ├── exporter.js     # Default + custom-mapped Excel export
│   └── storage.js      # localStorage read/write helpers
├── templates/          # The 4 .xlsx templates, downloadable from the UI
├── tests.html          # Loads scheduler.js and runs assertions in-browser
├── SPEC.md             # This file
├── BUILD_GUIDE.md
└── README.md
```

## 3. Input files

All four templates live in `/templates` and are downloadable from the UI. Parsers must accept times as either text (`HH:MM`, 24-hour) or native Excel time values, and must trim whitespace and ignore fully blank rows. Header row is row 1; the templates contain a legend and one example row — parsers must ignore any row whose first cell begins with `#` (legend/comment rows).

### 3.1 Class schedule (`class_schedule_template.xlsx`)

One shared timetable for all students in a run. One row per weekly class block.

| Column | Required | Notes |
|---|---|---|
| Day | Yes | Monday–Sunday (case-insensitive; accept 3-letter abbreviations) |
| Start Time | Yes | e.g. `09:00` |
| End Time | Yes | Must be after Start Time |
| Class Name | No | Label only |

### 3.2 Coach availability (`coach_availability_template.xlsx`)

One row per weekly availability block per coach.

| Column | Required | Notes |
|---|---|---|
| Coach Name | Yes | Exact string used as the coach key throughout |
| Coach ID | No | Carried through to export if present |
| Day | Yes | As above |
| Start Time | Yes | |
| End Time | Yes | |

### 3.3 Student list (`students_template.xlsx`)

| Column | Required | Notes |
|---|---|---|
| Contact SF ID | Yes | Unique; duplicates are a validation error |
| Student Name | Yes | |

### 3.4 Pairings (`pairings_template.xlsx`) — only in pre-allocated mode

| Column | Required | Notes |
|---|---|---|
| Contact SF ID | Yes | Must exist in the student list |
| Coach Name | Yes | Must exist in the availability file |

## 4. Scheduling rules (normative)

1. **Term:** 15 weeks. Week 1 begins on the configured start date. The UI accepts any date but normalises to the Monday of that week, with a visible notice when it does.
2. **Cadence:** every student gets exactly 4 meetings. A student is assigned an **offset** of 1, 2, or 3:
   - Offset 1 → weeks 1, 5, 9, 13
   - Offset 2 → weeks 2, 6, 10, 14
   - Offset 3 → weeks 3, 7, 11, 15
   No meetings ever occur in weeks 4, 8, or 12 (guaranteed by construction; the engine must also assert this invariant in tests).
   The term therefore divides into four **blocks**: Block 1 = weeks 1–3, Block 2 = weeks 5–7, Block 3 = weeks 9–11, Block 4 = weeks 13–15. Every student has exactly one meeting per block; the offset determines which week within each block. Blocks are the redistribution boundary for §11.
3. **Slot:** a student keeps the **same coach, same weekday, same start time** for all 4 meetings. Duration is 60 minutes.
4. **Valid slot definition:** a 60-minute window that (a) lies entirely within one of the coach's availability blocks, (b) does not overlap any class block, and (c) starts on a 30-minute boundary (`:00` or `:30`).
5. **Slot capacity:** each (coach, slot) pair can host at most 3 students — one per offset.
6. **Determinism:** given identical inputs, output is identical. Slots are ordered by day (Mon→Sun) then start time; students are processed in file order; offsets fill 1→2→3 within a slot before moving to the next slot.

## 5. Assignment modes

A toggle selects one of two modes.

### 5.1 Auto-assign (availability + FTE)

- After the availability file is parsed, the UI shows an **FTE editor**: one row per coach, numeric input 0.05–1.00, default 1.00, persisted to localStorage keyed by coach name.
- Coach capacity = (number of valid slots) × 3.
- Target quota per coach = proportional to FTE across all coaches, scaled to total student count, computed by the largest-remainder method, then capped at capacity. If capping leaves a shortfall, redistribute the remainder to coaches with spare capacity (again by FTE proportion).
- Students are assigned in file order: fill coach quotas in coach file order, slot by slot, offset 1→2→3.
- If total capacity < student count, the surplus students are reported as **unassigned** with the reason `insufficient capacity`.

### 5.2 Pre-allocated

- Requires the pairings file. Every student in the student list must appear in the pairings file (missing → unassigned, reason `no pairing`). Unknown coach names → unassigned, reason `coach not found`.
- Within each coach, that coach's students are assigned in pairings-file order to the coach's slots, offset 1→2→3 per slot. Overflow → unassigned, reason `coach over capacity`.

## 6. UI flow

A single page with a stepper:

1. **Setup** — start date picker (with Monday normalisation notice), mode toggle, template download links.
2. **Upload** — drag-and-drop or file pickers for the 3 (or 4) files, with per-file validation results shown immediately (row counts, errors with row numbers).
3. **Review** — FTE editor (auto mode only); a capacity summary table (coach, valid slots, capacity, FTE, quota); warnings.
4. **Results** — summary (students scheduled / unassigned, per-coach utilisation), an unassigned-students table with reasons, a preview of the first 50 appointment rows, and the **Export** button.
5. **Export settings** (collapsible panel) — see §7.

All errors must be human-readable and name the file, row, and problem. The app must never fail silently.

## 7. Export

### 7.1 Default columns (one row per appointment; 4 rows per scheduled student)

| Column | Example |
|---|---|
| Contact SF ID | 0031t00000AbCdE |
| Student Name | Jane Doe |
| Coach Name | A. Coach |
| Coach ID | (blank if not supplied) |
| Meeting Number | 1–4 |
| Week Number | 1–15 |
| Date | 2026-09-07 (ISO, also stored as a real Excel date) |
| Day | Monday |
| Start Time | 10:00 |
| End Time | 11:00 |
| Duration (mins) | 60 |

Rows sorted by Date, then Start Time, then Coach Name. Filename: `appointments_YYYY-MM-DD_HHMM.xlsx` (generation timestamp).

### 7.2 Customisable export mapping

An editor listing the default fields, allowing the user to: rename a column header, reorder columns, exclude columns, and add **constant columns** (fixed header + fixed value on every row — e.g. `Record Type = Coaching`). The mapping is saved to localStorage and applied on export. A "Reset to defaults" button restores §7.1. This exists so the output can later be shaped to match a batch-upload template.

## 8. Validation rules (parse stage)

- Missing required column → file rejected, message names the column.
- Unparseable time / End ≤ Start → row error with row number.
- Unknown day name → row error.
- Duplicate Contact SF ID → error listing the duplicates.
- Pairings referencing unknown students or coaches → listed as warnings at parse, become unassigned reasons at scheduling.
- Empty file (headers only) → rejected.

## 9. Engine contract (`scheduler.js`)

Pure functions, no DOM, so `tests.html` can exercise them:

- `buildSlots(availability, classBlocks)` → `[{coach, day, start, end}]`
- `computeQuotas(coaches, fte, studentCount, slotCounts)` → `{coachName: quota}`
- `schedule(students, slots, mode, quotasOrPairings)` → `{assignments: [{student, coach, slot, offset}], unassigned: [{student, reason}]}`
- `expandToAppointments(assignments, startMonday)` → appointment rows per §7.1
- Invariant assertions in tests: no appointment in weeks 4/8/12; exactly 4 appointments per assigned student; no coach double-booked (same coach, same slot, same week); no appointment overlaps a class block.

## 10. Out of scope (v1)

Multiple cohorts/timetables per run (planned later); student-specific availability; timezone handling (all times are local and naive); public holidays; editing individual appointments after generation; moving a displaced meeting to a different coach.

## 11. Blocked weeks/dates (v1.1 — implemented in Session 7; Session 6's audit excludes this section)

Handles coach unavailability (e.g. annual leave) for whole weeks or specific dates, with automatic redistribution.

### 11.1 Block structure of the term

The term divides into four **blocks**: Block 1 = weeks 1–3, Block 2 = weeks 5–7, Block 3 = weeks 9–11, Block 4 = weeks 13–15 (weeks 4/8/12 sit between blocks and remain unusable). By construction of §4.2, every student has exactly one meeting per block.

### 11.2 UI

A "Blocked weeks/dates" button (Review step) opens a panel: select a coach, then add either a **week number** (1–15) or a **specific date** (date picker; must fall within the term; internally resolved to coach + week + weekday). Current blocks are listed with remove buttons and a "clear all blocks" control. Blocks persist to localStorage alongside the other settings. Selecting week 4, 8, or 12 shows a notice that it is a no-op (no meetings occur then anyway).

### 11.3 Redistribution rule (normative)

Blocking is a deterministic **post-pass** over the §4/§5 schedule. An appointment is *displaced* if it falls on a blocked (coach, week) — or, for a date block, on that coach's blocked weekday in that week. Each displaced appointment is rebooked, in schedule order, to the first available option:

1. The **same day and start time** with the same coach in another week of the **same block** where that (slot, week) is unoccupied — earlier weeks first.
2. Any **free (slot, week)** of the same coach within the same block, ordered by week, then by the coach's slot order (§4.6).
3. Otherwise the single meeting is reported as an **exception** with reason `no free slot in block N — coach blocked`. The student's other three meetings are unaffected.

Displaced meetings never change coach. After the post-pass, all §9 invariants must still hold (no double-booking, no class-block overlap, no meetings in weeks 4/8/12, nothing on a blocked coach-week/date).

### 11.4 Export and reporting

One column is appended to the §7.1 defaults: **Rescheduled From Week** (blank unless the row was moved by this post-pass). Exceptions from §11.3(3) appear in the Results step in the unassigned/exceptions table, per meeting, with the reason string above.

### 11.5 Tests

tests.html must additionally assert: no appointment lands on a blocked coach-week or coach-date; every moved appointment remains within its original block and coach; invariants hold after redistribution; a coach blocked for all three weeks of a block yields exactly one exception per affected student for that block.
