# Coaching Meeting Scheduler — Technical Specification

Version 1.10 — 18 August 2026 (§7.3/§13 add a second column to the coach-assignments batch upload: **Student Contact SF ID**, in position 2 immediately after `Student Name`, carrying the student's existing `Contact SF ID` (§3.3) — an eight-column file now, with no new input field, no new template column and no new validation; v1.9's §17 adds a manual **Edit** step between Review and Results: a coach-at-a-time grid and an unassigned tray from which a student's whole placement can be moved, placed or swapped, with hard refusals, soft warnings, an edits list and per-edit undo; §6 inserts Edit into the step list; §14 the Bookings card **moves from Results to Edit** and is no longer read-only; §7.4 the coach calendar becomes a dedicated **Coach calendars** card on Results — one row per coach, plus an "Export all coaches" control — instead of a control nested in the Bookings card; §10 is narrowed to editing a single dated occurrence; §5.1's quota and §4.7's day balance are stated as binding the automatic pass, with a manual breach warning rather than refusing; v1.8 made §4.7 a coach's meetings **spread as evenly as possible across the days that coach has valid slots on**, instead of piling onto their earliest days; §4.6, §5.1 and §5.2 restate the assignment order accordingly and §11.3 states explicitly that it does not re-balance days; v1.7 made §3.1 the class-block total **13.5 hours** with anything else a **warning** rather than a rejection — the file uploads and schedules; v1.6 made §7.4 the coach calendar export a **single `.ics` file per coach**, holding one `VEVENT` per meeting, replacing the v1.5 ZIP of one file per meeting; v1.5 added §14/§15 the Results booking views — by coach and by student — and the coach calendar export itself; §7.3/§13 the auto-assign coach-assignments batch upload from v1.4; §3.1/§4.4a/§5.3 multiple class blocks from v1.3; §6.1 Campus and §7.1 export columns from v1.2; §11 Blocked weeks/dates from v1.1)

## 1. Purpose

