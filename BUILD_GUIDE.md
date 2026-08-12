# Build Guide — Coaching Meeting Scheduler

This guide assumes **no coding knowledge**. You will create a GitHub repository, turn on free hosting (GitHub Pages), and then run six Claude Code Web sessions, pasting one prompt per session. Claude Code writes all the code; your job is to run the prompts in order and check the result after each session.

Total hands-on time: roughly 1–2 hours spread across the six sessions.

---

## Part A — One-time setup (about 15 minutes)

### A1. Create a GitHub account
1. Go to https://github.com and sign up (free plan is sufficient).

### A2. Create the repository
1. Click the **+** icon (top right) → **New repository**.
2. Repository name: `coach-scheduler`.
3. Visibility: **Public** (required for free GitHub Pages).
4. Tick **Add a README file**.
5. Click **Create repository**.

### A3. Upload the specification and templates
1. On the repository page, click **Add file → Upload files**.
2. Drag in: `SPEC.md`, `BUILD_GUIDE.md`, and the four template files (`class_schedule_template.xlsx`, `coach_availability_template.xlsx`, `students_template.xlsx`, `pairings_template.xlsx`).
3. In the commit message box type `Add spec and templates`, then click **Commit changes**.

(The templates will be moved into a `/templates` folder by Claude Code in Session 1 — uploading them to the repository root now is fine.)

### A4. Enable GitHub Pages
1. In the repository, go to **Settings → Pages** (left sidebar).
2. Under **Build and deployment**: Source = **Deploy from a branch**; Branch = **main**, folder = **/ (root)**. Click **Save**.
3. After a minute or two the page will show your site URL, of the form `https://<your-username>.github.io/coach-scheduler/`. Bookmark it. (It will show the README until Session 1 adds the app.)

### A5. Open Claude Code on the web
1. Go to https://claude.ai/code (Claude Code on the web).
2. Connect your GitHub account when prompted and grant access to the `coach-scheduler` repository.
3. Start a new session on that repository.

---

## Part B — How to run each session

For every session below:

1. Start a **new** Claude Code Web session on the `coach-scheduler` repository.
2. Paste the session prompt exactly as written.
3. Let Claude Code work. If it asks a question, answer it; if unsure, tell it to follow `SPEC.md`.
4. When it finishes, ask it: **"Commit and push all changes to main."** (It may have done this already.)
5. Wait ~1–2 minutes for GitHub Pages to redeploy, then open your site URL and run the verification checks listed for that session. Hard-refresh the page (Ctrl+Shift+R / Cmd+Shift+R) so you are not seeing a cached version.
6. If something is wrong, stay in the same session and describe the problem in plain language (e.g. "the upload button does nothing", "the error message doesn't say which row is wrong"). Claude Code will fix and re-push.

Keeping one session per stage keeps each session small and reliable; `SPEC.md` in the repository is the shared source of truth across sessions.

---

## Part C — The six sessions

### Session 1 — Scaffold and deploy

**Prompt:**

> Read SPEC.md in this repository in full before writing any code. Build the project scaffold per §2: index.html, styles.css, and empty ES-module files js/app.js, js/parse.js, js/scheduler.js, js/exporter.js, js/storage.js. Move the four .xlsx template files from the repo root into a /templates folder. Build the stepper UI shell described in SPEC.md §6 (Setup, Upload, Review, Results steps) with the start-date picker (normalising to the Monday of the chosen week, with a visible notice when it changes the date), the auto/pre-allocated mode toggle, and download links to the four templates. Load SheetJS from the CDN named in §2. No scheduling logic yet — controls can be inert beyond navigation and the date/mode state. Style it cleanly and simply: this is an internal admin tool used on a laptop. Persist the start date and mode to localStorage via storage.js. Update README.md with a one-paragraph description and the site URL placeholder. Do not add any build tooling, package.json, or framework — plain files only, per the spec. Commit and push to main.

**Verify:** site loads; you can pick a date and see it snap to Monday with a notice; the toggle works; all four templates download.

### Session 2 — Excel parsing and validation

**Prompt:**

> Read SPEC.md §3 and §8. In js/parse.js, implement parsers for the four Excel file types using SheetJS, exactly per the column specs: accept times as text HH:MM or native Excel time values; accept full or 3-letter day names case-insensitively; trim whitespace; skip blank rows and rows whose first cell begins with #. Implement every validation rule in §8, producing structured results {rows, errors, warnings} where each error names the file, row number, and problem in plain English. Wire the Upload step in app.js: file pickers plus drag-and-drop for class schedule, coach availability, student list, and (visible only in pre-allocated mode) pairings; show per-file results immediately after selection — row count on success, the full error/warning list on failure. Parsed data is held in memory only, never in localStorage. Add a small "clear all uploads" button. Commit and push to main.

