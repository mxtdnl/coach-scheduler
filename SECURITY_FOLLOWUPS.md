# Security follow-ups

Open items from the adversarial security review of 2026-08-12. The one critical
finding from that review is already fixed and on `main` (PR #13); everything
below is still open.

Each item says what the problem is, why it was left rather than fixed in that
PR, and what a fix would involve. Items 2 and 3 are small and uncontroversial.
Item 1 is the one that needs a human decision, and it is also the one with the
largest blast radius.

## Threat model, in one paragraph

The app has no backend, no accounts, and no network I/O except a single CDN
script. So the attackers worth designing against are: **whoever supplies the
`.xlsx` files** — class schedules and student lists routinely arrive by email
from outside the team, and every cell is treated as trusted display data;
**whoever can influence the SheetJS CDN**; and **whoever can write to the origin
the app is hosted on**. The asset at risk is student PII — names, email
addresses and Salesforce contact IDs — held in memory and rendered on screen.
"It runs in the browser" limits the damage from a compromise; it does not
prevent one, because the page can still read every uploaded row and reach the
network.

---

## 1. The SheetJS script is unpinned and unverified — high

`index.html:11` (and `tests.html:10`) load:

```html
<script src="https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js"></script>
```

No `integrity` attribute, no version pin, and no Content-Security-Policy
anywhere in the repo.

`xlsx-latest` is a mutable pointer. The bytes that execute in a user's browser
can change without a commit here, without a review, and without a release note.
That script has full access to the DOM, to `localStorage`, and to every parsed
spreadsheet. A compromised or swapped build could read the entire student list
and post it anywhere, and nothing in the app would stop it or show a trace. The
absence of a CSP means there is no second line of defence: any script that
manages to run can also reach any origin it likes.

This is not a hypothetical class of attack — CDN and package-registry
compromises are among the most common ways front-end applications leak data, and
this app handles exactly the kind of data such an attack is worth mounting for.

**Why it was not fixed in PR #13.** Every option changes runtime behaviour, and
one of them changes a documented decision. `SPEC.md:14` names `xlsx-latest` as
the intended dependency, so a pin is a spec change, not just a code change. And
if the pinned version regresses, uploads and exports break for everyone at once
— that is a release-management tradeoff for a maintainer to accept, not a
silent hardening commit.

**Options, roughly in order of preference.**

1. **Self-host the library.** Vendor `xlsx.full.min.js` into the repo, load it
   from the same origin, and drop the CDN entirely. This removes the external
   dependency, makes the "runs in your browser, files are never uploaded" claim
   in the rail note (`index.html:52`) literally true, and makes the app work
   offline — which matters, because the current failure mode on a blocked
   network is that nothing works at all. Cost: the library is a few hundred KB
   in the repo, and upgrades become a manual, reviewable commit. That last part
   is a feature.
2. **Pin a version and add SRI.** Replace `xlsx-latest` with a concrete version
   and add the matching `integrity` and `crossorigin="anonymous"` attributes.
   Keeps the CDN's caching and bandwidth. Cost: upgrades need the hash
   regenerated, and a CDN outage still breaks the app.

Either way, **also add a CSP**. `SPEC.md` §2 pins hosting to GitHub Pages
deploy-from-branch, which cannot set custom response headers — so this has to be
a `<meta http-equiv>` in `index.html`. Worth knowing what that costs: `meta`
cannot express `frame-ancestors`, so clickjacking stays unaddressed until the
app moves somewhere that can send headers. Everything below works in `meta`:

```
default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:;
connect-src 'none'; object-src 'none'; base-uri 'none'
```

Add `https://cdn.sheetjs.com` to `script-src` if option 2 is chosen instead of
option 1. Note `connect-src 'none'` — the app makes no XHR/fetch calls at all,
so this is free to set and it is the single most valuable directive here: it is
what turns "an injected script ran" into "an injected script ran and could not
send anything anywhere".

**Files to touch:** `index.html:11`, `tests.html:10`, `SPEC.md:14`, and the
troubleshooting row at `README.md:702` (which tells users to ask IT to allow
`cdn.sheetjs.com` — wrong advice once self-hosted).

## 2. A coach named `__proto__` breaks the Review page — low

`js/app.js:1095` does `eng.fte[c].toFixed(2)`, where `fte` is a plain object
keyed by coach name (`js/app.js:956`). Assigning a *number* to `__proto__` on a
plain object is silently ignored, so the read returns `Object.prototype`, which
has no `toFixed` — a `TypeError`, caught by `guard`, leaving the Review step
unrendered with a generic error.

The same shape appears in `slotCounts` (`js/app.js:939`), `capacity`
(`:947`), and `scheduledByCoach` (`:985`), and `storage.js` persists the FTE map
through `JSON.parse`, so the bad key can survive a reload.

**This is not prototype pollution.** Every write into these maps is a number,
and a number assigned to `__proto__` cannot pollute anything. It is an
availability bug reachable only through your own uploaded file, which is why it
is rated low.

**Fix.** Build those four maps with `Object.create(null)` instead of `{}`, or
use a `Map`. Either removes the whole class of problem rather than patching the
one call site. A test with a coach literally named `__proto__` would pin it.

## 3. No bound on upload size — low

`js/parse.js:87-88` reads the whole file into an `ArrayBuffer` and hands it
straight to `XLSX.read` with no size or row-count check. A very large or
zip-bomb-shaped `.xlsx` hangs the tab.

Impact is local and self-inflicted: no persistence, no data leaves the machine,
and closing the tab recovers. But the current behaviour — a frozen page with no
explanation — contradicts the "never fail silently" rule in `SPEC.md` §6.

**Fix.** Check `file.size` before reading and refuse anything implausible with a
message naming the actual size and the limit, in the same style as the other
upload errors. A few megabytes is generous: the largest realistic student list
is a few thousand rows.

---

## Already fixed — do not re-review

**Stored XSS via attribute injection (critical).** Fixed in PR #13, on `main`.
`escapeHtml` built its output by setting `textContent` on a detached element and
reading `innerHTML` back, which escapes `&`, `<`, `>` and U+00A0 but *not*
quotes — quotes are only escaped in attribute values, which that route never
produces. Five sites interpolated the result into quoted attributes fed by
spreadsheet cells, so a coach named `Ada" onfocus="…" autofocus x="` closed the
attribute and added an event handler. Confirmed executing in Chromium before the
fix. `escapeHtml` now escapes `"` and `'` too and lives in `js/html.js` with
tests covering both the text and attribute contexts.

## Checked and clean — do not re-review

Recorded so the next person does not spend the time again.

- **ICS injection.** `escapeIcsText` handles backslash, semicolon, comma and
  newline in the correct order; line folding is octet-correct. A name containing
  `\r\n` cannot split a property or inject a second VEVENT.
- **ZIP path traversal.** `sanitiseZipEntryName` drops `.` and `..` segments
  rather than rewriting them, strips control and Windows-illegal characters, and
  `dedupeEntryNames` prevents silent overwrite inside the archive. Tested.
- **Formula injection into exports.** Values reach SheetJS as JS strings, which
  become text cells, never formulas.
- **Prototype pollution via the saved export mapping.** `sanitiseMapping` gates
  `col.field` through `Object.prototype.hasOwnProperty.call(FIELD_LABELS, …)`,
  so a hand-edited `localStorage` payload cannot reach `__proto__` or
  `constructor`.
- **Error surface.** `errors.js` uses `textContent` throughout and `CSS.escape`
  on its dedupe selector; error text cannot inject.
- **Downloads.** Object URLs created and revoked correctly, `rel="noopener"`, no
  `target="_blank"` anywhere.
- **Storage.** Only the six documented settings keys are ever written; no
  uploaded row reaches `localStorage`, as `SPEC.md` §2 claims.
- **Text-position HTML interpolation.** Every non-attribute interpolation in
  `app.js` was already escaped. `errors.js`, `ribbon.js` and the export-mapping
  editor build DOM nodes with `textContent`/`setAttribute` and were never
  exposed.

## Running the tests

Open `tests.html` over HTTP (not `file://` — it uses ES modules). Three
workbook tests skip whenever the SheetJS CDN is unreachable; that is expected on
a blocked network and is not a failure. Everything else must pass.

```
python3 -m http.server 8000     # then open http://127.0.0.1:8000/tests.html
```
