# Coaching Meeting Scheduler — Technical Specification

Version 1.4 — 12 August 2026 (adds §7.3/§13 the auto-assign coach-assignments batch upload — a **second** export alongside the §7.1 appointments file; §3.1/§4.4a/§5.3/§12 multiple class blocks from v1.3; §6.1 Campus and §7.1 export columns from v1.2; §11 Blocked weeks/dates from v1.1)

## 1. Purpose

A browser-based tool that allocates recurring 1-hour coaching meetings to students and coaches for a 15-week term. It reads Excel uploads (class timetables, coach availability, student list, optional student–coach pairings), computes a clash-free schedule under fixed cadence rules, and exports the result as Excel: one row per appointment, plus — in auto-assign mode — a second batch-upload file with one row per student/coach assignment (§7.3). No server. No data leaves the browser. Hosted on GitHub Pages.

A run may contain **several class blocks** — distinct student cohorts, each with its own class timetable. Coaching availability is coach-specific and spans the whole run; class clashes are per student, judged against their own class block only (§4.4a).

## 2. Architecture

- **Stack:** plain HTML + CSS + vanilla JavaScript (ES modules). No framework, no build step, no npm. This is deliberate: the repo deploys to GitHub Pages by pushing files, with nothing to compile.
- **Excel I/O:** SheetJS (`xlsx`) loaded from CDN (`https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js`). Used for both parsing uploads and generating the export.
- **Persistence:** `localStorage` only, for settings (start date, campus, mode, FTE values, custom export mapping). Uploaded data is held in memory for the session and never persisted.
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
│   ├── exporter.js     # Default + custom-mapped appointments export, and the §7.3 batch upload
│   ├── timezone.js     # Campus → IANA zone, offset-bearing ISO formatting
│   └── storage.js      # localStorage read/write helpers
├── templates/          # The 4 .xlsx templates, downloadable from the UI
├── tests.html          # Loads scheduler.js/exporter.js and runs assertions in-browser
├── SPEC.md             # This file
├── BUILD_GUIDE.md
└── README.md
```

## 3. Input files

All four templates live in `/templates` and are downloadable from the UI. Every column that feeds an export column (§7.1) is a hard requirement: a missing column rejects the file, and a blank or malformed cell is a row error. All times in every uploaded file are wall-clock times at the run's campus (§6.1). Parsers must accept times as either text (`HH:MM`, 24-hour) or native Excel time values, and must trim whitespace and ignore fully blank rows. Header row is row 1; the templates contain a legend and one example row — parsers must ignore any row whose first cell begins with `#` (legend/comment rows).

### 3.1 Class schedule (`class_schedule_template.xlsx`)

Every class timetable in the run, in one file. One row per class; the **Class Block** column says which cohort's timetable that class belongs to. A run may contain any number of class blocks.

Terminology: a **class block** is a cohort's class timetable. It is unrelated to the four **term blocks** of weeks in §4.2/§11.1, which keep that name.

| Column | Required | Notes |
|---|---|---|
| Class Block | Yes | The cohort this class belongs to, e.g. `Block A`. Matched case-insensitively after trimming, so `Block A`, `block a` and ` Block A ` are one cohort. Exactly one name per cell |
| Day | Yes | Monday–Sunday (case-insensitive; accept 3-letter abbreviations) |
| Start Time | Yes | e.g. `09:00` |
| End Time | Yes | Must be after Start Time |
| Class Name | No | Label only |

**The 15-hour rule (normative).** Each class block must total **exactly 15 hours** of class — the sum of every class row in that block across the whole timetable, *not* 15 hours per week. A block totalling anything else is a validation error naming the block and the total it actually came to (§8). Two classes of the same block may not overlap each other (they would count the same hour twice); the same clock hour in two *different* blocks is normal and expected.

A file whose rows carry no Class Block value is not accepted (the column is required). The engine itself still treats an unnamed set of class rows as one implicit block, which is what makes its own fixtures and any legacy caller behave exactly as the pre-v1.3 single timetable did.