A browser-based tool that allocates recurring 1-hour coaching meetings to students and coaches for a 15-week term. It reads Excel uploads (class timetables, coach availability, student list, optional student–coach pairings), computes a clash-free schedule under fixed cadence rules, and exports the result as Excel: one row per appointment, plus — in auto-assign mode — a second batch-upload file with one row per student/coach assignment (§7.3). The finished schedule can then be inspected from either side on the Edit step (§14: a coach's students, or a student's week), adjusted by hand there (§17: move, place or swap a student's whole placement), and each coach's whole term downloaded as one calendar file from Results (§7.4). No server. No data leaves the browser. Hosted on GitHub Pages.

A run may contain **several class blocks** — distinct student cohorts, each with its own class timetable. Coaching availability is coach-specific and spans the whole run; class clashes are per student, judged against their own class block only (§4.4a).

## 2. Architecture

- **Stack:** plain HTML + CSS + vanilla JavaScript (ES modules). No framework, no build step, no npm. This is deliberate: the repo deploys to GitHub Pages by pushing files, with nothing to compile.
- **Excel I/O:** SheetJS (`xlsx`) loaded from CDN (`https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js`). Used for both parsing uploads and generating the export.
- **Persistence:** `localStorage` only, for settings (start date, campus, mode, FTE values, custom export mapping). Uploaded data is held in memory for the session and never persisted — and so are the §17 manual edits, which describe uploaded students and are therefore covered by the same rule.
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
│   ├── exporter.js     # Default + custom-mapped appointments export, the §7.3 batch upload, and the §7.4 coach calendar
│   ├── bookings.js     # Pure view models for the §14 booking views
│   ├── edits.js        # Pure §17 manual-edit overlay: validation and replay, no DOM
│   ├── ics.js          # iCalendar (RFC 5545) serialiser: one calendar, one VEVENT per meeting
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

**The 13.5-hour rule (normative).** Each class block is expected to total **13.5 hours** of class — the sum of every class row in that block across the whole timetable, *not* 13.5 hours per week. A block totalling anything else is a **warning**, not an error: it names the block and the total it actually came to (§8), the file is still accepted, and the run schedules from it unchanged. Only the user can say whether an unusual total is a mistake in the timetable or the timetable itself, so the tool flags it and defers. Two classes of the same block may not overlap each other (they would count the same hour twice, making the total meaningless) — that stays a hard error.

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
6. **Determinism:** given identical inputs, output is identical. `buildSlots` returns slots ordered by day (Mon→Sun) then start time; students are processed in file order; **within a day** a coach's slots are taken in start-time order and each slot's offsets fill 1→2→3 before the next slot. Which of a coach's *days* a student's place comes from is decided by §4.7, whose tie-break is total, so the whole assignment order remains a function of the inputs alone.
7. **Day-balanced allocation (normative).** A coach's meetings are spread as evenly as the hard constraints allow across the distinct days on which that coach has at least one valid slot (§4.4), rather than filling their earliest days first.
   - **Scope.** Balance is measured **per coach**, over that coach's own days. It says nothing about how students are shared *between* coaches: that stays the §5.1 quota (auto-assign) or the §5.2 pairings file (pre-allocated).
   - **Per-day target.** The coach's quota (§5.1) — or, in pre-allocated mode, the number of students paired to them (§5.2) — is distributed across those days by the **largest-remainder** method with equal weight per day, **capped by each day's capacity** (slots that day × 3, §4.5). A remainder left over by capping is redistributed to the days that still have spare capacity, repeating until every place is targeted or all capacity is used. Ties on the fractional remainder go to the earlier day (Mon→Sun).
   - **Within a day nothing changes.** The day's slots are taken in start-time order and offsets fill 1→2→3 within a slot before the next slot — §4.6's order, untouched.
   - **Worked example.** A coach with 2 valid slots on each of Monday, Tuesday, Wednesday and Thursday has a capacity of 6 meetings per day (§4.5: 3 students per slot, one per offset). Given a quota of 10, the engine schedules **3/3/2/2** across the four days — **not** 6/4/0/0, which is what consuming the slot list in flat §4.6 order produced before v1.8.
   - **Balancing never overrides a hard constraint.** It reorders which place is *offered*, and nothing more: §4.4a class-block clashes, §4.5 slot capacity, §5.1 quotas and §5.2 pairings order all still bind. A student who cannot take a place on their target day (their own class covers what is left there, or the day is full) **falls to the day with the largest current deficit** — target minus meetings already placed there. If no day of that coach can take them, the §5.1/§5.2 unassigned reasons apply **unchanged**.
   - **Tie-break (determinism, §4.6).** For each student, that coach's days are ranked by **largest deficit → fewest meetings placed so far → earliest day (Mon→Sun)**; within the chosen day, **earliest start time → offset 1→2→3**. Days whose target is already met stay in the ranking, last: that is how a day which cannot take its share gives its places back to the rest of the week.
   - **Both modes.** The rule applies to §5.1 auto-assign and §5.2 pre-allocated alike.
   - **A single-day coach is unaffected.** With one day there is nothing to balance, and the order is exactly §4.6's.
   - **§11.3 keeps its own rule.** The blocked-week/date post-pass redistributes within the **same coach and the same term block**, in the order §11.3 states, and does **not** re-balance days. A coach's day balance may therefore shift once weeks or dates are blocked, and that is correct: §11.3's job is to keep a displaced meeting with its coach inside its block, not to re-run §4.7.

   **Test expectations** are §16.

## 5. Assignment modes

A toggle selects one of two modes.

### 5.1 Auto-assign (availability + FTE)

- After the availability file is parsed, the UI shows an **FTE editor**: one row per coach, numeric input 0.05–1.00, default 1.00, persisted to localStorage keyed by coach name.
- Coach capacity = (number of valid slots) × 3.
- Target quota per coach = proportional to FTE across all coaches, scaled to total student count, computed by the largest-remainder method, then capped at capacity. If capping leaves a shortfall, redistribute the remainder to coaches with spare capacity (again by FTE proportion).
- Students are assigned in file order: coach quotas are filled in coach file order, and within a coach the place offered is the one **§4.7 day-balancing** chooses — the day with the largest deficit, then that day's earliest free slot, offset 1→2→3. Each student takes the first such placement that is still free, still within its coach's quota, and usable by their class block (§4.4a).
  - *Superseded note (v1.8).* Before §4.7, a coach's places were offered in flat §4.6 order, so with one class block the pass was exactly "student *i* takes placement *i*" — the pre-v1.3 behaviour. §4.7 replaces that order deliberately, so the equivalence no longer holds for a coach who works on more than one day; it still holds for a **single-day** coach. What is unchanged is that students are *considered* in file order and that `assignments` is emitted in that order, which is what §7.3's determinism clause relies on.
- **Quota binds the automatic pass (normative, v1.9).** Everything in §5.1 governs the automatic assignment pass. A §17 manual edit is applied *after* it and may push a coach past their quota; that is a **warning** (§17.6), not a refusal, because the person editing can see the whole picture and the quota is a planning target rather than a safety property. The §4.5 per-slot capacity is not a target and stays a hard refusal, which is what keeps the §9 invariants true over an edited schedule.
- **Quota interpretation (normative).** A quota caps how many students a coach *takes*, not which slots are on offer: the whole of a coach's slot list stays available until their quota is used up. Truncating the list to its first *quota* placements would let one cohort's classes sitting on a coach's earliest slots starve that coach's entire quota, which is the global capacity loss §4.4a exists to prevent.
- If no quota room is left anywhere, the surplus students are reported as **unassigned** with the reason `insufficient capacity`. If room remains but every remaining placement is during the student's own classes, the reason is `no free slot outside their class block`.

### 5.2 Pre-allocated

- Requires the pairings file. Every student in the student list must appear in the pairings file (missing → unassigned, reason `no pairing`). Unknown coach names → unassigned, reason `coach not found`.
- Within each coach, that coach's students are assigned in pairings-file order to the coach's slots: the day is the one §4.7 day-balancing chooses (balanced over the number of students paired to that coach), then that day's slots in start-time order, offset 1→2→3 per slot, skipping any placement that clashes with the student's own class block (§4.4a). Overflow → unassigned, reason `coach over capacity`; places left that the student's classes rule out → `no free slot outside their class block`.

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
4. **Edit** — the manual-editing step (§17): a coach-at-a-time **Coach grid** of (coach, slot) cells, an **Unassigned students** tray, an **Edits (N)** list with per-edit undo, and the **Bookings** card for inspecting the schedule by coach or by student (§14). The step **appears once a schedule has been generated** and requires no edits: a **Continue to Results** action always proceeds.
5. **Results** — summary (students scheduled / unassigned, per-coach utilisation), a **Class blocks** card (§6.4), an unassigned-students table with reasons (including each student's class block), a preview of the first 50 appointment rows with the **Export appointments** button, a **Coach calendars** card with one row and one `.ics` download per coach plus an **Export all coaches** control (§7.4), and — in auto-assign mode only — a **Coach assignments** card with the **Export coach assignments** button (§7.3). Results carries no bookings view: that moved to Edit in v1.9. The run therefore produces **two** spreadsheet export files in auto-assign mode and one in pre-allocated mode, plus the per-coach calendar files on demand.
6. **Export settings** (collapsible panel) — see §7.

All errors must be human-readable and name the file, row, and problem. The app must never fail silently.

### 6.1 Campus (one location per run)

A run covers exactly one location. The Setup step offers a campus selector — **London** (`Europe/London`), **Boston** (`America/New_York`), **Dubai** (`Asia/Dubai`) — defaulting to London and persisted to localStorage. Uploaded times are naive wall-clock times at that campus, so the scheduling engine keeps working in minutes-since-midnight exactly as before; the campus zone is applied only when building the export instants (§7.1).

This is what makes every class timetable safe to compare against every coach's availability: one campus per run means one zone, so naive minute arithmetic is never comparing times from two different zones. Class blocks are cohorts, not locations — they do not change the run's campus or zone.

### 6.3 Class blocks on Review

A card above the capacity table, one row per class block: block name, number of classes, **total hours** (an `--ok-tint` chip at exactly 13.5 hours, a `--warn-tint` chip otherwise — the run is not blocked by it), number of students in the block, and how many of the run's coaching slots that block can use ("90 of 150"). The last column is the on-screen answer to "why is this hour not on offer to this student?". The card's summary line names how many students reference a block that is not in the class schedule.

### 6.4 Class blocks on Results

The same card in outcome form: block, hours, students, how many were scheduled, and slots available. Students whose class block is missing or unknown appear as a separate "Not in the class schedule" row and are never counted into a block. The unassigned/exceptions table carries a **Class block** column, so an unassigned student's reason and cohort are read together.

New UI reuses the existing components in DESIGN.md (cards, tables, chips). Class blocks are cohorts and take no term-block pastel: the `--b1`…`--b4` hues continue to mean term blocks only.

## 7. Export

**Every export reads the edited schedule (v1.9, normative).** All three exports
below are built from the final appointment rows and the final `assignments`,
which since v1.9 means *after* the §17 manual edits as well as after the §11.3
post-pass. No export column set changes because of an edit, and **no export
flags an edited row**: a manual edit is visible on screen (§17.7) and nowhere in
a file. A student whose placement was moved carries the coach, dates and times
of the placement they ended up with, and their **Rescheduled From Week**
(§11.4) is blank, because their meetings are no longer the post-pass's output
(§17.5).

A run produces up to **two** spreadsheets: the appointments export (§7.1/§7.2,
one row per appointment, always available), and — in auto-assign mode only —
the coach-assignments batch upload (§7.3, one row per scheduled student). They
are separate files with separate buttons and separate filenames; neither
replaces the other. A third, on-demand download exists for one coach at a time:
the coach calendar (§7.4), a single `.ics` file holding every one of that
coach's meetings.

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
| 2 | `Student Contact SF ID` | that student's existing **Contact SF ID** (§3.3) |
| 3 | `Record Type` | constant `0121Q000001Dw6tQAC` |
| 4 | `Record Type Name` | constant `Institutional Relations` |
| 5 | `Type` | constant `coach` |
| 6 | `Coach Name` | the coach the scheduler assigned |
| 7 | `Coach User ID` | that coach's existing **Coach SF ID** (§3.2) |
| 8 | `Status` | constant `current` |

This is a **fixed integration format**. It is deliberately outside the §7.2
mapping editor: the user's renamed, reordered, excluded or constant appointment
columns must not be able to reshape this file, and no §7.2 setting changes any
of the eight headers or four constants.

**Coach User ID = Coach SF ID (normative).** `Coach User ID` is an *export
header name only*. The underlying value is the existing `Coach SF ID` from the
coach availability file (§3.2), carried onto every slot by `buildSlots` and
read from the assignment's slot at export time. There is **no** new coach input
field, and no new column in the coach availability template. All existing
`Coach SF ID` parsing and validation (§8: required, non-blank, identical on
every row for a coach) is unchanged and is the only validation this column has.

**Student Contact SF ID = Contact SF ID (normative, v1.10).** The same rule on
the student side. The value is the existing `Contact SF ID` from the student
list (§3.3), carried on the student object the scheduler assigned and read from
the assignment at export time. There is **no** new student input field and no
new column in the student list template. All existing `Contact SF ID` parsing
and validation (§8: required, non-blank, unique across the file) is unchanged
and is the only validation this column has — the parser having already refused
a blank or duplicated id, the export needs no refusal path of its own for it,
unlike `Coach User ID` above.

**One row per student (normative).**

- A student with four coaching meetings produces **one** row, not four.
- The row names the coach the student was **ultimately assigned** in the final
  schedule — read from the scheduler's `assignments` structure, never inferred
  from appointment row order. Since v1.9 that structure is the **edited**
  `assignments` (§17.5): a student moved to another coach by hand exports their
  new coach, and a student placed from the unassigned tray gains a row.
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
which in auto-assign mode is student-file order (§4.6). A student placed from
the §17 unassigned tray was not in that order at all, so they are appended
after it, in the order the edits were made. Identical inputs — including an
identical edit list — produce an identical file.

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

### 7.4 Coach calendar export (v1.6, normative; card reshaped in v1.9)

An on-demand, per-coach download offered by the **Coach calendars** card on
Results: **one `.ics` file holding every scheduled coaching meeting** for one
coach. It is a third export, alongside §7.1 and §7.3, and changes neither of
them.

**One file, not one per meeting (v1.6).** The coach is the person who has to
act on this download, and the act must be a single one: open — or import — the
file once, and the whole term appears in Outlook. A ZIP of per-meeting files
(v1.5) made that a manual, sixty-times-repeated job, so it is replaced. The
file is a single `VCALENDAR` with one `VEVENT` per meeting; a calendar
containing only one of a coach's meetings is **not** acceptable output, and
neither is a file that omits one.

**Availability (v1.9, normative).** The download is offered by a dedicated
**Coach calendars** card on Results, not by a control nested inside another
card. The card lists **one row per coach in coach-file order** — every coach in
the run, including one with no meetings — and each row carries:

- the coach's name;
- that coach's **exportable meeting count** (the meetings that can become
  events, i.e. what `exportableCoachMeetings` returns);
- its own **download button**, whose accessible name states that it downloads
  one calendar file holding every meeting for that coach, and which is
  **disabled when that coach has no exportable meeting**. A disabled row states
  which case applies in the §14.4 empty-state wording: the coach has no
  meetings, or their meetings carry no usable date and time.

Above the rows sits an **Export all coaches** control. It downloads one `.ics`
per coach **in sequence**, skipping every coach with no exportable meeting, and
before it starts it states **how many files it will produce** and warns that
the browser may ask permission before allowing multiple downloads. It is
disabled when no coach has an exportable meeting. It is not an archive: each
coach still receives exactly the file their own row's button produces, byte for
byte, so nothing about the per-coach file depends on which control was used
(the v1.5 `zip.js` stays gone, §7.4 "Format").

Every other rule in §7.4 is unchanged: one `VCALENDAR` per coach, one `VEVENT`
per meeting, deterministic UIDs, UTC instants, and the filename convention
below.

**Source of truth (normative).** The file is built from the **final**
appointment rows — after §5 assignment, after the §11.3 blocking post-pass, and
after the §17 manual edits — and from nothing else. A manually moved meeting
therefore appears in its new coach's calendar and in no other.

- Exactly one `VEVENT` per scheduled meeting: a coach with *n* meetings gets
  one file containing *n* events.
- Only the selected coach's meetings. No other coach's meeting is ever in the
  file.
- An unassigned student (§5.1, §5.2, §5.3) has no meetings, so contributes
  nothing. A §11.3 exception has been removed from the schedule and is
  therefore absent; a displaced meeting appears once, at the week it was
  rebooked to.
- Events are written in chronological order, so the file reads as the coach's
  term.
- Dates and times are never recalculated. The `.ics` instants are derived from
  the appointment's own `Meeting Start/End Date & Time` values (§7.1).
- The export is read-only: it does not modify the appointment rows, the
  assignments, or any stored setting.
- A coach with no exportable meeting produces no file at all: an empty calendar
  imports as nothing and is refused with a message, not downloaded.

**Calendar fields.** The file is one `VCALENDAR` (`VERSION:2.0`, `PRODID`,
`CALSCALE:GREGORIAN`, `METHOD:PUBLISH`) carrying `X-WR-CALNAME` — the coach's
name — so the import is recognisable rather than an untitled block of events,
and `X-WR-TIMEZONE`, the run's campus zone (§6.1). Each meeting is one `VEVENT`
with:

| Property | Value |
|---|---|
| `UID` | deterministic and unique per meeting: student id, meeting number, start instant, coach, plus an `@term-scheduler` domain |
| `DTSTAMP` | the generation time, in UTC; one stamp shared by every event in the file |
| `DTSTART` / `DTEND` | the appointment's start/end instants, as UTC date-times (`YYYYMMDDTHHMMSSZ`) |
| `SUMMARY` | `<student name> — <Service Name>`, e.g. `Jane Doe — Coaching 1 - Meeting 2` |
| `DESCRIPTION` | student email, Contact SF ID, class block, coach, term week, "Moved from week N" where §11.4 applies, and the campus zone |
| `LOCATION` | the run's campus label (§6.1) |
| `STATUS` / `TRANSP` | `CONFIRMED` / `OPAQUE` |

Deterministic UIDs are what make a second export safe: re-importing the same
schedule updates the same entries rather than duplicating a coach's term.

**Time-zone semantics (normative).** Date-times are written in **UTC form**,
converted from the offset-bearing instants the appointments export already
carries, and the run's campus zone (§6.1) travels with the file as
`X-WR-TIMEZONE`. UTC form is the one RFC 5545 representation that is
unambiguous without an accompanying `VTIMEZONE` component, and deriving it from
the §7.1 instant is what guarantees the calendar and the spreadsheet describe
the same moment — including on either side of a daylight saving change, where a
student's four meetings legitimately differ.

**iCalendar correctness (normative).** Content lines are CRLF-terminated and
folded at 75 **octets** with a leading space, never splitting a multi-byte
character. `TEXT` values escape backslash, semicolon and comma, and turn a
newline into a literal `\n`, so a student called `Smith, Jr.`, a coach called
`O'Hara; Jr` or a campus written `London; Bloomsbury` cannot split a property.
No `ORGANIZER` or `ATTENDEE` is written: the file is a published calendar to be
imported, not a meeting invitation to be responded to.

**Filename (normative).** `<coach-name>_calendar_YYYY-MM-DD_HHMM.ics`, the
coach's name slugified (lower case, non-alphanumerics collapsed to `-`) and the
timestamp matching the §7.1/§7.3 convention. Slugifying is also what keeps a
coach's name from producing a name a file system would refuse: no path
separators, no `..`, no control characters, and a name that reduces to nothing
falls back to `coach`.

**Format.** UTF-8 text, downloaded as `text/calendar`, written by the app's own
`ics.js` — pure, DOM-free, and using no browser API beyond `Blob`,
`URL.createObjectURL` and `TextEncoder`. SPEC.md §2 keeps the project to plain
modules with one external dependency, and a single text file needs no archive
writer at all (the v1.5 `zip.js` is therefore gone).

**Test expectations** are §15.

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
- A class block not totalling exactly 13.5 hours → **warning** naming the block, its class count, its actual total, and how far off it is. The file is accepted and the rows are scheduled from.
- Two classes of the same block overlapping → error naming the block, the day, both time ranges and both row numbers.
- A student naming a class block the class schedule does not define → warning listing the known blocks; becomes `class block not found` at scheduling (§5.3).

## 9. Engine contract (`scheduler.js`)

Pure functions, no DOM, so `tests.html` can exercise them:

- `buildClassBlocks(classRows)` → `[{id, name, minutes, hours, classes, rowNumbers}]` in first-appearance order (`id` = trimmed, case-folded name); `CLASS_BLOCK_TOTAL_HOURS` (13.5) / `CLASS_BLOCK_TOTAL_MINUTES` (810) are the expected block total
- `classBlockKey(name)` → the matching key for a class-block name
- `buildSlots(availability, classRowsOrBlocks)` → `[{coach, day, start, end, blockedFor}]`, where `blockedFor` lists the class-block ids the slot clashes with (§4.4a)
- `slotAllowsClassBlock(slot, classBlock)` / `slotsForClassBlock(slots, classBlock)` → the student-specific validity test
- `computeQuotas(coaches, fte, studentCount, slotCounts)` → `{coachName: quota}`
- `balancedDayTargets(coachSlots, total)` → `{day: target}` in Mon→Sun order — the §4.7 per-day split of one coach's `total` (quota, or paired-student count), capped by each day's capacity with the remainder redistributed
- `schedule(students, slots, mode, quotasOrPairings, knownCoaches, {classBlocks})` → `{assignments: [{student, coach, slot, offset}], unassigned: [{student, reason}]}`; omitting `classBlocks` skips the §5.3 checks
- `expandToAppointments(assignments, startMonday, timeZone)` → appointment rows per §7.1, each carrying the student's `classBlock`
- `blockedWeekLookup(blocks)` → `(coach, week, day) → boolean`, the §11.2 blocked test built once over a stored block list. Exported since v1.9 so the §17.4 blocked-week refusal reads blocking through the same normalisation the §11.3 post-pass uses
- `sortAppointments(rows)` → the same rows in §7.1 order (date, start time, coach name, student name). Exported since v1.9 so the §17 overlay can re-sort a schedule it has spliced regenerated rows into, rather than keeping a second copy of the row-order rule
- `expandClassSessions(classBlock, startMonday)` → one dated row per class per term week for that block, in date order — the class half of the §14.2 student timeline. Weeks 4/8/12 are included: they hold no *coaching*, but classes run as usual. Times stay naive campus wall-clock, exactly as uploaded and as the §4.4a clash check reads them
- Invariant assertions in tests: no appointment in weeks 4/8/12; exactly 4 appointments per assigned student; no coach double-booked (same coach, same slot, same week); no appointment overlaps a class in the student's own class block.

`exporter.js` exposes the §7.3 batch upload as pure functions alongside the
download entry point, so `tests.html` can assert on the exact rows and cells:

- `buildCoachAssignmentRows(assignments)` → one object per scheduled student
- `buildCoachAssignmentAoa(assignments)` → `[headers, ...rows]`
- `findCoachesWithoutSfId(assignments)` / `coachSfIdErrorMessage(coaches)` → the §7.3 refusal
- `buildCoachAssignmentsWorkbook(assignments, mode)` → the SheetJS workbook, without writing it
- `exportCoachAssignments(assignments, mode)` → writes the file, returns the filename
- `COACH_ASSIGNMENT_HEADERS` / `COACH_ASSIGNMENT_CONSTANTS` / `buildCoachAssignmentsFilename(now)`

It exposes the §7.4 coach calendar the same way:

- `coachMeetings(appointments, coach)` → that coach's rows from the final schedule
- `exportableCoachMeetings(appointments, coach)` → those of them that can become events, chronologically; what the UI counts to enable its control
- `buildCoachCalendar(appointments, coach, options)` → `{content, filename, meetings}`, the whole file as text, without downloading
- `buildCoachCalendarFilename(coach, now)` / `exportCoachCalendar(appointments, coach, options)`

`ics.js` is pure and DOM-free:

- `escapeIcsText` / `foldIcsLine` / `serialiseIcsLines` / `icsUtcStamp` / `slugify`
- `meetingUid(appointment)` / `meetingSummary` / `meetingDescription` / `meetingEventLines(appointment, options)`
- `buildCalendarIcs(appointments, options)` → one VCALENDAR holding one VEVENT per meeting
- `isExportableMeeting(appointment)`

`bookings.js` holds the §14 view models, built from the same final appointment
rows and the scheduler's own `assignments`/`unassigned`/`exceptions`:

- `bookingCoaches(coaches, appointments)` → every coach a booking view can offer
- `buildCoachBookings(appointments, coach)` → `{coach, rows, students, studentCount, meetingCount}`
- `buildStudentTimeline(student, context)` → `{coach, unassignedReason, classBlock, entries, classCount, coachingCount, exceptions}`
- `classBlockForStudent(classBlocks, student)` / `filterStudents(students, query)`

`edits.js` holds the §17 manual-edit overlay. It is pure and DOM-free: it
validates a *proposed* move or swap and it replays a list of committed edits
over a finished schedule, and it does nothing else — app.js owns every piece of
wiring, and no function here reads or writes the DOM, `localStorage` or the
clock:

- `placementsFromAssignments(assignments)` → `[{student, coach, slot, offset}]`, the editable form of the schedule
- `slotAt(slots, coach, day, start)` / `positionKey(coach, day, start)` → the (coach, slot) cell a position belongs to
- `occupancyOf(placements)` → cell key → `{offset: placement}`, the §4.5 three-position view of every cell
- `freeOffsetsIn(placements, cell, ignoreIds)` → the offsets still open in a cell, ignoring named students (which is what makes a swap, and a move within one cell, legal)
- `validateMove(context, placements, {contactSfId, coach, day, start})` → `{ok, refusal, warnings, weeks, offset, edit}` — the §17.4 refusals and §17.6 warnings for a proposed move or tray placement, with the offset §17.2 gives the student and the term weeks that offset produces
- `validateSwap(context, placements, {contactSfId, withContactSfId})` → the same shape for a swap, refused **whole** if either direction fails (§17.4a)
- `replayEdits(context, placements, edits)` → `{placements, applied, skipped}`; every edit is re-validated as it is replayed, so an edit that a later undo has invalidated is dropped rather than applied blind
- `buildEditedSchedule(base, edits, context)` → `{assignments, unassigned, appointments, exceptions, placements, edits, skipped, movedCount}` — the §17.5 overlay: unedited students keep their exact rows (including a §11.3 move), edited students' four meetings are regenerated, and the result is re-sorted with `sortAppointments`
- `validatePosition(context, placements, {student, slot, offset, ignoreIds})` → the §17.4 checks for one student at one position, shared by moves, swaps and replay so there is one implementation of each invariant
- `buildCoachGrid(context, placements, coach)` → `{coach, days, rows, slotCount}` — the §17.2 grid as data: rows of start times, cells per weekday, three offset positions each, cells outside availability marked and class-block clashes **named**
- `describeEdit(edit)` / `describePosition(position)` / `describeWeeks(offset)` / `EDIT_REFUSALS` / `EDIT_WARNINGS` — the strings §17.7 lists and §17.4/§17.6 name

The parsers additionally expose `parseClassScheduleSheet(fileName, sheetRows)` and `parseStudentListSheet(fileName, sheetRows)` — the same validation applied to an already-read array-of-arrays, so `tests.html` can exercise the real rules without SheetJS or a workbook.

## 10. Out of scope (v1)

Per-student class timetables (a student belongs to a class block, not to a bespoke timetable); student-specific coaching availability; more than one campus per run (§6.1 fixes one location per run; cross-campus scheduling would require per-block zones and absolute-time clash detection); public holidays; **editing a single dated occurrence of a meeting**; removing a student from a generated schedule.

**Narrowed by v1.9 (normative).** Until v1.9 this section excluded "editing individual appointments after generation" outright, and "moving a displaced meeting to a different coach". §17 replaces both with something narrower, and the difference matters:

- The unit of edit is a student's **whole placement** — the coach, weekday, start time and offset that §4.3 already treats as atomic — so all four of their meetings move together. Editing **one dated occurrence** (moving only meeting 3 to a different week or hour) stays out of scope: it would break §4.3's "same coach, same weekday, same start time for all 4 meetings", and nothing in §17 can produce it.
- **No automatic redistribution ever changes a coach.** §11.3 is untouched: a displaced meeting is rebooked with the same coach inside the same term block, or becomes an exception. What v1.9 adds is that an **explicit user action on the whole placement** can relocate a student to another coach, and their four meetings are then recomputed at the new (coach, slot, offset) — including any meeting §11.3 had moved or dropped (§17.5). That is a deliberate widening of this clause, not an oversight in §11.3.
- **Removing** a student from the schedule is not supported (§17.3): an edit relocates a placement, it never deletes one. The way to remove a student is to change the inputs and regenerate.

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

**No rebooking on a manual move (v1.9, normative).** This post-pass runs once, over the §4/§5 schedule, before any §17 edit. A manual move is never followed by a second run of it: if any of the four meetings a move would produce falls on the target coach's blocked week or date, the move is **refused** (§17.4) rather than quietly rebooked somewhere else. The person making the move can see the grid and choose again; silently relocating one of their four meetings would answer a question they did not ask.

**This rule is unchanged by §4.7 (normative).** Redistribution stays bounded to the **same coach and the same term block**, in the order above, and does **not** re-balance the coach's days: step 1 keeps the meeting on its own weekday and start time wherever it can, and step 2 falls back to the coach's §4.6 slot order, not to §4.7's day ranking. A coach's day balance may therefore end up uneven after weeks or dates are blocked — that is the correct outcome, because keeping a displaced meeting with its coach inside its block matters more here than the spread §4.7 sets up at assignment time.

### 11.4 Export and reporting

One column is appended to the §7.1 defaults: **Rescheduled From Week** (blank unless the row was moved by this post-pass). Exceptions from §11.3(3) appear in the Results step in the unassigned/exceptions table, per meeting, with the reason string above.

### 11.5 Tests

tests.html must additionally assert: no appointment lands on a blocked coach-week or coach-date; every moved appointment remains within its original block and coach; invariants hold after redistribution; a coach blocked for all three weeks of a block yields exactly one exception per affected student for that block.

## 12. Class-block tests (v1.3)

tests.html must exercise the real engine and the real parser rules, and assert at least:

1. One class block totalling exactly 13.5 hours is accepted with no warning.
2. Several class blocks coexist in one run, each with its own 13.5 hours.
3. A block totalling less than 13.5 hours is warned about — not rejected — with the block name and its actual total in the message.
4. A block totalling more than 13.5 hours is warned about the same way.
4a. A block off the expected total still parses into usable rows and schedules.
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
2. The output has exactly the eight §7.3 headers, in exactly that order, and every row has eight cells.
3. `Record Type` is `0121Q000001Dw6tQAC` on every row.
4. `Record Type Name` is `Institutional Relations` on every row.
5. `Type` is `coach` on every row.
6. `Status` is `current` on every row.
7. Each scheduled student appears exactly once.
8. A student with four coaching appointments appears once, not four times.
9. The exported coach is the student's actual final assigned coach, with more than one coach in play.
10. `Coach User ID` exactly equals the source `Coach SF ID`, both as uploaded and as carried on the slot.
11. No new coach input field is needed: an availability row carrying only the §3.2 columns populates `Coach User ID`.
12. `Student Contact SF ID` (v1.10) exactly equals the student's source `Contact SF ID`, is never blank, sits in column 2, and is unique per row.
13. No new student input field is needed: a student row carrying only the §3.3 columns populates `Student Contact SF ID`.
14. Unassigned students are excluded.
15. A missing or blank `Coach SF ID` is detected, names the coach, and refuses the export.
16. Output is deterministic, and row order follows the scheduler's assignment order.
17. Pre-allocated mode does not produce the export (both entry points refuse).
18. The §7.1 appointments export is unchanged — default columns and filename.
19. A custom §7.2 appointment mapping does not change the eight-column batch upload.
20. The generated workbook carries the exact headers and values, and Salesforce identifiers survive a write/read round-trip as text (including an all-digit id keeping its leading zeros) — the student's and the coach's alike.

Workbook assertions need SheetJS; when the CDN is unreachable those tests report as **skipped** rather than failed, and the pure data-builder tests still run.

## 14. Booking views (v1.5; moved to the Edit step in v1.9, normative)

A **Bookings** card on the **Edit** step (§17), below the coach grid. It moved
there wholesale in v1.9 — both views, with their content, empty states and
accessibility rules unchanged. Results no longer carries a bookings view.

**Not read-only any more (v1.9).** Until v1.9 this section opened by declaring
the card a read-only inspection view that "adds no editing of appointments".
That is now false, and the correct statement is narrower: **the card itself
displays; the Edit step's grid and tray (§17) are what change a placement.** No
value in either view is ever recalculated or edited in place — the rows *are*
the schedule's appointment objects — but the schedule they are read from is the
**edited** one (§17.5), so an edit is reflected here the moment it is made.

It reads the same final appointment rows the §7.1 export writes, plus the
scheduler's own `assignments`, `unassigned` and §11.3 `exceptions`, all as
amended by the §17 overlay, and keeps no second copy of the schedule — so it
cannot drift from the export or from the grid, and it is rebuilt whenever any
input or any edit changes.

**Shape.** A two-segment toggle (`By coach` / `By student`, the §3.4 control,
not a switch), a selector for the chosen side, and one results panel. Nothing
is listed before a selection is made, so a run with thousands of students
renders nothing until a coach or student is chosen. The §7.4 `.ics` control is
**not** here: it stayed on Results, in its own **Coach calendars** card.

### 14.1 Coach view

A `Coach` select offering **every coach in the run** in coach-file order,
including a coach who ended up with no meetings (so their empty diary can be
seen rather than inferred). On selection, the panel shows that coach's meetings
in **chronological order** — date, then start time, then student name — one row
per meeting with:

| Column | Source |
|---|---|
| Date | the appointment's own date |
| Day | the appointment's weekday |
| Start / End | the appointment's own start and end times |
| Student | student name and Contact SF ID |
| Class block | the student's cohort (§3.1) |
| Meeting | the meeting number, 1–4 |
| Service name | `Coaching 1 - Meeting N` (§7.1) |
| Term week | the week, as a chip in its term block's colours (DESIGN.md §3.5), plus a `Moved from week N` chip where §11.4 applies |

Above the table: `N students · M coaching appointments`.

No value is recalculated: the rows *are* the schedule's appointment objects.

### 14.2 Student view

A search field (matching student name or Contact SF ID, case-insensitively) and
a `Student` select, listing every student in the run — assigned or not. Long
lists are capped in the select with a line saying how many matched and how many
are shown.

On selection, a summary line states the student's name, Contact SF ID, their
**assigned coach** (or an `Unassigned` chip carrying the scheduler's own
reason), their **class block**, and the number of class sessions and coaching
meetings. Below it, a single **chronological timeline** merging both kinds of
entry — class before coaching where they start in the same minute — with:

| Column | Class entry | Coaching entry |
|---|---|---|
| Date / Day / Start / End | the class session | the appointment's own values |
| Type | `Class` chip | `Coaching` chip |
| Class or meeting | the class name | the Service Name (`Coaching 1 - Meeting N`) |
| Coach / class block | the class's block | the assigned coach |
| Term week | the week chip | the week chip, plus `Moved from week N` where §11.4 applies |

Class and coaching are told apart by their labelled chips and their column
values, never by colour alone.

**Class blocks (normative).** Only the student's **own** class block is
expanded (§4.4a): another cohort's classes are irrelevant to them and must not
appear. Classes recur weekly across all 15 term weeks, weeks 4/8/12 included —
those weeks hold no *coaching*, but classes run as usual. Class times are the
naive campus wall-clock values as uploaded, which is exactly what the clash
check reads; only coaching appointments carry the §7.1 offset-bearing instants,
because only they are exported.

### 14.3 Unassigned students and exceptions

- An unassigned student (§5.1, §5.2, §5.3) remains selectable, shows their
  known class sessions, shows **no** coaching meetings, and states the
  scheduler's own reason. No appointment is ever fabricated.
- A student whose class block is missing or unknown is shown as such and gets
  no class sessions either: there is no timetable to show, and guessing one
  would be a fabrication of a different kind.
- A student with a §11.3 exception has that meeting missing from their timeline
  — because it is missing from the schedule — and the panel says how many of
  their meetings could not be rebooked.
- A rescheduled meeting (§11.4) appears once, at the week it was moved to, and
  is marked with the week it moved from.

### 14.4 Empty states

Every state says what to do next, in the §3.3 table-empty style: no schedule
generated yet (the Edit step already explains what is missing); no coach
selected; no student selected; the selected coach has no meetings; the selected
coach has meetings but none that can become calendar events; the selected
student has no coaching meetings; a search matching no student. The last two
coach states are also the wording the §7.4 Coach calendars card uses for a
disabled row.

### 14.5 Accessibility

The toggle, selectors and search field are all keyboard operable, with visible
focus (DESIGN.md §5) and real `<label>`s. The selected segment is distinguished
by its checked radio and its fill, not by colour alone. Both tables use
`<thead>` header cells and a visually hidden `<caption>` naming what the table
lists, and the results panel is a live region so a new selection is announced.
Nothing depends on hover. The §7.4 export buttons, now on Results, keep the
same rule: each one's accessible name states that it downloads one calendar
file holding every meeting for the coach it names.

## 15. Booking-view and coach-calendar tests (v1.6)

tests.html must exercise the real view models and the real ICS serialiser, and
assert at least:

1. A coach selection returns all and only that coach's scheduled students and appointments.
2. Coach bookings are sorted chronologically.
3. The coach list offers every coach, including one with no meetings.
4. A student selection returns their assigned coach.
5. A student's combined timeline contains both class and coaching entries, in chronological order.
6. Class entries use the student's own class block.
7. Another block's classes never appear in a student's timeline.
8. An unassigned student receives no fabricated bookings, and their reason is the scheduler's own.
9. A blocked/rescheduled meeting is represented by the actual generated appointment, at the week it moved to.
10. The booking views are unchanged after the schedule is rebuilt from the same inputs.
11. No selection, an unknown coach, an unknown student and an empty appointment list all return empty views rather than throwing.
12. Selecting a coach with meetings is what enables the export control; no coach, or a coach with no meetings, does not.
13. The generated `.ics` is a single `VCALENDAR` containing exactly one `VEVENT` per scheduled meeting for the selected coach, and no extras.
14. No meeting belonging to another coach is in the file, and no meeting the schedule does not contain.
15. Every event carries the required properties, the calendar-level properties are written once, and the events are in chronological order.
16. `DTSTART` and `DTEND` match the appointment's own instants, on both sides of a daylight saving change.
17. The event carries the correct student, coach, class block and campus context.
18. ICS text escaping handles backslashes, semicolons, commas and newlines, in student, coach and location values.
19. Lines are CRLF-terminated and folded at 75 octets without splitting a multi-byte character; unfolding restores the value.
20. UIDs are unique across a coach's meetings and across coaches, and are deterministic.
21. The filename names the coach and the generation time, ends `.ics`, and carries no character a file system would refuse.
22. Re-exporting the same schedule produces byte-identical output, and every event shares one `DTSTAMP`.
23. A coach with no meetings produces no file at all, and an eventless calendar is refused.
24. The export does not modify the appointment rows.
25. The §7.1 appointments export and the §7.3 batch upload are unaffected.

The booking views and the calendar export are asserted through their pure
functions, without a DOM. The corresponding on-screen behaviour — the card, its
toggle, its selectors, the enabled/disabled export button and the real download
— is verified in the browser.

## 16. Day-balanced allocation tests (v1.8)

tests.html must exercise the real engine and assert at least:

1. `balancedDayTargets` splits a quota of 10 across four 6-place days as 3/3/2/2 — the §4.7 worked example — and the schedule really does place 3/3/2/2, not 6/4/0/0.
2. A day's target is capped by that day's capacity and the remainder moves to the days with room; a target never exceeds the places that exist; a coach with no valid slot has no day to balance.
3. Within a day the order is unchanged: earliest start time first, offsets 1→2→3 before the next slot.
4. Days are chosen in the stated tie-break order: largest deficit, then fewest meetings so far, then earliest day.
5. A single-day coach is unaffected — exactly the §4.6 order.
6. Balance is per coach: one coach's days never rebalance another's, and coach file order is unchanged.
7. When a student's target day is barred by their own class block (§4.4a), they fall to the day with the largest deficit, nobody is placed during their own class, and the same hour is still offered to a cohort that can use it.
8. Balancing never breaks the §5.1 quota, the §4.5 per-slot capacity, or the §5.1/§5.2 unassigned reasons.
9. Pre-allocated mode is balanced across days too, with pairings-file order still deciding who goes first, and overflow still `coach over capacity`.
10. Identical inputs produce an identical balanced schedule (§4.6).
11. A balanced run still satisfies the §9 invariants end to end.
12. The §11.3 post-pass keeps its own rule: a displaced meeting stays on its own weekday, start time, coach and term block rather than being re-balanced.

## 17. Manual editing (v1.9, normative)

The **Edit** step sits between Review and Results. It appears once a schedule
has been generated, and it requires no edits: a **Continue to Results** action
always proceeds, so a run that needs no adjustment is exactly the run v1.8
produced.

Everything here is an overlay on a finished schedule. The engine (§4, §5) is
not re-run, re-ordered or parameterised by an edit, and no rule in §4/§5/§11 is
weakened by one — §17.4 refuses anything that would break a §9 invariant.

### 17.1 The unit of edit

An edit acts on a **student's whole placement with a coach**: their coach,
weekday, start time and offset. All four of that student's meetings move
together, because §4.3 already requires them to share a coach, a weekday and a
start time. Editing a single dated occurrence is out of scope (§10) and no
operation in §17.3 can produce one.

### 17.2 The coach grid

One coach at a time. A **coach selector** chooses whose week is shown, then a
**grid** whose rows are start times and whose columns are weekdays. Each cell
is one **(coach, slot)** pair and holds up to **three positions**, one per
offset (§4.5). Every position shows the **student's name**, the **offset**, and
the **term weeks that offset produces** (§4.2).

Four cell states must be told apart, and by more than colour (DESIGN.md §5):

- **positions that are free** — the offset, and the weeks a student placed
  there would meet in;
- **cells outside the coach's availability** — no slot exists at that weekday
  and time, so nothing can be placed there;
- **cells that clash with a class block** (§4.4a) — the cell **names which
  block(s)**, because it is still perfectly usable by every other cohort, and
  the name is the answer to "why was this refused for that student?";
- **cells inside a blocked week or date** for that coach are not a cell state:
  blocking is per week (§11), not per slot, so it is the *offset* that decides,
  and it is reported by the §17.4 refusal.

**Offset on a move (normative).** A student moved into a cell takes the **first
free offset** in it, so their meeting weeks change. The UI must show the
resulting weeks **before the edit is committed** — the offset that will be used
and its four weeks are on the target itself, not revealed only afterwards.

### 17.3 Operations

Exactly three, and no others:

1. **Move** a student to a different coach and/or slot.
2. **Place** an unassigned student into a free position.
3. **Swap** two students' placements.

**Removing** a student from the schedule is **not supported**: there is no
operation that leaves a student unscheduled, and the unassigned tray is a
source, never a destination.

**The unassigned tray.** A panel beside the grid listing **every** unassigned
student with **the scheduler's own reason** (§5.1, §5.2, §5.3) — never a
reworded or guessed one — from which they can be placed.

### 17.4 Hard refusals

The edit is **blocked** and a message **names the reason**. Each of these is
exactly a §9 or §11.5 invariant, which is why none of them is negotiable:

- the target slot overlaps a class in **that student's own class block**
  (§4.4a) — the message names the block;
- there is **no free offset** in the target cell (except as a swap, §17.4a);
- it would **double-book the coach**, or **exceed slot capacity** (§4.5) — one
  cell is one coach at one weekday and hour, so both are the same check on the
  three offsets;
- any of the **four resulting meetings** falls on the target coach's **blocked
  week or date** (§11.2). No automatic §11.3 rebooking is attempted on a manual
  move (§11.3, "No rebooking on a manual move");
- the student's **class block is missing or unknown** (§5.3). This one is a
  deliberate narrowing of "every unassigned student can be placed": §5.3 sets
  these students aside *because* no timetable of theirs exists, so there is
  nothing to check a slot against, and §14.3 already calls inventing one a
  fabrication. Placing them would schedule a student whose classes this tool
  has never seen — a clash it could not detect, not a clash it has cleared.
  They still appear in the tray with the scheduler's own reason (§17.3), and
  the tray says the fix is in the student list. Every *other* unassigned
  reason — `insufficient capacity`, `no free slot outside their class block`,
  `coach over capacity`, `no pairing`, `coach not found` — is placeable, which
  is the whole point of the tray.

A refusal changes nothing: no partial placement, no edit recorded, and the
student stays exactly where they were.

#### 17.4a Swap

Dropping a student onto an **occupied** position swaps the two placements: each
takes the other's cell and offset, and both students' meeting weeks change
accordingly. **Both directions must pass every §17.4 check**, or the swap is
refused **whole** — there is no partial application, and a swap is never
downgraded to a one-way move.

### 17.5 Edits as an overlay

Edits apply **after §5 assignment and after the §11.3 post-pass**, over the
final appointment rows.

- A student whose placement is unchanged keeps their rows **exactly**,
  including a §11.3 move and its `Rescheduled From Week` value.
- A student whose placement changed has all four meetings **regenerated** from
  their new (coach, slot, offset), so their rows carry the new coach, dates,
  times and export instants (§7.1), and their `Rescheduled From Week` is blank:
  those rows are no longer the post-pass's output. A §11.3 **exception**
  belonging to a moved student is resolved for the same reason — §17.4 forbids
  any of the four new meetings landing on a blocked week.
- The scheduler's `assignments` and `unassigned` are amended to match, so the
  student→coach mapping every consumer reads is the edited one (§7.3, §12).
- Edits are held **in memory for the session** and are **not** written to
  `localStorage` (§2: uploaded data is never persisted, and an edit names an
  uploaded student).
- The overlay is deterministic: the same schedule and the same ordered edit
  list always produce the same result (§4.6).

### 17.5a Regeneration discards edits

Any change that **recomputes the schedule** — uploads, mode, FTE, start date,
campus, blocked weeks/dates — **clears every manual edit**, and only after an
**explicit confirmation dialogue stating how many edits will be lost**.
Cancelling leaves both the setting and the edits untouched. There is **no
partial re-application**: an edit describes a position in a schedule that no
longer exists, so replaying it onto a different schedule would silently mean
something other than what was asked for.

### 17.6 Soft warnings

The edit is **allowed**, and a warning is shown and **persists in the edits
list** (§17.7):

- the coach's **FTE quota** (§5.1) is exceeded — the quota binds the automatic
  pass, not the person editing (§5.1, "Quota binds the automatic pass"). In
  pre-allocated mode there is no quota, so this warning does not arise;
- the **day-balance rule** (§4.7) is breached — the target day now holds more
  meetings than its balanced share of that coach's placements.

### 17.7 The edits list

An **Edits (N)** list showing each change **in the order made**: the student,
**from**, **to**, and any warning. Each entry has its own **undo**, and a
**Reset all edits** control clears the lot. Undoing an edit replays the ones
after it; any that no longer applies to the resulting schedule is dropped too,
and the app says how many.

### 17.8 Downstream

Every consumer reads the **edited** schedule: the §14 booking views, the
Results summary and per-coach utilisation, the §6.4 class-blocks card, and all
three exports (§7.1, §7.3, §7.4). **Export column sets are unchanged, and
manual edits are not flagged in any export file** — only on screen.

### 17.9 Interaction and accessibility

Interaction is **not drag-only**. Select-then-place must work by **click and by
keyboard**, with visible focus (DESIGN.md §5), real labels, a **live-region
announcement** of the result — the placement made, or the refusal and its
reason — and **no dependence on hover** (§14.5). Every grid position and every
tray entry is a real control with an accessible name naming the student, the
coach, the day, the time, the offset and the weeks it concerns.

**Test expectations** are §18.

## 18. Manual-editing tests (v1.9)

tests.html must exercise the real overlay and the real validation, and assert
at least:

1. A move updates **all four** meetings — new coach, weekday, start time — and the new offset's weeks are the ones §4.2 gives it.
2. Each §17.4 refusal, **separately**: the student's own class block; no free offset in the target cell; a double-book / slot over capacity; and each of the four resulting meetings landing on the target coach's blocked week or date.
3. A swap that must be refused is refused **whole**: neither student moves, and no edit is recorded.
4. A permitted quota breach is applied **and** warns, and the warning persists on the edit.
5. Placing a student from the unassigned tray schedules them, removes them from `unassigned`, and adds them to `assignments`.
6. Undo restores the previous schedule exactly, and "reset all" restores the unedited one.
7. Regeneration clears the edits: an edited schedule rebuilt from changed inputs carries no edit.
8. All §9 and §11.5 invariants hold over an **edited** schedule: 4 meetings per assigned student, nothing in weeks 4/8/12, no coach double-booked, no overlap with the student's own class block, nothing on a blocked coach-week or coach-date.
9. The exports reflect edits with **unchanged column sets**: the §7.1 appointment rows carry the new coach and instants, the §7.3 batch upload names the new coach and keeps its eight headers, and the §7.4 calendar puts the meeting in the new coach's file and not the old one's.
10. An unedited student is untouched by another student's edit, including a §11.3 rescheduled row keeping its `Rescheduled From Week`.
