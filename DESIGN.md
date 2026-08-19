# DESIGN.md — Term Scheduler visual system (v1)

Normative for all UI work. `mockup.html` in the repo root is the visual reference; where prose and mockup disagree, this file wins. This is an internal admin tool used on laptops by scheduling staff: density, legibility, and state clarity over spectacle.

## 1. Design tokens (define as CSS custom properties in styles.css)

### Colour

Pastel system, print-inspired (risograph/stationery register): pastels appear only as **fills and tints**; text and interactive strokes always use the deep companion tones, so AA contrast holds everywhere. The four term blocks each own a pastel — block membership is the tool's core structural concept, so the palette encodes it rather than decorating.

| Token | Value | Use |
|---|---|---|
| `--paper` | `#F4F5F2` | Page background (chalk white, cool cast) |
| `--surface` | `#FFFFFF` | Cards, panels, tables |
| `--ink` | `#20242C` | Primary text |
| `--ink-2` | `#626A76` | Secondary text, labels |
| `--line` | `#E1E2DA` | Borders, dividers |
| `--action` | `#1D5C57` | The single interactive colour (deep teal — deliberately outside the four block hues): primary buttons (white text), links, focus rings, active step, selected controls |
| `--ok-tint` | `#DCEBE7` | Success/scheduled chip fill (text: `--action`) |
| `--b1` / `--b1-deep` | `#D8E4F0` / `#31506F` | Block 1 fill / text-on-fill (powder blue) |
| `--b2` / `--b2-deep` | `#E3DFF0` / `#4A4173` | Block 2 fill / text-on-fill (lavender) |
| `--b3` / `--b3-deep` | `#F3EAC9` / `#6E5A1E` | Block 3 fill / text-on-fill (butter) |
| `--b4` / `--b4-deep` | `#DDEAD3` / `#3D5C33` | Block 4 fill / text-on-fill (pistachio) |
| `--warn` / `--warn-tint` | `#8A5A1D` / `#F7E3CE` | Warnings (apricot) |
| `--err` / `--err-tint` | `#9E3B36` / `#F3DBDA` | Errors, exceptions, blocked weeks (rose) |
| `--dead` | `#ECEDE7` | Excluded weeks 4/8/12 (with hatch, §3.1) |

Rules: pastel fills never carry white or pastel text — always the paired `-deep` tone or `--ink`. `--action` is the only colour that signals "clickable/selected" and must never equal any block's `-deep` tone; block hues signal *which block*, never interactivity. Week numbers rendered anywhere in the app (ribbon, tables, chips, "moved from wk N") take their block's fill+deep pair, so block membership is legible at a glance. Success/confirmed states use `--ok-tint` fill with `--action` text. No gradients; shadows stay at `0 1px 2px rgb(32 36 44 / 6%)`. Claude Code must verify every fill/text pair used at ≤14px passes WCAG AA and darken the `-deep` tone if not.

### Typography
- **UI/headings:** Schibsted Grotesk (Google Fonts), weights 400/500/700.
- **Data:** Spline Sans Mono (Google Fonts), weights 400/500 — all SF IDs, times, dates, week numbers, counts, FTE values, filenames.
- Scale (px/line-height): 26/32 page title (w700, letter-spacing −0.01em) · 17/24 section heading (w700) · 14/22 body (w400) · 13/18 labels & table headers (w500, uppercase table headers with 0.04em tracking) · 13/18 mono data.
- No italics. Emphasis by weight only.

### Space, shape, motion
- 4px spacing grid; component padding 12/16/24.
- Radius: 6px controls and chips, 10px cards. Nothing pill-shaped except chips.
- Motion: 150ms `ease-out` on background/border/colour only. No entrance animations, no parallax. Respect `prefers-reduced-motion` by disabling all transitions.
- Focus: 2px solid `--action` outline with 2px offset on every interactive element. Keyboard-complete.

## 2. Layout

Fixed left rail (240px) + main column (max 1080px, 32px padding).

- **Left rail:** wordmark "Term Scheduler" (Schibsted 17/w700), the four steps as a vertical list — number in mono, label in UI face; states: done (`--action` check, `--ink-2` label), active (`--action` left bar 3px + w700), upcoming (`--ink-2`). Bottom-pinned note in 12px `--ink-2`: "Runs in your browser. Files are never uploaded to a server."
- **Main column:** page title, one-line description in `--ink-2`, then the term ribbon (§3.1), then content cards.

## 3. Components