### 3.2 Coach availability (`coach_availability_template.xlsx`)

One row per weekly availability block per coach.

| Column | Required | Notes |
|---|---|---|
| Coach Name | Yes | Exact string used as the coach key throughout |
| Coach SF ID | Yes | Exported; must be identical on every row for a coach |
| Coach Email | Yes | Exported; must be identical on every row for a coach |
| Day | Yes | As above |
| Start Time | Yes | |
| End Time | Yes | |

### 3.3 Student list (`students_template.xlsx`)

| Column | Required | Notes |
|---|---|---|
| Contact SF ID | Yes | Unique; duplicates are a validation error |
| Student Name | Yes | |
| Student Email | Yes | Must be a plausible address (`name@example.com`) |
| Class Block | Yes | Exactly one class block from §3.1, matched case-insensitively after trimming. Blank, or two names in one cell, is a row error; a name the class schedule does not define is a parse warning and an unassigned reason (§5.3) |

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
4. **Valid slot definition:** a 60-minute window that (a) lies entirely within one of the coach's availability blocks, (b) starts on a 30-minute boundary (`:00` or `:30`), and (c) can be used by at least one class block — i.e. it is not covered by a class in *every* class block of the run. A window every cohort is in class for is dead and is not built at all.
4a. **Class clashes are student-specific (normative).** A slot is not globally invalid because it overlaps a class. It is invalid **for a particular student** when it overlaps a class in that student's assigned class block; a class belonging to another block is irrelevant to them. Each slot therefore records which class blocks it clashes with, and the check is applied per student at assignment time — and again in the §11.3 blocking post-pass, so a rebooked meeting never lands on the student's own class.
5. **Slot capacity:** each (coach, slot) pair can host at most 3 students — one per offset. A coach's capacity is (valid slots per §4.4) × 3, so one cohort's classes never reduce a coach's capacity for the other cohorts.
6. **Determinism:** given identical inputs, output is identical. Slots are ordered by day (Mon→Sun) then start time; students are processed in file order; offsets fill 1→2→3 within a slot before moving to the next slot.

## 5. Assignment modes

A toggle selects one of two modes.

### 5.1 Auto-assign (availability + FTE)

- After the availability file is parsed, the UI shows an **FTE editor**: one row per coach, numeric input 0.05–1.00, default 1.00, persisted to localStorage keyed by coach name.
- Coach capacity = (number of valid slots) × 3.
- Target quota per coach = proportional to FTE across all coaches, scaled to total student count, computed by the largest-remainder method, then capped at capacity. If capping leaves a shortfall, redistribute the remainder to coaches with spare capacity (again by FTE proportion).
- Students are assigned in file order: fill coach quotas in coach file order, slot by slot, offset 1→2→3. Each student takes the first placement that is still free, still within its coach's quota, and usable by their class block (§4.4a). With one class block this is exactly "student *i* takes placement *i*", the pre-v1.3 behaviour.
- **Quota interpretation (normative).** A quota caps how many students a coach *takes*, not which slots are on offer: the whole of a coach's slot list stays available until their quota is used up. Truncating the list to its first *quota* placements would let one cohort's classes sitting on a coach's earliest slots starve that coach's entire quota, which is the global capacity loss §4.4a exists to prevent.
- If no quota room is left anywhere, the surplus students are reported as **unassigned** with the reason `insufficient capacity`. If room remains but every remaining placement is during the student's own classes, the reason is `no free slot outside their class block`.

### 5.2 Pre-allocated

- Requires the pairings file. Every student in the student list must appear in the pairings file (missing → unassigned, reason `no pairing`). Unknown coach names → unassigned, reason `coach not found`.
- Within each coach, that coach's students are assigned in pairings-file order to the coach's slots, offset 1→2→3 per slot, skipping any placement that clashes with the student's own class block (§4.4a). Overflow → unassigned, reason `coach over capacity`; places left that the student's classes rule out → `no free slot outside their class block`.

### 5.3 Class-block assignment (normative)

Every student must have exactly one valid class-block assignment, in both modes:

