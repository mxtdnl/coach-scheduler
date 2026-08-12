# Term Scheduler — user guide

Term Scheduler builds a term's worth of coaching meetings for you. You give it
four things — the class timetables, when each coach is free, who the students
are, and (optionally) who coaches whom — and it hands back a spreadsheet with
one row per meeting, ready to upload or share. In auto-assign mode you also get
a second file: a batch upload with **one row per student and the coach they
were given** — see [section 7](#7-the-export-files).

A run can cover several classes at once. Each class's timetable is a **class
block**, every student belongs to exactly one of them, and a student's coaching
meetings only ever have to dodge their own block's classes — see
[section 3](#class-schedule).

Once the schedule exists you can read it back from either side on the Results
step: pick a coach to see the students they are meeting and when, or pick a
student to see their classes, their coaching meetings and who their coach is.
A selected coach's meetings can also be downloaded as calendar files — see
[section 7.4](#74-the-coach-calendar-download-zip-of-ics-files).

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
7. [The export files](#7-the-export-files)
8. [Blocked weeks and dates](#8-blocked-weeks-and-dates)
9. [Starting over](#9-starting-over)
10. [Troubleshooting: every message the tool can show](#10-troubleshooting-every-message-the-tool-can-show)

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
date, the day, and the times. In auto-assign mode there is a **second** file
too, the coach assignments batch upload: one row per student saying which coach
they ended up with ([section 7](#7-the-export-files)).

You can also look the finished schedule up meeting by meeting — by coach or by
student — and download one coach's meetings as calendar files
([section 4](#bookings-look-the-schedule-up-by-coach-or-by-student)).

What it does **not** do: it does not send invitations, book rooms, email
anybody, or know about public holidays. It is a planner, not a calendar — the
calendar files it writes are files you import yourself.

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

**A meeting must not overlap a class in the student's own class block.**
Touching is fine — a class ending at 10:00 and a meeting starting at 10:00 is
allowed. A class belonging to a *different* class block does not get in this
student's way at all: if Block A is in class at 11:00 and Block B is not, 11:00
is still a perfectly good coaching hour for a Block B student, and vice versa.

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

Every class timetable in the run goes in this one file, one row per class. The
**Class Block** column says which class each row belongs to.

| Column | Required? | What goes in it |
|---|---|---|
| Class Block | Yes | The name of the class this row belongs to, e.g. `Block A`. Spell it the same way on every row of that block and in the student list. Capitals and stray spaces are forgiven; anything else is a different block. One name per cell — `Block A, Block B` is rejected. |
| Day | Yes | `Monday` to `Sunday`. Capitals do not matter, and `Mon`, `Tue`, `Wed`, `Thu`, `Fri`, `Sat`, `Sun` also work. |
| Start Time | Yes | When the class starts, e.g. `09:00`. |
| End Time | Yes | When it ends. Must be later than the start. |
| Class Name | No | A label for your own benefit, e.g. `Marketing Fundamentals`. Not used in the schedule. |

#### Class blocks and the 15-hour rule

A **class block** is one group of students' complete class timetable. You can
have as many as you like in a run — one per cohort — and they can teach the
same hours as each other without any trouble.

**Every class block must add up to exactly 15 hours.** That is 15 hours for the
timetable as a whole, not 15 hours a week. Five 3-hour classes make a block;
so do ten 90-minute ones. If a block comes to anything else the file is
rejected with a message naming the block and the total it actually came to,
for example:

> Class block "Block A" totals 12 hours across 4 classes — 3 hours short of
> the required 15 hours. Adjust the class times for this block.

Two classes in the *same* block may not overlap each other — that would count
the same hour twice and make the 15-hour total meaningless. Two classes in
*different* blocks may sit on the same hour; that is the normal case.

The Review step shows every block, its hours, how many students are in it, and
how many coaching slots it can use, so you can check all of this at a glance
before you build the schedule.

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
| Class Block | Yes | Which class block this student is in, spelled as in the class schedule. Exactly one — a blank cell, or two names in one cell, is an error, and a name the class schedule does not contain leaves the student unscheduled. Nothing is ever assumed. |

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

Above either table sits **Class blocks**: one row per class block, with its
number of classes, its total hours (a green chip when it is exactly 15, a red
one when it is not), how many students are in it, and how many of the run's
coaching slots that block can actually use. That last figure is the answer to
"why is this hour not available to this student?" — a slot the block's own
classes cover is not on offer to its students, but stays on offer to everybody
else.

Underneath, a **Warnings** panel collects anything that is odd but not fatal —
usually pairings pointing at people the tool cannot find.

If capacity is lower than the number of students, an amber banner says so and
by how much, before you get as far as the results.

### Step 4 — Results

- A one-line summary: how many students were scheduled, how many appointments
  that makes, and how many students could not be placed.
- **Coach utilisation** — how full each coach's diary ended up.
- **Class blocks** — how each class block fared: hours, students, how many were
  scheduled, and how many slots the block can use. Students whose class block
  is missing or unknown are listed on their own row and are never counted into
  a block.
- **Unassigned students and exceptions** — anybody who could not be scheduled,
  with their class block and the reason, plus any single meeting that could not be moved around a
  blocked week or date (see [section 8](#8-blocked-weeks-and-dates)). If
  everyone fits, it says so.
- **Appointments** — a preview of the first 50 rows, in exactly the columns
  your export will have.
- **Export appointments** — downloads the spreadsheet, named
  `appointments_2026-09-01_1430.xlsx` (the date and time you generated it).
- **Bookings** — look the schedule up by coach or by student, and download a
  coach's calendar (see below).
- **Coach assignments** (auto-assign only) — a second card with its own
  **Export coach assignments** button, giving one row per student and the coach
  they were assigned. It is a different file from the appointments export; see
  [section 7](#7-the-export-files).

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
| Rescheduled From Week | 5 |

**Rescheduled From Week** is blank unless the meeting was moved out of a
blocked week or date ([section 8](#8-blocked-weeks-and-dates)), in which case
it holds the week it moved from.

**Service Name** counts the meeting: a student's four appointments are
`Coaching 1 - Meeting 1` through `Coaching 1 - Meeting 4`. **Meeting Status**
is always `Scheduled`.


### Bookings: look the schedule up by coach or by student

The **Bookings** card near the bottom of the Results step answers the two
questions the big appointments table is bad at: *who is this coach meeting?*
and *what does this student's term actually look like?* It only reads the
schedule — nothing here changes it, and nothing is listed until you choose
somebody.

Use the **By coach** / **By student** toggle to switch sides. Both work from
the keyboard: tab to the toggle, use the arrow keys to switch, tab on to the
selector.

**To look up a coach**

1. Choose **By coach**.
2. Pick a name from the **Coach** list. Every coach in your availability file
   is there, including any who ended up with no students.

You get every meeting that coach has, oldest first: date, day, start and end
time, the student (with their Contact SF ID), the student's class block, the
meeting number, the service name, and the term week. A meeting that was moved
out of a blocked week is marked *Moved from week N*. Above the table:
"5 students · 20 coaching appointments".

If the coach has no meetings, the card says so rather than showing an empty
table.

**To look up a student**

1. Choose **By student**.
2. Type part of a name or a Contact SF ID in **Search students** — the
   **Student** list narrows as you type.
3. Pick the student.

You get one line summarising who they are: their coach, their class block, how
many class sessions and how many coaching meetings. Below it is their whole
term in date order, classes and coaching together, each row labelled **Class**
or **Coaching**. Only their **own** class block's classes are shown; another
cohort's timetable is nothing to do with them.

Students who could not be scheduled are still in the list. You see their
classes, no coaching meetings (none were invented), and the reason they were
left out — the same reason as in the Unassigned table. A student whose class
block is not in the class schedule has no classes to show either, and the card
says that plainly.

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
they are just switched off by default. So is **Class Block**, which puts each
student's class block on every row of their four meetings.

---

## 5. The two modes

### Auto-assign

Use this when you do not mind who coaches whom. The tool works out how many
students each coach should take, based on their FTE and how many usable hours
they have, then fills their diaries in order.

Students are taken from the top of the student list. Each one takes the first
free hour that their own class block leaves open, so two students in different
blocks can end up in hours the other could not use. If there are more students
than places, the ones at the bottom end up unassigned with the reason
*insufficient capacity*; a student for whom only class-time hours are left is
told that instead (*no free slot outside their class block*).

A coach never loses capacity because one class block happens to be in class at
that time — the hour simply goes to a student from another block.

### Pre-allocated

Use this when the pairings are already decided. You supply the pairings file
and the tool simply books each student with the coach you named, using that
coach's free hours in the order the pairings file lists them.

Three things can go wrong here, and each is reported per student:

- a student in the student list who is not in the pairings file → *no pairing*
- a pairing naming a coach with no availability → *coach not found*
- more students pointed at one coach than that coach has room for →
  *coach over capacity*
- a student whose coach only has hours left that clash with their own class
  block → *no free slot outside their class block*

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

## 7. The export files

A run gives you **one or two** spreadsheets, depending on the mode, plus a
per-coach calendar archive whenever you want one:

| File | When | What is in it |
|---|---|---|
| `appointments_2026-09-01_1430.xlsx` | always | One row per **meeting** — four rows per scheduled student |
| `coach_assignments_2026-09-01_1430.xlsx` | auto-assign only | One row per **student**, naming the coach they were assigned |
| `ada-lovelace_calendar_2026-09-01_1430.zip` | when you ask for it, per coach | One `.ics` calendar file per **meeting** for that one coach |

They are separate downloads with separate buttons; none replaces the other.

### 7.1 The appointments export

Press **Export appointments** in the Results step. This is the file described
in [section 4](#step-4--results), and you can reshape its columns — see
[7.3](#73-changing-the-appointment-export-columns).

### 7.2 The coach assignments export (auto-assign only)

At the bottom of the Results step, the **Coach assignments** card shows exactly
what this file will contain, with an **Export coach assignments** button beside
it. It downloads `coach_assignments_2026-09-01_1430.xlsx` (the date and time
you generated it).

This file is a batch-upload template for Salesforce, and it is about
**assignments, not meetings**: a student with four coaching meetings gets
**one** row here, not four. It has seven columns, always these, always in this
order:

| Column | What it holds |
|---|---|
| Student Name | The student's name, as in your student list |
| Record Type | Always `0121Q000001Dw6tQAC` — the Salesforce record type id |
| Record Type Name | Always `Institutional Relations` |
| Type | Always `coach` |
| Coach Name | The coach the tool assigned to that student |
| Coach User ID | That coach's **Coach SF ID** — the value already in your coach availability file |
| Status | Always `current` |

**Coach User ID needs no new input.** It is the same Salesforce identifier as
the **Coach SF ID** you already fill in on the coach availability template —
only the heading differs, because that is what the batch upload calls it. There
is no extra column to add and no extra file to prepare.

A few things worth knowing:

- **Students who could not be scheduled are left out.** If somebody is in the
  Unassigned table, they have no coach, so they get no row.
- **A student whose meeting was moved or lost to a blocked week still appears.**
  Blocking never changes who a student's coach is, so the assignment still
  stands; only one of their four meetings is missing from the appointments
  file.
- **Every student appears at most once.** No duplicates.
- **The same list, every time.** Same inputs, same file, in the same order.
- **Your custom appointment columns do not touch it.** The seven columns are
  fixed, because the system receiving the file expects exactly them.
- **It only appears in auto-assign mode.** In pre-allocated mode you told the
  tool who coaches whom, so the card is not shown at all.
- **A coach with no Coach SF ID stops the export.** Rather than send a blank
  Coach User ID, the button is greyed out and the card names the coach who
  needs an ID. (The upload step normally catches this first: a blank Coach SF
  ID is a row error on the availability file.)


### 7.3 Changing the appointment export columns

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
layout is remembered for next time. These settings apply to the **appointments**
file only — the coach assignments file keeps its seven fixed columns whatever
you do here.

### 7.4 The coach calendar download (.zip of .ics files)

In the **Bookings** card, with **By coach** selected and a coach chosen, press
**Export coach calendar (.zip)**. It downloads
`ada-lovelace_calendar_2026-09-01_1430.zip` — the coach's name, then the date
and time you generated it.

**What is in the ZIP.** One `.ics` calendar file for **every meeting that coach
actually has** in the generated schedule — a coach with 20 meetings gets 20
files, not one file with 20 events. Each file is named for the meeting it
holds, so they sort by date:

```
2026-09-07_0900_jane-doe_meeting-1.ics
2026-09-07_0930_tom-baker_meeting-1.ics
2026-09-09_1300_amara-okafor_meeting-1.ics
```

Open one and you get a single calendar event with:

- **Title** — the student's name and which of the four meetings it is, e.g.
  `Jane Doe — Coaching 1 - Meeting 2`.
- **Start and end** — exactly the times in the appointments export, in the
  campus's time zone. They are written in UTC, which is what makes them
  unambiguous either side of the clocks changing; your calendar shows them back
  in local time.
- **Location** — the campus you chose on the Setup step.
- **Description** — the student's email and Contact SF ID, their class block,
  the coach, the term week, and a note if the meeting was moved out of a
  blocked week.

You can drag the files into Outlook, Google Calendar, Apple Calendar or
anything else that reads `.ics`. Re-exporting the same schedule produces the
same files with the same identifiers, so importing again updates the entries
rather than creating a second copy of each.

A few things worth knowing:

- **Only the selected coach.** Nobody else's meetings are in the archive.
- **Only real meetings.** Unassigned students contribute nothing, and a meeting
  that had to be dropped because of a blocked week is not in the file either —
  because it is not in the schedule. A meeting that was *moved* appears once,
  on its new date.
- **A coach with nothing booked cannot export.** The button stays greyed out
  and the card says why.
- **It changes nothing.** The download is a read-only view of the results; your
  schedule and your other exports are untouched.

---

## 8. Blocked weeks and dates

When a coach is away — annual leave, a conference, a single day off — mark it
and the tool moves their meetings for you.

On the **Review** step, press **Blocked weeks/dates**. A panel opens on the
right:

- Choose the **coach**.
- Click a week in the ribbon to block or unblock it, or type a **week number**
  (1–15) and press *Add week*.
- Or pick a **date** and press *Add date*. The date must fall inside the term;
  it is stored as that coach's weekday in that week, so only meetings on that
  day move.
- **Current blocks** lists everything blocked, for every coach, each with a
  *Remove* button. **Clear all blocks** empties the list.

Weeks 4, 8 and 12 never hold meetings, so blocking one does nothing — the panel
says so and does not add it.

### What happens to a blocked meeting

Only the meetings in the blocked week or on the blocked date move, and they
always stay with the same coach and inside the same block of the term (weeks
1–3, 5–7, 9–11, or 13–15). The tool tries, in order:

1. **The same day and time in another week of that block**, earliest week
   first — the smallest possible change for the student.
2. **Any other free hour of that coach in that block**, taking the earliest
   week first, then the coach's hours in their usual order.
3. If the block is genuinely full, that one meeting becomes an **exception**.
   The student's other three meetings are untouched.

Moved meetings show the week they came from in the **Rescheduled From Week**
export column, which is blank for every meeting that stayed put. Exceptions are
listed on the Results step, one row per meeting, with the reason
*no free slot in block N — coach blocked*.

Blocks are saved in your browser with the other settings, and the schedule is
rebuilt the moment you add or remove one.

---

## 9. Starting over

**Start over**, at the bottom left of every step, clears the files you have
uploaded and the schedule built from them. Your spreadsheets on disk are never
touched.

It asks first. In that dialog you can also tick **Also clear saved settings**,
which additionally forgets your term start date, mode, FTE values, blocked
weeks and dates, and export column layout — a completely clean slate.

Those settings are the only things kept between visits. Student, coach and
class data is never saved anywhere.

---

## 10. Troubleshooting: every message the tool can show

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
| **Missing Class Block value.** | A class row or a student row has no class block on it. | Fill it in. Every class belongs to a block, and every student belongs to exactly one — the tool never guesses. |
| **"Block A, Block B" names more than one class block.** | One cell holds two block names. | Put a single block name in the cell. A student belongs to exactly one class block, and a class row belongs to exactly one too. |
| **Class block "Block A" totals 12 hours across 4 classes — 3 hours short of the required 15 hours.** | The class rows for that block do not add up to 15 hours in total (not per week). | Add, remove or lengthen classes in that block until it comes to exactly 15 hours. Other blocks are unaffected. |
| **Class block "Block A" has two overlapping classes on Monday: 09:00–12:00 (row 3) and 11:00–13:00 (row 4).** | Two classes in the same block clash, which would count the same hour twice in its 15-hour total. | Correct one of the two rows. Classes in *different* blocks may overlap freely. |
| **The workbook has no sheets.** / **Sheet "…" could not be read.** | The file opened but there is nothing inside it. | Re-save it from Excel with your data on the first sheet. The tool always reads the first sheet. |

### Warnings about pairings

These appear in amber and do not stop anything — but they usually mean a
student will go unscheduled, so they are worth reading.

| Message | What it means | What to do |
|---|---|---|
| **Contact SF ID "…" does not appear in the student list.** | The pairings file mentions somebody who is not in the student list. | Either add them to the student list, or remove the pairing row. Until then that row does nothing. |
| **Coach Name "…" does not appear in the coach availability file.** | The pairings file names a coach who has no availability. | Check the spelling matches the availability file exactly, or add availability rows for that coach. Their students end up as *coach not found*. |
| **Class block "Block Z" is not in the class schedule, so this student cannot be scheduled. Known class blocks: Block A, Block B.** | A student names a class block the class schedule does not define. | Fix the spelling in the student list, or add that block's classes to the class schedule. Until then the student is left unscheduled as *class block not found*. |

### Reasons a student was not scheduled

These show in the Unassigned students and exceptions table on the Results step.

| Reason | What it means | What to do |
|---|---|---|
| **Insufficient capacity** | Auto-assign mode: every usable hour is full and this student did not fit. | Add coach availability, raise FTE values, or remove students. The Review step tells you exactly how many places you are short. |
| **No pairing** | Pre-allocated mode: this student is in the student list but not in the pairings file. | Add a row for them in the pairings file. |
| **Coach not found** | Their pairing names a coach with no availability. | Fix the spelling of the coach's name, or add their availability. |
| **Coach over capacity** | More students are paired to that coach than their free hours can hold (hours × 3). | Give the coach more availability, or move some students to another coach. |
| **No free slot outside their class block** | Every place left is during one of this student's own classes, even though places remain for students in other blocks. | Add coach availability outside that block's class hours, or check the block's timetable is right. |
| **Class block not found** | The student names a class block that is not in the class schedule. | Correct the spelling in the student list, or add that block to the class schedule. |
| **No class block** | The student reached the scheduler without a class block. | Fill in the Class Block column for that student. |
| **No free slot in block N — coach blocked** | One meeting, not a whole student: the coach is blocked that week or date and every other hour of theirs in that block of the term is already taken. | Unblock a week, or give the coach another free hour inside weeks 1–3, 5–7, 9–11 or 13–15 as appropriate. The student's other three meetings are unaffected. |

### Messages about the tool itself

These appear as a banner at the top of the page and can be dismissed.

| Message | What it means | What to do |
|---|---|---|
| **The Excel library could not be loaded from the internet, so files cannot be read or exported.** | The tool downloads one small component the first time it opens, and that download failed — usually no connection, or a network that blocks it. | Reconnect and reload the page. If your network blocks it, ask IT to allow `cdn.sheetjs.com`. |
| **There is nothing to export yet.** | You pressed Export before the tool had everything it needs. | The message underneath says exactly what is missing — a file, a fix, or the start date. |
| **There is nothing to export: no student could be scheduled.** | The schedule came out empty. | Check the Unassigned students table for the reason. |
| **There is nothing to export: no student was assigned a coach.** | You pressed *Export coach assignments* on a run where nobody was scheduled. | Check the Unassigned students table for the reason. |
| **The coach assignments export needs a Coach SF ID for every assigned coach.** | A coach in the schedule has no Coach SF ID, so their Coach User ID would be blank. | The message names the coach. Put their Coach SF ID in the coach availability file and upload it again. |
| **The coach assignments export is only available in auto-assign mode.** | The second export does not apply in pre-allocated mode, where you supplied the pairings yourself. | Nothing to do — the appointments export still works as usual. |
| **Choose a coach before exporting a calendar.** | You pressed *Export coach calendar (.zip)* with no coach chosen in the Bookings card. | Pick a coach from the list; the button stays greyed out until you do. |
| **&lt;Coach&gt; has no scheduled meetings, so there is nothing to export.** | The coach you chose ended up with no meetings, so there would be nothing to put in the ZIP. | Choose a coach who has meetings, or check the Unassigned students table to see why this one has none. |
| **All columns are excluded. Include at least one in Export settings.** | Every export column has been unticked, so there is nothing to write. This one appears in the Appointments table, and the Export button is greyed out until you fix it. | Tick at least one column, or press *Reset to defaults*. |
| **This setting could not be saved for next time…** | The browser is refusing to store settings — usually private browsing, or storage turned off. | Nothing is broken; the tool works normally, it just will not remember your settings after a reload. |
| **Saved settings could not be read…** / **The saved export layout could not be read…** | Stored settings were unreadable, so defaults were used. | Nothing to do. *Start over* with *Also clear saved settings* ticked removes the leftovers for good. |
| **Something went wrong while …** | Something unexpected failed, named after what it was doing. The technical detail is on the second line. | Reload the page and try again. If it keeps happening, note the message — it says exactly which action failed. |
| **This tool needs JavaScript…** | JavaScript is switched off in your browser. | Turn it back on for this page and reload. |

---

## Not included yet

Out of scope: per-student class timetables (students belong to a class block),
per-student coaching availability, more than one campus per run, public
holidays, and editing individual appointments after they are generated. The
Results step lets you *inspect* the schedule meeting by meeting
([section 4](#bookings-look-the-schedule-up-by-coach-or-by-student)) and export
a coach's meetings as calendar files, but it never edits one.

---

## For developers

`SPEC.md` is the technical specification, `DESIGN.md` the visual system, and
`BUILD_GUIDE.md` describes how the project is assembled session by session.
The app is plain HTML, CSS and JavaScript modules with no build step: open
`index.html` to run it, and `tests.html` to run the scheduling engine's tests
in the browser.