### 3.1 Term ribbon (signature element — build once, reuse everywhere)
A horizontal strip of the 15 term weeks grouped into the four blocks, always in this structure: `[1 2 3] [4] [5 6 7] [8] [9 10 11] [12] [13 14 15]` with 8px gaps between groups and block labels ("Block 1"…"Block 4") in 11px `--ink-2` above each group.
- Week cell: 40×40px (min), `--surface`, 1px `--line`, week number in mono 13/w500, radius 6px.
- Excluded weeks 4/8/12: 28px wide, `--dead` fill with a 45° hatch (repeating-linear-gradient, `--line` at 20% alpha), number struck through in `--ink-2`, `title="No meetings — excluded week"`.
- Default state: each week cell takes its **block's pastel fill** with the paired `-deep` tone for the number and a `--line` border; block labels use the `-deep` tone. State variants: **blocked (coach view, §11)** = `--err-tint` fill, `--err` border and number, diagonal strike; **has-exceptions** = `--warn` dot top-right; in the interactive blocking grid, unblocked cells show their block pastel and hover raises the border to the `-deep` tone.
- On Review it is display-only context; in the blocking panel it becomes the interactive grid (§3.6).

### 3.2 Cards
`--surface`, 1px `--line`, radius 10px, 24px padding, 17px heading + optional one-line description. No card nesting.

### 3.3 Tables
Full-width, `--surface`. Header row: 13px uppercase `--ink-2`, bottom border `--line`. Rows 44px, zebra off, row divider `--line` at 50% alpha. All numeric/ID/time cells in mono, right-aligned for pure numbers. Sticky header when the table scrolls. Empty state: single centred line in `--ink-2` saying what to do, e.g. "Upload the three files to see capacity."

### 3.4 Controls
- **Primary button:** `--action` fill, white text, 14/w500, 10px×16px padding. One per screen maximum ("Continue", "Export appointments").
- **Secondary:** `--surface`, 1px `--line`, `--ink` text. **Destructive:** secondary style with `--err` text ("Clear all uploads", "Remove").
- Inputs 36px tall, 1px `--line`, focus border `--action`; FTE inputs are mono, width 72px, step 0.05.
- Mode toggle: a segmented control, active segment `--b1` fill + `--action` text; never a switch (the modes are peers, not on/off). It carries three segments since v1.12 — auto-assign, pre-allocated and modify existing (SPEC §19) — and the third reads as a peer of the other two, not as an option hung off one of them.
- File drop zones: dashed 1.5px `--line`, 96px tall, icon-free; on success collapse to a compact row — filename (mono) + row count + green check + "Replace".

### 3.5 Status language
Chips (12px, radius 6px): `--b1`/`--action` "Scheduled", `--warn-tint`/`--warn` "Warning", `--err-tint`/`--err` "Exception"; week-number chips take their block's pair. Validation errors render as an `--err-tint` bordered list inside the file's card: one line per error, mono for row numbers — "Row 14 — End Time (13:00) is before Start Time (14:00)". Errors state the fix, never apologise.

### 3.6 Blocking panel (Session 7)
Opens as a right-side sheet (420px, `--surface`, `--line` left border), not a modal: coach select at top, then the term ribbon rendered as one interactive row per §3.1 states, a date input beneath for single-date blocks, and a list of current blocks with Remove. Clicking a week cell toggles it. Sheet never covers the results table entirely. The select's first entry is "All coaches" (SPEC §11.2); a week one coach inherits from an all-coaches block keeps the blocked treatment but takes a dashed border and a flat `--surface` fill, so an inherited week reads as *not yours to toggle* without inventing a second colour.

### 3.7 Existing bookings (SPEC §19)

In modify-existing mode the coach grid shows the previous run's bookings in the
cells they hold. They take `--dead` with a dashed border — the same "not yours
to act on" treatment §3.1 gives an excluded week and §3.6 gives an inherited
block — and they are rendered as plain list items, not buttons, so keyboard
focus never lands on something that cannot be acted on. The meta line ends with
the word "existing", so the state is never carried by fill alone (§5). Flags
raised against the uploaded schedule are `--warn-tint` chips in a table inside
the **Existing schedule** card: one row per flag, naming the student, the coach
and the time, because each one is a thing for the user to check rather than
something the tool has already put right.

## 4. Copy rules
Sentence case everywhere. Buttons name the action's result: "Export appointments", not "Submit". The week-normalisation notice reads: "Week 1 will start Monday 7 September (moved from your selected date)." Counts are sentences, not dashboards: "62 of 64 students scheduled · 2 exceptions". No exclamation marks, no "Oops".

## 5. Quality floor
Responsive down to 1024px (rail collapses to a top bar below that; phone layout out of scope). WCAG AA contrast throughout (all token pairs above pass on their specified backgrounds). Visible focus everywhere. `prefers-reduced-motion` respected. No layout shift on data load — reserve table space with min-heights.