- A blank Class Block cell, or a cell naming more than one block, is a **row error** at parse time (§8): the row is dropped and the file is rejected, so it never reaches the engine.
- A student naming a block the class schedule does not define is a **parse warning**, and is reported as unassigned with the reason `class block not found`.
- A student reaching the engine with no class block at all is reported as unassigned with the reason `no class block`.

In no case is a student scheduled against an assumed or defaulted class block. These students are set aside before assignment, so they consume no place and no quota.

## 6. UI flow

A single page with a stepper:

1. **Setup** — start date picker (with Monday normalisation notice), campus selector (§6.1), mode toggle, template download links.
2. **Upload** — drag-and-drop or file pickers for the 3 (or 4) files, with per-file validation results shown immediately (row counts, errors with row numbers).
3. **Review** — a **Class blocks** card (§6.3); FTE editor (auto mode only); a capacity summary table (coach, valid slots, capacity, FTE, quota); warnings.
4. **Results** — summary (students scheduled / unassigned, per-coach utilisation), a **Class blocks** card (§6.4), an unassigned-students table with reasons (including each student's class block), a preview of the first 50 appointment rows with the **Export appointments** button, and — in auto-assign mode only — a **Coach assignments** card with the **Export coach assignments** button (§7.3). The run therefore produces **two** export files in auto-assign mode and one in pre-allocated mode.
5. **Export settings** (collapsible panel) — see §7.

All errors must be human-readable and name the file, row, and problem. The app must never fail silently.

### 6.1 Campus (one location per run)

A run covers exactly one location. The Setup step offers a campus selector — **London** (`Europe/London`), **Boston** (`America/New_York`), **Dubai** (`Asia/Dubai`) — defaulting to London and persisted to localStorage. Uploaded times are naive wall-clock times at that campus, so the scheduling engine keeps working in minutes-since-midnight exactly as before; the campus zone is applied only when building the export instants (§7.1).

This is what makes every class timetable safe to compare against every coach's availability: one campus per run means one zone, so naive minute arithmetic is never comparing times from two different zones. Class blocks are cohorts, not locations — they do not change the run's campus or zone.

### 6.3 Class blocks on Review

A card above the capacity table, one row per class block: block name, number of classes, **total hours** (an `--ok-tint` chip at exactly 15 hours, an `--err-tint` chip otherwise), number of students in the block, and how many of the run's coaching slots that block can use ("90 of 150"). The last column is the on-screen answer to "why is this hour not on offer to this student?". The card's summary line names how many students reference a block that is not in the class schedule.

### 6.4 Class blocks on Results

The same card in outcome form: block, hours, students, how many were scheduled, and slots available. Students whose class block is missing or unknown appear as a separate "Not in the class schedule" row and are never counted into a block. The unassigned/exceptions table carries a **Class block** column, so an unassigned student's reason and cohort are read together.

New UI reuses the existing components in DESIGN.md (cards, tables, chips). Class blocks are cohorts and take no term-block pastel: the `--b1`…`--b4` hues continue to mean term blocks only.

## 7. Export

A run produces up to **two** files: the appointments export (§7.1/§7.2, one row
per appointment, always available), and — in auto-assign mode only — the
coach-assignments batch upload (§7.3, one row per scheduled student). They are
separate files with separate buttons and separate filenames; neither replaces
the other.

### 7.1 Default columns (one row per appointment; 4 rows per scheduled student)

| Column | Source | Example |
|---|---|---|
| Student Name | student list | Jane Doe |
| Contact SF ID (Student) | student list | 0031t00000AbCdE |
| Student Email | student list | jane.doe@example.com |
| Service Name | derived | `Coaching 1 - Meeting N`, N = 1–4 |
| Coach Name | availability | A. Coach |
| Coach SF ID | availability | 005XX000001 |
| Coach Email | availability | a.coach@example.com |
| Meeting Start Date & Time | derived | 2026-09-16T12:00:00+01:00 |
| Meeting End Date & Time | derived | 2026-09-16T13:00:00+01:00 |
| Meeting Status | constant | `Scheduled` |

**Date/time format (normative).** ISO 8601 with an explicit UTC offset:
`YYYY-MM-DDTHH:MM:SS±HH:MM`. The offset is that of the run's campus (§6.1) **at
that appointment's instant**, obtained from `Intl`, never from a hard-coded
table. A 15-week term starting in September spans both the UK and US DST
transitions, so appointments in one student's series legitimately differ:
London `+01:00` → `+00:00`, Boston `-04:00` → `-05:00`, Dubai `+04:00`
throughout. The end is the start plus 60 minutes **in absolute time**, so a
meeting spanning a transition carries different start and end offsets.

Both columns are written as **text cells**, not Excel date serials: a serial
carries no zone, so storing one would discard the offset and let Excel
re-render the instant in the reader's local settings.

The v1.1 fields (Meeting Number, Week Number, Date, Day, Start Time, End Time,
Duration (mins)) remain available in the §7.2 mapping editor but are excluded
by default, as is **Class Block** (the student's cohort, added in v1.3). The
default column set is therefore unchanged by v1.3, and a saved v3 mapping keeps
working.

Rows sorted by Date, then Start Time, then Coach Name. Filename: `appointments_YYYY-MM-DD_HHMM.xlsx` (generation timestamp).

### 7.2 Customisable export mapping

An editor listing the default fields, allowing the user to: rename a column header, reorder columns, exclude columns, and add **constant columns** (fixed header + fixed value on every row — e.g. `Record Type = Coaching`). The mapping is saved to localStorage and applied on export. A "Reset to defaults" button restores §7.1. The mapping is stored under a versioned key (`coachScheduler.exportMapping.v2`); a mapping saved against an older default column set is ignored rather than partially restored, so a returning user gets the current defaults. This exists so the output can later be shaped to match a batch-upload template.

### 7.3 Coach-assignments batch upload (v1.4, normative)

A **second** export, in the Salesforce batch-upload template's shape. It
describes **coach assignments, not meetings**: one row per scheduled student.

**Availability.** Offered only when the current run uses **auto-assign** and a
valid schedule exists. In pre-allocated mode the control is not rendered at
all — the student→coach mapping there is the user's own pairings file, so a
"coach assignments" export would state back what was uploaded, and this
specification scopes the file to auto-assign. `exportCoachAssignments` refuses
a non-auto mode as well, so the rule holds however the function is reached.
When no student was assigned a coach, the control is present but disabled.

**Columns (exact headers, exact order).**

| # | Column | Value |
|---|---|---|
| 1 | `Student Name` | the scheduled student's name |
| 2 | `Record Type` | constant `0121Q000001Dw6tQAC` |
| 3 | `Record Type Name` | constant `Institutional Relations` |
| 4 | `Type` | constant `coach` |
| 5 | `Coach Name` | the coach the scheduler assigned |
| 6 | `Coach User ID` | that coach's existing **Coach SF ID** (§3.2) |
| 7 | `Status` | constant `current` |

This is a **fixed integration format**. It is deliberately outside the §7.2
mapping editor: the user's renamed, reordered, excluded or constant appointment
columns must not be able to reshape this file, and no §7.2 setting changes any
of the seven headers or four constants.

**Coach User ID = Coach SF ID (normative).** `Coach User ID` is an *export
header name only*. The underlying value is the existing `Coach SF ID` from the
coach availability file (§3.2), carried onto every slot by `buildSlots` and
read from the assignment's slot at export time. There is **no** new coach input
field, and no new column in the coach availability template. All existing
`Coach SF ID` parsing and validation (§8: required, non-blank, identical on
every row for a coach) is unchanged and is the only validation this column has.

**One row per student (normative).**

- A student with four coaching meetings produces **one** row, not four.
- The row names the coach the student was **ultimately assigned** in the final
  schedule — read from the scheduler's `assignments` structure, never inferred
  from appointment row order.
- A student who is **unassigned** (§5.1, §5.2, §5.3) is not in `assignments`
  and is therefore excluded from the file entirely.
- A student who has a §11.3 **scheduling exception** — one meeting that could
  not be rebooked around a blocked week — still appears, exactly once, with
  their assigned coach. The blocking post-pass never changes a student's coach
  (§11.3), so the assignment the row states remains true; only one of that
  student's four meetings is missing from the *appointments* export.
- No duplicate rows: a student appears at most once, keyed on their (unique,
  §3.3) Contact SF ID.

**Determinism.** Rows are emitted in the scheduler's own assignment order,
which in auto-assign mode is student-file order (§4.6). Identical inputs
produce an identical file.

**Validation and errors.** If any coach in the final schedule has a missing or
blank `Coach SF ID`, the export is **refused**: no file is written, no blank
`Coach User ID` is exported, and a human-readable error names the affected
coach or coaches and the fix ("Add the Coach SF ID to the coach availability
file and upload it again"). The Results card shows the same message in the
§3.5 error list and disables the button. This is a defence in depth: §8 already
rejects a blank `Coach SF ID` at parse time.

**Format.** A `.xlsx` workbook generated through the existing SheetJS setup
(§2), single sheet named `Coach Assignments`. Every cell is written as a
**text** cell with no number format, so an opaque Salesforce identifier — in
particular an all-digit one — is never reformatted, rounded, converted to
scientific notation, or stripped of leading zeros by Excel.

**Filename.** `coach_assignments_YYYY-MM-DD_HHMM.xlsx` (generation timestamp),
matching the §7.1 timestamp convention while being clearly distinct from
`appointments_…xlsx`.

**Test expectations** are §13.

## 8. Validation rules (parse stage)

- Missing required column → file rejected, message names the column.
- Blank value in any required column → row error naming the column.
- Malformed email → row error quoting the value.
- One coach with conflicting Coach SF ID / Coach Email across their rows → error naming both rows.
- Unparseable time / End ≤ Start → row error with row number.
- Unknown day name → row error.
- Duplicate Contact SF ID → error listing the duplicates.
- Pairings referencing unknown students or coaches → listed as warnings at parse, become unassigned reasons at scheduling.
- Empty file (headers only) → rejected.
- Missing Class Block value (class schedule or student list) → row error naming the column.
- A Class Block cell naming more than one block (a comma, semicolon, slash, pipe, `&`, `+` or "and") → row error quoting the value.
- A class block not totalling exactly 15 hours → error naming the block, its class count, its actual total, and how far off it is.
- Two classes of the same block overlapping → error naming the block, the day, both time ranges and both row numbers.
- A student naming a class block the class schedule does not define → warning listing the known blocks; becomes `class block not found` at scheduling (§5.3).

## 9. Engine contract (`scheduler.js`)

Pure functions, no DOM, so `tests.html` can exercise them:

- `buildClassBlocks(classRows)` → `[{id, name, minutes, hours, classes, rowNumbers}]` in first-appearance order (`id` = trimmed, case-folded name)
- `classBlockKey(name)` → the matching key for a class-block name
- `buildSlots(availability, classRowsOrBlocks)` → `[{coach, day, start, end, blockedFor}]`, where `blockedFor` lists the class-block ids the slot clashes with (§4.4a)
- `slotAllowsClassBlock(slot, classBlock)` / `slotsForClassBlock(slots, classBlock)` → the student-specific validity test
- `computeQuotas(coaches, fte, studentCount, slotCounts)` → `{coachName: quota}`
- `schedule(students, slots, mode, quotasOrPairings, knownCoaches, {classBlocks})` → `{assignments: [{student, coach, slot, offset}], unassigned: [{student, reason}]}`; omitting `classBlocks` skips the §5.3 checks
- `expandToAppointments(assignments, startMonday, timeZone)` → appointment rows per §7.1, each carrying the student's `classBlock`
- Invariant assertions in tests: no appointment in weeks 4/8/12; exactly 4 appointments per assigned student; no coach double-booked (same coach, same slot, same week); no appointment overlaps a class in the student's own class block.

`exporter.js` exposes the §7.3 batch upload as pure functions alongside the
download entry point, so `tests.html` can assert on the exact rows and cells:

- `buildCoachAssignmentRows(assignments)` → one object per scheduled student
- `buildCoachAssignmentAoa(assignments)` → `[headers, ...rows]`
- `findCoachesWithoutSfId(assignments)` / `coachSfIdErrorMessage(coaches)` → the §7.3 refusal
- `buildCoachAssignmentsWorkbook(assignments, mode)` → the SheetJS workbook, without writing it
- `exportCoachAssignments(assignments, mode)` → writes the file, returns the filename
- `COACH_ASSIGNMENT_HEADERS` / `COACH_ASSIGNMENT_CONSTANTS` / `buildCoachAssignmentsFilename(now)`

The parsers additionally expose `parseClassScheduleSheet(fileName, sheetRows)` and `parseStudentListSheet(fileName, sheetRows)` — the same validation applied to an already-read array-of-arrays, so `tests.html` can exercise the real rules without SheetJS or a workbook.

## 10. Out of scope (v1)

Per-student class timetables (a student belongs to a class block, not to a bespoke timetable); student-specific coaching availability; more than one campus per run (§6.1 fixes one location per run; cross-campus scheduling would require per-block zones and absolute-time clash detection); public holidays; editing individual appointments after generation; moving a displaced meeting to a different coach.

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

## 12. Class-block tests (v1.3)

tests.html must exercise the real engine and the real parser rules, and assert at least:

1. One class block totalling exactly 15 hours is accepted.
2. Several class blocks coexist in one run, each with its own 15 hours.
3. A block totalling less than 15 hours is rejected, with the block name and its actual total in the message.
4. A block totalling more than 15 hours is rejected the same way.
5. A student in block A can be scheduled in an hour that overlaps a block B class, provided it misses every block A class.
6. No student is ever scheduled during a class in their own block — at assignment and after the §11.3 blocking post-pass.
7. Coach availability constraints still hold (windows inside availability, on `:00`/`:30`, 60 minutes).
8. The cadence invariants still hold (4 meetings, one per term block, same coach/day/time, nothing in weeks 4/8/12).
9. The blocked-week/date invariants still hold.
10. Auto-assign still works, and a coach's capacity is not reduced by one cohort's classes.
11. Pre-allocated mode still works and honours the student's class block.
12. Determinism is preserved with class blocks in play.
13. Missing, ambiguous, and unknown class-block assignments produce the §5.3 errors, warnings and unassigned reasons.

## 13. Coach-assignments batch-upload tests (v1.4)

tests.html must exercise the real exporter functions and assert at least:

1. An auto-assign run produces the second export.
2. The output has exactly the seven §7.3 headers, in exactly that order, and every row has seven cells.
3. `Record Type` is `0121Q000001Dw6tQAC` on every row.
4. `Record Type Name` is `Institutional Relations` on every row.
5. `Type` is `coach` on every row.
6. `Status` is `current` on every row.
7. Each scheduled student appears exactly once.
8. A student with four coaching appointments appears once, not four times.
9. The exported coach is the student's actual final assigned coach, with more than one coach in play.
10. `Coach User ID` exactly equals the source `Coach SF ID`, both as uploaded and as carried on the slot.
11. No new coach input field is needed: an availability row carrying only the §3.2 columns populates `Coach User ID`.
12. Unassigned students are excluded.
13. A missing or blank `Coach SF ID` is detected, names the coach, and refuses the export.
14. Output is deterministic, and row order follows the scheduler's assignment order.
15. Pre-allocated mode does not produce the export (both entry points refuse).
16. The §7.1 appointments export is unchanged — default columns and filename.
17. A custom §7.2 appointment mapping does not change the seven-column batch upload.
18. The generated workbook carries the exact headers and values, and Salesforce identifiers survive a write/read round-trip as text (including an all-digit id keeping its leading zeros).

Workbook assertions need SheetJS; when the CDN is unreachable those tests report as **skipped** rather than failed, and the pure data-builder tests still run.
