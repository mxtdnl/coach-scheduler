# Term Scheduler — user guide

Term Scheduler builds a term's worth of coaching meetings for you. You give it
four things — when classes run, when each coach is free, who the students are,
and (optionally) who coaches whom — and it hands back a spreadsheet with one
row per meeting, ready to upload or share.

Everything happens inside your web browser. Your spreadsheets are read on your
own computer and are never sent anywhere. Closing the tab throws the data away.

**Where to find it:** `https://mxtdnl.github.io/coach-scheduler/`

---

## Contents

1. [What the tool does](#1-what-the-tool-does)
2. [The meeting rules](#2-the-meeting-rules)
3. [The four templates and their columns](#3-the-four-templates-and-their-columns)
4. [Step-by-step walkthrough](#4-step-by-step-walkthrough)
5. [The two modes](#5-the-two-modes)
6. [FTE: sharing students between coaches](#6-fte-sharing-students-between-coaches)
7. [Changing the export columns](#7-changing-the-export-columns)
8. [Starting over](#8-starting-over)
9. [Troubleshooting: every message the tool can show](#9-troubleshooting-every-message-the-tool-can-show)

---

## 1. What the tool does

A term is 15 weeks long. Every student gets **four** one-hour coaching
meetings during it, always with the same coach, always on the same weekday at
the same time.

Working that out by hand is slow, because each meeting has to avoid the
student's classes, fit inside the coach's working hours, and not collide with
another student booked into the same hour. The tool does that arithmetic and
tells you where it could not.

What you get at the end is an Excel file with **one row per appointment** —
four rows for each student who was scheduled — with the student, the coach, the
date, the day, and the times.

What it does **not** do: it does not send invitations, book rooms, email
anybody, or know about public holidays. It is a planner, not a calendar.

---

## 2. The meeting rules

These rules are fixed. The tool will not break them, so if something cannot be
scheduled, it is one of these rules getting in the way.

**Four meetings, spread evenly.** Each student is put on one of three
patterns, called offsets:

| Pattern | Meetings fall in weeks |
|---|---|
| 1 | 1, 5, 9, 13 |
| 2 | 2, 6, 10, 14 |
| 3 | 3, 7, 11, 15 |

**Weeks 4, 8 and 12 are never used.** They are deliberate gaps in the rhythm.
You will see them greyed out and struck through on the term strip at the top of
the Review and Results steps.

That strip also shows the term's four **blocks** — weeks 1–3, 5–7, 9–11 and
13–15. Every student has exactly one meeting in each block.

**The same slot every time.** A student keeps the same coach, the same weekday
and the same start time for all four meetings. If Jane meets Alex at 10:00 on
Mondays, that is true in week 2, 6, 10 and 14.

**Meetings are one hour.** Always 60 minutes.

**Meetings start on the hour or the half hour.** 09:00 and 09:30 are possible
start times; 09:15 is not.

**A meeting must fit entirely inside one of the coach's availability blocks.**
A coach free from 09:15 to 10:30 has exactly one usable hour: 09:30–10:30.

**A meeting must not overlap a class.** Touching is fine — a class ending at
10:00 and a meeting starting at 10:00 is allowed.

**Three students per slot, maximum.** Each hour in a coach's week can hold up
to three students, one on each of the three patterns. That is what makes a
coach's capacity `number of usable hours × 3`.

**Same inputs, same output.** Run the tool twice with the same files and you
get exactly the same schedule. Nothing is random.

---

## 3. The four templates and their columns

Download all four from the Setup step. Each template has a header row, a grey
legend row, and one example row. **Any row starting with `#` is ignored**, so
you can keep the legend or delete it. Completely blank rows are ignored too.

Times can be typed as text in 24-hour form (`09:00`, `14:30`) or entered as
real Excel times — both work. Extra columns you add are ignored, and column
order does not matter.

### Class schedule

One shared timetable for everybody in the run. One row per weekly class.

| Column | Required? | What goes in it |
|---|---|---|
| Day | Yes | `Monday` to `Sunday`. Capitals do not matter, and `Mon`, `Tue`, `Wed`, `Thu`, `Fri`, `Sat`, `Sun` also work. |
| Start Time | Yes | When the class starts, e.g. `09:00`. |
| End Time | Yes | When it ends. Must be later than the start. |
| Class Name | No | A label for your own benefit, e.g. `Marketing Fundamentals`. Not used in the schedule. |

### Coach availability

One row per weekly window a coach can offer. A coach with two windows on
Monday and one on Thursday gets three rows.

| Column | Required? | What goes in it |
|---|---|---|
| Coach Name | Yes | Spell it **identically** on every row and in the pairings file — this name is how the tool recognises the coach. `A. Coach` and `A Coach` are two different people as far as the tool is concerned. |
| Coach SF ID | Yes | The coach's Salesforce ID. It goes into the export, so it must be the same on every row for that coach. |
| Coach Email | Yes | The coach's email address. Also exported, and also must match on every row for that coach. |
| Day | Yes | As above. |
| Start Time | Yes | Start of the window the coach is free, e.g. `13:00`. |
| End Time | Yes | End of that window. |

### Student list

| Column | Required? | What goes in it |
|---|---|---|
| Contact SF ID | Yes | The Salesforce contact ID. Must be unique — the same ID twice is an error. |
| Student Name | Yes | The student's name, used in the export and in the on-screen tables. |
| Student Email | Yes | The student's email address. It is exported, so it has to look like a real address. |

The order of this file matters a little: when there are not enough places for
everybody, students nearer the top are scheduled first.

### Pairings

Only needed in **pre-allocated** mode. One row per student.

| Column | Required? | What goes in it |
|---|---|---|
| Contact SF ID | Yes | Must match an ID in the student list. |
| Coach Name | Yes | Must match a coach in the availability file, spelled the same way. |

---

## 4. Step-by-step walkthrough

The four steps run left to right down the side of the page. You can click back
and forth between them freely; nothing is lost.

### Step 1 — Setup

**Pick the term start date.** Choose any date in the first week of term. Weeks
run Monday to Sunday, so if you pick a Wednesday the tool moves it back and
tells you: *"Week 1 will start Monday 7 September (moved from your selected
date)."* That is not an error — it is the tool being explicit.

**Choose the campus.** London, Boston, or Dubai. One run covers one campus.
Every time you type into the availability and class timetable files is read as
local time at that campus, and the exported meeting times carry that campus's
UTC offset. The note under the picker spells out which offset you will get.

**Choose a mode.** Auto-assign or pre-allocated — see [section 5](#5-the-two-modes).

**Download the templates** you need. Three in auto-assign mode, four in
pre-allocated mode.

### Step 2 — Upload

Drag each filled-in file onto its box, or click the box to browse. Each file is
checked the moment it arrives.

- A file that is fine collapses to a single line: the filename, how many rows
  were read, a tick, and a **Replace** link.
- A file with problems stays open and lists them underneath, one line per
  problem, each naming the row number. Fix the spreadsheet and drop it in
  again — it replaces the old one.

A file with errors is not used at all until you fix it. **Clear all uploads**
empties every box at once.

### Step 3 — Review

This is the sanity check before you commit.

In **auto-assign** mode you get a table with one row per coach: how many usable
hours they have, their capacity (hours × 3), an editable FTE box, and the
resulting quota of students. Change an FTE and every number updates
immediately.

In **pre-allocated** mode you get a coverage table instead: how many students
have been paired to each coach, and whether that fits.

Underneath, a **Warnings** panel collects anything that is odd but not fatal —
usually pairings pointing at people the tool cannot find.

If capacity is lower than the number of students, an amber banner says so and
by how much, before you get as far as the results.

### Step 4 — Results

- A one-line summary: how many students were scheduled, how many appointments
  that makes, and how many students could not be placed.
- **Coach utilisation** — how full each coach's diary ended up.
- **Unassigned students** — anybody who could not be scheduled, with the
  reason. If everyone fits, it says so.
- **Appointments** — a preview of the first 50 rows, in exactly the columns
  your export will have.
- **Export appointments** — downloads the spreadsheet, named
  `appointments_2026-09-01_1430.xlsx` (the date and time you generated it).

By default the export has these columns, sorted by date, then start time, then
coach:

| Column | Example |
|---|---|
| Student Name | Jane Doe |
| Contact SF ID (Student) | 0031t00000AbCdE |
| Student Email | jane.doe@example.com |
| Service Name | Coaching 1 - Meeting 1 |
| Coach Name | A. Coach |
| Coach SF ID | 005XX000001 |
| Coach Email | a.coach@example.com |
| Meeting Start Date & Time | 2026-09-16T12:00:00+01:00 |
| Meeting End Date & Time | 2026-09-16T13:00:00+01:00 |
| Meeting Status | Scheduled |

**Service Name** counts the meeting: a student's four appointments are
`Coaching 1 - Meeting 1` through `Coaching 1 - Meeting 4`. **Meeting Status**
is always `Scheduled`.

### About the meeting times

Both date/time columns are written in ISO 8601 with the campus's UTC offset,
e.g. `2026-09-16T12:00:00+01:00` for London, `2026-09-16T07:00:00-04:00` for
Boston, `2026-09-16T07:00:00+04:00` for Dubai.

The offset is worked out **per appointment**, not fixed per campus, because
the clocks change during a 15-week term: the UK leaves BST at the end of
October and the US leaves EDT at the start of November. So a student meeting
at 12:00 in London gets `+01:00` for their earlier meetings and `+00:00` for
their later ones. That is correct — the meeting is still at 12:00 local time
in both cases. Dubai does not observe daylight saving, so it is always
`+04:00`.

These two columns are stored as **text**, not as Excel dates. An Excel date
cannot carry a time zone, so storing one would throw the offset away and let
Excel re-display the time in whatever zone the reader's computer is set to.

The older columns — Meeting Number, Week Number, Date, Day, Start Time, End
Time, Duration — are still available in **Export settings** if you want them;
they are just switched off by default.

---

## 5. The two modes

### Auto-assign

Use this when you do not mind who coaches whom. The tool works out how many
students each coach should take, based on their FTE and how many usable hours
they have, then fills their diaries in order.

Students are taken from the top of the student list. If there are more students
than places, the ones at the bottom end up unassigned with the reason
*insufficient capacity*.

### Pre-allocated

Use this when the pairings are already decided. You supply the pairings file
and the tool simply books each student with the coach you named, using that
coach's free hours in the order the pairings file lists them.

Three things can go wrong here, and each is reported per student:

- a student in the student list who is not in the pairings file → *no pairing*
- a pairing naming a coach with no availability → *coach not found*
- more students pointed at one coach than that coach has room for →
  *coach over capacity*

You can switch modes at any time. Uploaded files stay where they are; the
pairings box appears and disappears with the mode.

---

## 6. FTE: sharing students between coaches

FTE is how you say "this coach is part-time". It only appears in auto-assign
mode, on the Review step, with one box per coach.

- The scale is 0.05 to 1.00. Everyone starts at **1.00** (full-time).
- Set a coach to 0.50 and they get roughly half the students of a full-time
  colleague.
- The split is proportional. With three coaches at 1.00, 1.00 and 0.50 and 50
  students, the shares are 20, 20 and 10.
- Nobody is given more students than they physically have room for. If a
  coach's quota would exceed their capacity, the surplus is passed to the
  coaches who still have space — again in FTE proportion.
- FTE values are remembered by coach name, so they are still there next time
  you open the tool.

Changing an FTE updates the quotas and the whole schedule straight away.

---

## 7. Changing the export columns

Open **Export settings** at the bottom of the Results step if the default
columns are not the shape you need — for example when the file has to match a
bulk-upload template.

You can:

- **Rename a column** — type a new heading. The data underneath is unchanged.
- **Reorder columns** — the ↑ and ↓ buttons move a column left or right in the
  output.
- **Leave a column out** — untick *Include*. The column keeps its settings, so
  you can tick it back on later.
- **Add a fixed column** — *Add constant column* creates a column with a
  heading and a single value repeated on every row, e.g. heading `Record Type`,
  value `Coaching`.
- **Reset to defaults** — puts the eleven standard columns back.

The preview table above always shows what you will actually get, and your
layout is remembered for next time.

---

## 8. Starting over

**Start over**, at the bottom left of every step, clears the files you have
uploaded and the schedule built from them. Your spreadsheets on disk are never
touched.

It asks first. In that dialog you can also tick **Also clear saved settings**,
which additionally forgets your term start date, mode, FTE values and export
column layout — a completely clean slate.

The only things kept between visits are those four settings. Student, coach and
class data is never saved anywhere.

---

## 9. Troubleshooting: every message the tool can show

### Messages about a file you uploaded

These appear inside that file's box on the Upload step, with the row number
where the problem is. Row 1 is the header row, so row 2 is the first row of
data — the numbers match what Excel shows you down the left-hand side.

| Message | What it means | What to do |
|---|---|---|
| **Missing required column "Coach Name".** | The header row does not have a column with that name. | Check the spelling of the heading in row 1. Capitals and extra spaces are forgiven; a missing or renamed column is not. Easiest fix: start again from the downloaded template. |
| **File contains no data rows.** | The file has headings but nothing under them, or every row was blank or started with `#`. | Add your data below the header row. |
| **Could not read this file. Make sure it is a valid .xlsx file saved from Excel.** | The file is not a spreadsheet the tool can open — often a `.csv` or `.xls` renamed, or a partly downloaded file. | Open it in Excel and use *Save As* → *Excel Workbook (.xlsx)*. |
| **Unknown day name "Funday".** | The Day cell is not a day of the week. | Use `Monday`…`Sunday` or the three-letter forms `Mon`…`Sun`. Watch for typos and trailing characters. |
| **Missing Day value.** | The Day cell is empty on a row that has other data. | Fill it in, or delete the row if it is a leftover. |
| **Could not understand Start Time "half nine". Use 24-hour HH:MM.** | The time is not readable. | Type `09:30`, not `9.30`, `half nine` or `9:30 am`. A real Excel time value works too. |
| **Could not understand End Time "…". Use 24-hour HH:MM.** | As above, for the end time. | Same fix. |
| **Missing Start Time value.** / **Missing End Time value.** | One of the time cells is empty. | Both times are needed on every row. |
| **End Time must be after Start Time.** | The row finishes before it starts — usually `13:00`–`12:00` typed the wrong way round, or an afternoon time written as `1:00`. | Put the later time in End Time, and remember it is a 24-hour clock: 1pm is `13:00`. |
| **Missing Coach Name value.** | A row in the availability or pairings file has no coach on it. | Add the name, or delete the row. Every availability row needs its coach, even repeat rows for the same person. |
| **Missing Contact SF ID value.** | A student or pairings row has no ID. | Add it. The ID, not the name, is how students are matched between files. |
| **Missing Student Name value.** | A student row has an ID but no name. | Add the name. |
| **"jane doe" is not a valid Student Email — expected an address like name@example.com.** | An email cell holds something that is not an address. | Correct it. Every export column is required, so the row is skipped until you do. |
| **Coach "A. Coach" has two different Coach Email values: … (row 4) and … (row 9).** | The same coach is listed with conflicting details on different availability rows. | Make them identical. The tool will not guess which one belongs in the export. |
| **Duplicate Contact SF ID "0031t…" appears in rows 5, 9.** | The same student appears more than once in the student list. | Delete the extra rows. All copies are ignored until you do, so the student will not be scheduled. |
| **The workbook has no sheets.** / **Sheet "…" could not be read.** | The file opened but there is nothing inside it. | Re-save it from Excel with your data on the first sheet. The tool always reads the first sheet. |

### Warnings about pairings

These appear in amber and do not stop anything — but they usually mean a
student will go unscheduled, so they are worth reading.

| Message | What it means | What to do |
|---|---|---|
| **Contact SF ID "…" does not appear in the student list.** | The pairings file mentions somebody who is not in the student list. | Either add them to the student list, or remove the pairing row. Until then that row does nothing. |
| **Coach Name "…" does not appear in the coach availability file.** | The pairings file names a coach who has no availability. | Check the spelling matches the availability file exactly, or add availability rows for that coach. Their students end up as *coach not found*. |

### Reasons a student was not scheduled

These show in the Unassigned students table on the Results step.

| Reason | What it means | What to do |
|---|---|---|
| **Insufficient capacity** | Auto-assign mode: every usable hour is full and this student did not fit. | Add coach availability, raise FTE values, or remove students. The Review step tells you exactly how many places you are short. |
| **No pairing** | Pre-allocated mode: this student is in the student list but not in the pairings file. | Add a row for them in the pairings file. |
| **Coach not found** | Their pairing names a coach with no availability. | Fix the spelling of the coach's name, or add their availability. |
| **Coach over capacity** | More students are paired to that coach than their free hours can hold (hours × 3). | Give the coach more availability, or move some students to another coach. |

### Messages about the tool itself

These appear as a banner at the top of the page and can be dismissed.

| Message | What it means | What to do |
|---|---|---|
| **The Excel library could not be loaded from the internet, so files cannot be read or exported.** | The tool downloads one small component the first time it opens, and that download failed — usually no connection, or a network that blocks it. | Reconnect and reload the page. If your network blocks it, ask IT to allow `cdn.sheetjs.com`. |
| **There is nothing to export yet.** | You pressed Export before the tool had everything it needs. | The message underneath says exactly what is missing — a file, a fix, or the start date. |
| **There is nothing to export: no student could be scheduled.** | The schedule came out empty. | Check the Unassigned students table for the reason. |
| **All columns are excluded. Include at least one in Export settings.** | Every export column has been unticked, so there is nothing to write. This one appears in the Appointments table, and the Export button is greyed out until you fix it. | Tick at least one column, or press *Reset to defaults*. |
| **This setting could not be saved for next time…** | The browser is refusing to store settings — usually private browsing, or storage turned off. | Nothing is broken; the tool works normally, it just will not remember your settings after a reload. |
| **Saved settings could not be read…** / **The saved export layout could not be read…** | Stored settings were unreadable, so defaults were used. | Nothing to do. *Start over* with *Also clear saved settings* ticked removes the leftovers for good. |
| **Something went wrong while …** | Something unexpected failed, named after what it was doing. The technical detail is on the second line. | Reload the page and try again. If it keeps happening, note the message — it says exactly which action failed. |
| **This tool needs JavaScript…** | JavaScript is switched off in your browser. | Turn it back on for this page and reload. |

---

## Not included yet

Blocked weeks and dates — marking a coach as away for a week or a specific day
and having their meetings automatically moved elsewhere in the same block — is
specified but not built yet.

Also out of scope: more than one class timetable per run, per-student
availability, more than one campus per run, public holidays, and editing
individual appointments after they are generated.

---

## For developers

`SPEC.md` is the technical specification, `DESIGN.md` the visual system, and
`BUILD_GUIDE.md` describes how the project is assembled session by session.
The app is plain HTML, CSS and JavaScript modules with no build step: open
`index.html` to run it, and `tests.html` to run the scheduling engine's tests
in the browser.