**Verify:** upload each unmodified template — each should parse with 1 example row and no errors. Then deliberately break one (delete a header, type `25:00` as a time, duplicate a Contact SF ID) and confirm the error names the file, row, and problem.

### Session 3 — Scheduling engine and tests

**Prompt:**

> Read SPEC.md §4, §5, and §9. Implement js/scheduler.js as pure functions with no DOM access, matching the §9 contract exactly: buildSlots, computeQuotas, schedule, expandToAppointments. Follow the normative rules in §4 precisely: 15-week term; offsets 1/2/3 mapping to weeks {1,5,9,13}/{2,6,10,14}/{3,7,11,15}; 60-minute slots starting on :00 or :30, fully inside a coach availability block and overlapping no class block; at most 3 students per (coach, slot); deterministic ordering per §4.6. Implement both modes per §5, including FTE-proportional quotas by largest remainder with capacity capping and redistribution, and every unassigned reason string named in the spec. Create tests.html: a page that imports scheduler.js, runs assertions covering the §9 invariants (no meetings in weeks 4/8/12; exactly 4 appointments per assigned student; no coach double-booking; no class-block overlap), the quota maths (including a part-time 0.5 FTE case), both modes, and the over-capacity path, and displays a green/red pass-fail list. All tests must pass. Commit and push to main.

**Verify:** open `https://<username>.github.io/coach-scheduler/tests.html` — every test green.

### Session 4 — Wiring the modes: FTE editor, review, results

**Prompt:**

> Read SPEC.md §5 and §6. Wire the Review and Results steps in app.js using the parse.js and scheduler.js modules. Review step: in auto mode, render the FTE editor (one numeric input 0.05–1.00 per coach, default 1.00, persisted to localStorage keyed by coach name and restored on future visits) and the capacity summary table (coach, valid slot count, capacity, FTE, quota); in pre-allocated mode, show a pairings coverage summary instead. Show a prominent warning when total capacity is below student count. Results step: run the engine and render the summary counts, per-coach utilisation table, the unassigned-students table with reasons, and a preview of the first 50 appointment rows. Recompute cleanly whenever inputs, mode, FTE values, or start date change. Commit and push to main.

**Verify:** with the templates plus a few extra rows you add yourself (e.g. 5 students, 2 coaches, one coach set to 0.5 FTE), the quota split follows FTE; switching modes without a pairings file marks students `no pairing`.

### Session 5 — Export, default and customisable

**Prompt:**

> Read SPEC.md §7. Implement js/exporter.js: generate the default export exactly per §7.1 (column set, real Excel dates plus ISO display format, sort order, timestamped filename) using SheetJS, triggered from an Export button on the Results step. Then implement the customisable mapping per §7.2 as a collapsible "Export settings" panel: rename headers, reorder via up/down buttons, include/exclude checkboxes, add constant columns (header + fixed value applied to every row), a "Reset to defaults" button, and persistence of the mapping to localStorage. The preview table on the Results step should reflect the current mapping. Commit and push to main.

**Verify:** export with defaults and open in Excel — one row per appointment, 4 per student, dates/sorting correct. Rename a column, add a constant column `Record Type = Coaching`, re-export, and confirm both changes appear and survive a page reload.

### Session 6 — Polish, documentation, hardening

**Prompt:**

> Read SPEC.md in full. Final pass: (1) verify every SPEC requirement is implemented, and fix any gaps you find, listing them in your summary; (2) error handling — no silent failures anywhere; any unexpected error surfaces a readable message; (3) add a "Start over" button that clears in-memory data and, after a confirm dialog, optionally clears localStorage settings; (4) confirm nothing beyond the settings named in SPEC §2 is ever written to localStorage and no network calls occur other than the SheetJS CDN load; (5) rewrite README.md as a non-technical user guide: what the tool does, the meeting rules, each template's columns, a walkthrough of the four steps, the two modes, FTE, custom export, and a troubleshooting section for every validation error message; (6) re-run tests.html and ensure all green. Commit and push to main.

**Verify:** read the README as if new to the tool; run one full end-to-end schedule and export; open tests.html — all green.

---

## Part D — Ongoing use and future changes

- **Using the tool each term:** open the site URL, set the start date, upload the term's files, review, export. Nothing is stored server-side; localStorage keeps only your settings on that browser.
- **Requesting changes later** (e.g. the multi-cohort feature): start a new Claude Code Web session, first ask it to update `SPEC.md` with the new requirement, review the spec change, then ask it to implement. Keeping the spec current is what keeps sessions reliable.
- **If a deploy doesn't appear:** check the repository's **Actions** tab for a `pages build and deployment` run, wait for it to finish, then hard-refresh.
