# Kanban

A personal, flow-aware Kanban board built with vanilla HTML, CSS and JavaScript.
No build step, no framework, no backend — everything runs in the browser and
persists locally in **IndexedDB**, with a localStorage crash mirror and rotating
automatic backups. It is an installable **PWA**: over HTTP(S) it works fully
offline after the first visit. Opening `index.html` directly from `file://`
also works, exactly as before (minus the offline cache).

**Seven design worlds.** Not themes — worlds. Each sets its own type families
*and* scale, corner language, line weights, depth model, texture, motion
character and card composition, over one unchanged component layer: **Atelier —
Ink** (the flagship ditherpunk desktop), **Atelier — Paper** (the same desktop
printed rather than emitted), **Cloud Quarry** (chamfered spec plates on a
survey grid), **Memphis Workshop** (laminate slabs and terrazzo), **Festival
Lineup** (no chrome at all — priority is billing, and size carries it),
**Industrial Quote** (stockroom hazard stripes and zip ties) and **Specimen
Archive** (foxed card stock pinned to a linen board). Switch worlds and pick a
curated accent from the picker in the menu bar. The contract that makes this
possible is documented in `DESIGN.md`.

**Power-on homescreen.** The app boots like a machine: a live terminal log
announces your actual board (windows, files, archive), the four-square mark
winks, a tiny pixel mascot wanders the floor, and `CLICK TO START` blinks —
click, press any key, or add `?boot=off` to the URL to skip straight to the
desktop.

## Running the app

The full experience (install prompt, offline cache, service worker) needs
HTTP(S):

```sh
npm run serve     # zero-dependency static server → http://localhost:8123
# or any static file server:
npx serve .
python -m http.server 8000
```

Opening `index.html` directly still works over `file://` with no server — all
assets are local files (fonts included), so nothing needs the network at all.

## Command palette, menus & shortcuts

One shared command registry (`js/core/commands.js` + `js/commands.js`) powers
every action surface, so a command behaves identically wherever it is invoked:

- **Command palette** — press **Ctrl/Cmd+K** (or the ⌘ button in the header):
  filter by title or keywords, arrows + Enter to run, Esc to close. Fully
  keyboard-navigable, `role="combobox"`/`listbox` semantics, focus trapped.
- **Keyboard shortcuts** — `N`, `C`, `I`, `/`, Ctrl/Cmd+Z/Y and more are
  registered in the same registry (see the table below). Press **Ctrl/Cmd+K →
  "Keyboard shortcuts"** for the full list.
- **App menu** — the ☰ button opens a registry-driven menu (desktop popover,
  mobile bottom sheet) with every category.
- **Mobile action sheets** — on touch screens, tapping a card opens a bottom
  sheet (Open, Move to…, Duplicate, Block/Wait/Pause/Clear flow, Archive); the
  column `⋯` opens a column sheet; both route through the same commands and the
  same policy/lifecycle/undo machinery as desktop.

## Mobile experience

At ≤640px the board is a **single-column pager**, not a squashed bench: one
column window at a time, swiped or stepped with ◀ ▶ and dots, with snap
scrolling. A collapsible **Filters** drawer, a bottom workspace tab bar
(Board / Desk / Inbox / Review), bigger touch targets, and card/column action
sheets replace hover-only menus. Desktop is untouched.

## PWA & offline

- `manifest.webmanifest` + generated pixel icons (192/512/maskable/Apple
  touch) make the app **installable**; the browser prompt is deferred into an
  **Install app** command in the palette.
- `sw.js` precaches every local asset (the app has no CDN dependencies — the
  two display fonts are vendored under `fonts/` with their OFL licenses) and
  serves the whole app offline after the first visit.
- Updates: when a new service worker is found, a toast offers **Reload**;
  the new worker only takes over after you accept.

## Workspaces

The header switches between eight workspaces:

- **Board** — the classic board experience.
- **My Desk** — a cross-board focus view with default sections (Blocked, Due
  this week, Active work, Ready to pull, Recently completed) plus built-in and
  saved **lenses** (saved ways of looking at original cards).
- **Inbox** — global capture and triage (press `I` anywhere to capture).
- **Review** — flow health and an actionable attention queue.
- **Date Desk** — a month calendar of every card with a due date (all boards):
  colour-labelled card chips in day cells, a dither-highlighted **overdue
  strip**, drag a chip onto another day to reschedule (one undo step), arrows
  walk the grid and Enter opens the day's first card. Press `T` to jump here.
  Mobile renders the same grid; tapping a chip opens the card editor (with
  type-to-snooze) instead of drag.
- **Work Log** — a copy-ready weekly ledger of completed work (press `L`):
  day columns of finished cards with label chips and cycle-time notes, a
  masthead of per-board counts, an **UNSTAMPED** band flagging cards sitting
  in Done columns that never ran the lifecycle (with a one-key STAMP fix),
  `‹ ›` steps weeks, `C` copies a paste-ready summary ("WEEK OF AUG 4–10 —
  12 DONE · TUE · 3: Ship 1.0 release · Fix #42 …") for client updates,
  invoices and standups, and `P` prints. Pure projection of `completedAt` —
  no new storage.

Your current workspace is remembered across reloads.

## Features

### Boards
- Multiple boards, switched from the board menu in the header (also: new, rename,
  duplicate, delete). Deleting a board keeps an Undo toast nearby — nothing is
  unrecoverable.
- Every board has its own labels, templates, columns and archive.

### Board & columns
- Default columns: **To Do** (queue), **In Progress** (active), **Done** (done).
- Add columns with the **New column** button in the header.
- Every column has a **workflow role**: `backlog`, `queue`, `active` or `done`.
  Role is what drives lifecycle timestamps (see "Flow lifecycle" below).
- **Column policies** (column `⋯` menu): WIP mode (off / soft warn / hard
  override), WIP limit, entry and exit criteria, and default labels and default
  assignee on entry.
- **WIP enforcement**: soft mode warns before a move happens but never blocks —
  the confirmation dialog offers "Move anyway". Hard mode requires an explicit
  confirmation (and optionally a reason) before a card can move in. Every
  movement and creation path — drag, move-to menu, keyboard move, bulk move,
  restore, quick-add and new-card creation, inbox triage, recurrence creation —
  runs the same policy evaluator through one shared placement pipeline, so
  entry criteria, entry defaults, lifecycle timestamps and after-completion
  scheduling behave identically everywhere.
- A **single placement pipeline** (`js/core/pipeline.js`) applies policy
  checks, lifecycle transitions, entry defaults and the recurrence
  after-completion side effect on every path that inserts a card into a column.
  A recurrence created into a hard-WIP column is paused-but-retrying (surfaced
  in the recurrence manager) rather than silently creating cards past the
  limit; soft-WIP overage on a background occurrence is allowed without a
  dialog, since there is no user to confirm.
- **Same-column reordering** changes only the array position — no lifecycle
  transition, no `updatedAt` change, no re-applied defaults. Soft-WIP overage
  when restoring an archived card asks for confirmation like any other move.
- **Collapse/expand** a column to a title bar with the chevron on the header.
- Reorder columns by dragging a column header (drag from the title/grip area,
  not from the buttons).
- Delete a column via its `⋯` menu. Deleting a column **never destroys its
  cards**: you are told how many cards it contains and they are moved to the
  archive along with the column.

### Cards
- Create with the `+` in a column header, the inline **quick-add** box at the
  bottom of every column (type a title, press Enter — paste several lines to
  add many cards at once), or press `N` to jump to the first quick-add box.
- **Smart Quick Add** (natural-language capture): the quick-add box parses
  due dates, priority and labels straight out of the line —
  `fix login bug in 3 days p2 #Bug` creates a card titled `fix login bug`
  with a due date in 3 days, HIGH priority and the `Bug` label. Recognized
  tokens show as live preview chips before you press Enter, and the parsed
  fields flow through the same placement pipeline as any other add (policies,
  lifecycle, entry defaults, one undo entry). Grammar (deliberately small and
  explicit — plain prose is never rewritten): `today` / `tomorrow` / weekday
  names (`fri`, `next friday`, `this friday` — bare/`next` weekdays are
  always in the future), `in N days/weeks/months`, `+1d`/`+2w`/`+1m`,
  `next week`, `eom`, month-day dates (`25 jul`, `jul 25`), ISO dates
  (`2026-08-20`), times (`5pm`, `17:30` — recognized but not stored, the
  model is day-granular), priority `p1`–`p4` or `priority:high`, and labels
  `#name` (resolved against the board's labels; unknown tags stay in the
  title). Snooze verbs (`snooze 3d`, `push 1w`) work here too.
- New cards are created through the same placement pipeline as moves: entering
  an `active` column records `startedAt`, entering a `done` column records
  `completedAt`, entry defaults apply, and policy columns ask for confirmation
  before adding (hard WIP, entry criteria, and soft-WIP overage all show the
  confirm dialog on new-card, template and quick-add creation — multi-line
  pastes are pre-flighted against the whole batch, so the dialog appears if
  any line would trip a policy). Multi-line quick-add is atomic — either
  every pasted line becomes a card or none do — and a blocked paste keeps
  the input text and reports the policy block.
- Every card has a **required title**, a plain-text **description** (with
  light markdown: `**bold**`, `*italic*`, `` `code` ``, `[links](url)`),
  one or more **colour-coded labels**, an optional **assignee** (free text,
  with autocomplete from names already in use), an optional **due date** and
  an optional **checklist** with a pixel-block progress bar on the card.
- **Priority** (none/low/medium/high/urgent) and **size** (none/XS–XL) render
  as compact chips and are filterable and sortable.
- **Flow states**: a card can be marked **Blocked**, **Waiting** or **Paused**
  with a reason. Each state records when it started and keeps a capped history
  of past periods. Filters include blocked / waiting / paused.
- **Dependencies**: a card can list **blockers** (cross-board allowed) and
  **related** cards. Self-references, duplicates and dependency cycles are
  rejected. "Ready to pull" is derived — a card with zero unresolved blockers
  is ready. Cards show a `READY` badge or an unresolved blocker count.
- Due dates render as chips: red when **overdue**, amber when due today or
  tomorrow. In the card editor, the **type-to-snooze** field reschedules the
  due date from the keyboard — `push fri`, `snooze 3d`, `+1w` (relative
  offsets move the current due date, weekday names and dates resolve from
  today) with a live preview chip and a single Enter to apply; the native
  date picker stays for point-and-click. Filter by overdue / today / this
  week / none, or sort the whole board by due date, priority, size, created
  or last updated (sorting disables card drag-reordering until you switch
  back to manual order).
- Cards show an **aging chip** (`3D`) once they have sat in a column for more
  than a day. With enough completed samples (or a manual SLE), the chip becomes
  SLE-aware: visible ≥ 50%, warning ≥ 80%, risk beyond the service level.
- Duplicate a card from its hover buttons or the editor, or save any card as a
  **template** and re-create it from any column's quick-add menu.
- Cards in a `done`-role column show a green checkmark badge.
- Drag cards between columns and reorder them within a column. A blue insertion
  line shows exactly where the card will land. Dropping a card on a column
  header appends it to the end of that column.
- Every card has a **Move to…** button and supports **keyboard movement**:
  focus a card, press `M`, use arrow keys / Home / End to pick a destination,
  Enter to commit, Escape to cancel. Screen-reader announcements describe the
  move in the `aria-live` region.

### Flow lifecycle
- The first time a card enters an `active`-role column it records `startedAt`.
- Entering a `done`-role column records `completedAt`; leaving it clears it.
- Every meaningful cross-column move appends to a capped transition log
  (newest 100) with role snapshots, so later role changes never rewrite
  history. The card editor's **Activity** section renders this history.
  Same-column reordering records nothing.
- All movement and creation paths share this lifecycle core through the single
  placement pipeline described above.

### Undo & redo
- Every mutation is tracked in memory: press **Ctrl/Cmd+Z** to undo and
  **Ctrl/Cmd+Shift+Z** (or Ctrl+Y) to redo — including board switches.
- Destructive actions (archive, delete, purge, restore, duplicate, board
  delete) also show a toast with an **Undo** button for the same 3-second
  window.
- No-op operations never consume undo history.

### Archiving
- Cards can be soft-deleted to the **Archive** panel (button in the header).
- Deleting a column archives the column together with its cards, keeping the
  full v3 column metadata (role, WIP limit and mode, criteria, default labels
  and assignee, collapse state) so restoring brings the column back as it was.
- In the archive you can **Restore** items or **Delete forever** (both
  undoable via toast or Ctrl+Z). Deleting forever cleans up dependency
  references to that card across all boards; deleting an archived column
  forever cleans up every reference to the cards nested inside it in the same
  transaction.
- Archiving preserves relationships; restoring preserves them too. A blocker
  that was completed and then archived still counts as resolved — dependency
  resolution uses the card's preserved `completedAt` — so dependents are not
  blocked again by archived completed work.

### Search & filters
- The search bar matches card **title and description** (case-insensitive).
- Filter by **label**, **assignee**, **due date**, **priority**, **size** and
  **flow state**, plus two derived toggles: **Ready** (no unresolved blockers)
  and **Dep. blocked** (at least one unresolved blocker).
- Filters combine with AND logic across categories, while multiple selected
  labels match a card if it has *any* of them (OR within the label group).
- **Sort** cards within each column (manual / due date / priority / size /
  created / last updated / longest blocked) from the filter bar.
- Press `/` anywhere to jump to the search box. "Clear filters" resets
  everything.

### Multi-select & bulk actions
- Ctrl/Cmd-click toggles a card; Shift-click selects a visible range. Escape
  clears. A toolbar appears with: **Move…** (with policy confirmation),
  labels, assignee, due date, priority, size, flow state and **Archive**.
- Bulk operations are atomic — one undo entry restores the whole selection.
  Label and flow-state bulk changes are single transactions too (per-card
  results are computed before one commit).

### Review workspace
- A **flow summary** (WIP, completed 7/30d, median and 85th-percentile cycle
  time, SLE, blocked totals and blocked duration for recently completed cards,
  over-WIP bottlenecks with plain-language explanations) and an
  **attention queue** ordered by: manually blocked longest → dependency
  blocked → waiting longest → beyond SLE → over-WIP column → overdue → stale →
  oversized checklist → paused → completed long enough to archive.
- Every queue item explains **why** it appears and offers direct actions
  (Open, Move, Archive) that update the original card. Review results are
  derived and never persisted.

### Recurring work
- The **Recurring** button in the header opens the recurrence manager.
- Two modes: **Scheduled** (daily / weekly / monthly / every N days) and
  **After completion** (create the next card N days after the last one was
  completed).
- Defaults: **single-active** overlap (one instance at a time, no pile-up) and
  **create-one** for missed runs (skip / catch-up-all also available, catch-up
  capped at 100 per pass).
- Recurrences are processed when the app boots, when the tab becomes visible or
  the window regains focus, and on a 60-second timer while open. Processing is
  idempotent. The UI states clearly: *Scheduled work is created when this local
  app is open or next opened.*
- Completing a recurring card schedules the next after-completion occurrence
  inside the same transaction as the move — drag, move-to menu, cross-board
  moves, bulk moves and restore all trigger it. If a column policy blocks an
  occurrence (hard WIP, entry criteria), creation pauses without erroring and
  the manager shows "waiting: a column policy blocks new cards" until the
  policy no longer blocks.

### Inbox
- Capture from the **Inbox** workspace or with the `I` shortcut: a title, a
  note, a URL, or several pasted lines. Safe `http(s)` URLs are detected;
  `javascript:`/`data:` URLs are never stored as links.
- **Triage** turns an item into a card (board, column, due date, labels,
  assignee, priority, size) in one atomic, undoable step, through the same
  placement pipeline as moves — lifecycle timestamps, entry defaults and
  column policies apply, and a policy-blocked triage asks for confirmation
  before the item leaves the inbox. Items can also be
  **converted to a recurring definition**, **merged** into an existing card or
  archived as references.
- The header badge and the workspace show triage pressure ("3 unprocessed ·
  oldest: 2d") — archived reference items are excluded from both the badge and
  the pressure line.

### My Desk & lenses
- Built-in lenses: Ready to Pull, Blocked, Waiting on Others, Aging, Due Soon,
  Overdue, No Due Date, Recently Completed, Needs Triage.
- My Desk's default sections: **Blocked**, **Due this week**, **Active work**,
  **Ready to pull** (queue-role columns, normal flow state, no unresolved
  blockers), **Recently completed** (completed within 7 days).
- Built-in lens semantics: **Aging** matches open work older than 7 days;
  **Needs Triage** matches open cards that carry none of priority, size,
  assignee or labels — i.e. cards that have never been through triage. The
  **Blocked** lens includes both dependency-blocked and manually blocked
  cards. **Ready to Pull** uses the same definition as My Desk — queue-role
  column, normal flow state, no unresolved blockers.
- Save the current board view as a **lens** (search, labels, assignees, due,
  priority, size, flow state, ready-only, sort, grouping, density, scope).
- Lens results are references to the original cards — editing a card from a
  lens edits the original board card. Lenses can never be accidentally deleted
  (built-ins are code-defined), and deleting a board trims lens scopes safely.

### Day Sheet ("Start My Day")
- When today's sheet is unstamped, a dither-marked **START MY DAY** banner
  appears on the board. It opens a bounded two-minute planning ritual: a
  **Pick band** of at most 9 ranked candidates with reason chips (`CARRIED
  OVER` from yesterday's sheet → `OVERDUE Nd` oldest first → `DUE TODAY P1`
  by priority → top of the Review queue), press `1-9` to fill up to **3
  slots**, Enter (or **STAMP DAY**) to commit.
- The stamped sheet is the day: checkbox squares tick cards into the Done
  column (through the normal placement pipeline — policies and lifecycle
  apply), with a `n of 3 DONE` progress line. It persists per date in the
  normal save path (IndexedDB + mirror + backups, included in exports).
- **End the day** forces a decision on every unfinished commitment: `K`
  keep (carries over to tomorrow's pick band), `P` push +1d, `D` drop the
  due date, `X` archive — applied as **one atomic, undoable roll**. The
  sheet is deliberately local, keyboard-first and bounded: the anti-bloat
  guardrail made concrete (never a 50-item "Today" flood, no $200/yr
  planner subscription needed).

### Focus sessions
- A task-tied timer: **Start focus** from the card editor (or the card action
  sheet) runs a 25-minute pomodoro; a corner HUD shows the countdown with the
  card's title. Press `F` to stop, or stop from the HUD.
- Elapsed time is always `now − startedAt` from timestamps — the HUD is a
  pure render, so it never drifts, and a running session **survives a
  reload**. Sub-minute sessions log nothing (no effort noise).
- A full pomodoro stamps the card (`⏱ 2h05m · 5 pomo` chip) and both minutes
  and pomodoro count land in the per-day focus log (`state.focusDays`) — the
  freelancer's timesheet substrate. Starting and stopping are each one atomic,
  undoable state op.

### Backup & recovery
- Application data lives in **IndexedDB** (primary). Every save also writes an
  atomic localStorage crash-mirror envelope (`kanban.mirror.v1`) so a tab that
  closes mid-write can never lose work — on the next boot the newer valid
  mirror wins and repairs the store.
- **Automatic rotating backups**: up to 10 snapshots are kept in IndexedDB (at
  most one per minute), plus an explicit backup before migrations and imports.
  Load order on boot: newer valid mirror → primary → newest valid backup →
  legacy localStorage → fresh default board (each candidate validated
  independently; corrupt data is skipped, never fatal).
- From the board menu: **Backup / restore** exports all boards (or just the
  current one) to a JSON file, and imports a backup back.
- Board-only exports include flow settings, roles, policies, dependencies and
  the recurrences/lenses scoped to that board; unresolved external dependency
  references are dropped on import with a count.

### Theme
- Dark/light toggle in the header, applied consistently across the whole app
  and remembered across reloads.

### Feedback & empty states
- Toasts confirm every action (added, saved, archived, restored, deleted) and
  carry **Undo** for destructive ones.
- Dedicated empty states: empty board, empty column, "no cards match your
  filters", empty review queue, empty inbox.

## Keyboard shortcuts

All shortcuts are registered in the command registry; Ctrl/Cmd+K → "Keyboard
shortcuts" lists them from the live registry.

| Keys | Action |
| --- | --- |
| `Ctrl/Cmd+K` | Command palette |
| `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`, `Ctrl/Cmd+Y` | Undo / redo |
| `N` | Focus the first quick-add box |
| `C` | New column |
| `I` | Capture into the Inbox |
| `/` | Focus search |
| `M` (card focused) | Start keyboard move mode |
| Arrow keys / Home / End (move mode) | Choose destination |
| Enter / Escape (move mode) | Commit / cancel move |
| `Ctrl/Cmd+Enter` (card editor) | Save the card |
| `T` | Open the Date Desk (calendar) |
| `L` | Open the Work Log |
| `F` | Stop the running focus session |
| `C` / `P` (Work Log) | Copy the week's summary / print |

## Code structure

Plain classic scripts (no ES modules) are used so the app works from
`file://`. Each file attaches to a shared `window.KB` namespace; load order
in `index.html` matters. Core files are loaded before the browser adapters
that use them.

| Area | File | Responsibility |
| --- | --- | --- |
| Core | `js/core/date.js` | Deterministic date logic: ISO formatting, day offsets, due-date classification, due-filter matching, card aging. No browser access. |
| Core | `js/core/nlparse.js` | Natural-language capture grammar: deterministic parsing of due dates, priority and labels out of quick-add lines and snooze phrases, with token spans for live preview. No browser access. |
| Core | `js/core/calendar.js` | Calendar projection: a pure function of (monthKey, cards, now) producing the 6×7 month grid, today/overdue classification and the overdue strip. No browser access. |
| Core | `js/core/dayplan.js` | Day Sheet rules: candidate ranking (carry-over → overdue → due-today → Review), stamping (bounded slots, dedupe, order), and the end-of-day roll planner (keep/push/drop/archive ops as one atomic list). No browser access. |
| Core | `js/core/focus.js` | Focus sessions: pure elapsed-time math (timestamps, never ticks), pomodoro thresholds, per-card/per-day effort accounting and totals, effort formatting. No browser access. |
| Core | `js/core/worklog.js` | Work Log projection: Monday-anchored week ranges, grouping of completed cards by day with per-board/per-label stats, the UNSTAMPED (done-role, never completed) band, and deterministic copy-ready text composition. No browser access. |
| Core | `js/core/model.js` | Factories for cards, columns, labels, boards, templates, inbox items, lenses and recurrences, with injectable `{ uid, now }` dependencies. |
| Core | `js/core/migration.js` | Deterministic, idempotent, reference-independent normalization for **state version 3** (v1/v2/v3 loads, board imports, corrupt payloads, cross-board reference repair). |
| Core | `js/core/lifecycle.js` | Card transitions: role-based `startedAt`/`completedAt`, capped transition log, flow-state periods, durations, cycle time and age. |
| Core | `js/core/relations.js` | Cross-board blockers and related cards: cycle detection, derived readiness, reverse lookups, permanent-delete cleanup, indexed resolution for large boards. |
| Core | `js/core/policies.js` | Column policy evaluation: WIP modes, entry/exit criteria, override reasons, entry defaults. |
| Core | `js/core/pipeline.js` | The single card placement pipeline: policy check, lifecycle transition, entry defaults and the recurrence after-completion side effect run in one pass on every insertion path. |
| Core | `js/core/metrics.js` | Throughput, cycle times, percentiles, SLE, WIP, review queue with ranked reasons, flow summaries, bottleneck explanations. |
| Core | `js/core/recurrence.js` | Schedule computation, overlap and missed-run policies, occurrence creation, idempotent processing, pause/resume/end. |
| Core | `js/core/inbox.js` | Capture (single/multi-line, safe URLs), update/delete, atomic triage, merge, pressure summary. |
| Core | `js/core/lenses.js` | Built-in and saved lenses: scoping, query matching, sorting, grouping. Results are references, never clones. |
| Core | `js/core/bulk.js` | Atomic multi-card move/update/archive with policy aggregation. |
| Core | `js/core/filtering.js` | Stateless filtering and sorting (search, labels, assignee, due, priority, size, flow state, age, blocked duration). |
| Core | `js/core/history.js` | Undo/redo stack mechanics (record, undo, redo, clear, limits). |
| Core | `js/core/operations.js` | High-risk state mutations (move, duplicate, archive, restore, delete column, board duplicate/delete, label removal) returning `{ changed, state, value }` results. |
| Core | `js/core/markdown.js` | HTML escaping and the light markdown renderer, with explicit safe-link handling. |
| Core | `js/core/store.js` | Storage engine over an injectable promise backend: serialized writes, rotating backups with throttling, and the boot recovery chain (newer valid mirror → primary → newest valid backup → legacy → defaults). Pure logic; the IndexedDB backend is injected. |
| Core | `js/core/commands.js` | Command registry: register/search/filter/shortcut lookup/dispatch with contexts and availability. Powers the palette, shortcuts, menus and sheets. |
| Browser | `index.html` | Page skeleton: workspace nav, filter bar, board + pager, workspace sections, archive panel, mobile tabs, modal/palette/sheet/toast/live-region roots. |
| Browser | `css/styles.css` | All styling. Theming via CSS custom properties; components (columns, cards, chips, popups, modal, palette, sheets, toasts, workspaces, mobile pager/tabs, bulk toolbar) are styled there. |
| Browser | `js/state.js` | State service: owns the live state, persistence routing (IndexedDB + mirror via `KB.Storage`), undo/redo integration, the sync observer emission, and the `KB.State` API surface. |
| Browser | `js/state-cards.js` | Card-focused `KB.State` operations (create/edit/archive, checklist, labels, assignee, due, flow, dependencies). |
| Browser | `js/state-features.js` | Feature-state `KB.State` operations (boards, columns, labels, templates, recurrences, inbox, lenses, bulk). |
| Browser | `js/storage.js` | IndexedDB adapter for the storage engine plus the atomic localStorage crash-mirror envelope and the boot-time recovery wiring. |
| Browser | `js/sync.js` | Mutation observer (`KB.Sync.subscribe`): the seam the optional CRDT sync layer hooks into. A no-op passthrough while sync is off, which is the default. Contract in [docs/SYNC.md](docs/SYNC.md). |
| Browser | `js/core/ydoc.js` | CRDT binding: replays `KB.Core.StateDiff` ops onto a `Y.Doc` of nested `Y.Map`/`Y.Array`, and materializes it back to a state snapshot. Yjs is injected, not imported. |
| Browser | `js/sync-provider.js` | WebSocket transport for the sync layer: tagged binary frames, reconnect with jittered backoff, snapshot-on-request. Knows nothing about boards. |
| Browser | `js/sync-session.js` | Sync lifecycle and glue: opt-in config, on-demand `vendor/yjs.js` load, local saves → ops → document, remote updates → `KB.State.applyRemote`. |
| Node | `sync-relay.js` | Optional zero-dependency WebSocket relay (hand-rolled RFC 6455) that fans opaque Yjs updates out per room, with a bounded, compactable in-memory log. Attached by `serve.js` only under `npm run serve:sync`. |
| Vendor | `vendor/yjs.js` | Yjs 13.6.20 bundled to a `window.Y` IIFE by `npm run yjs` and committed. Deliberately outside `index.html` and the precache: loaded on demand when sync is switched on. |
| Browser | `js/multitab.js` | Cross-tab guard: a localStorage edit lock makes a second tab read-only with a takeover banner (prevents last-writer-wins loss). |
| Browser | `js/commands.js` | The app's command definitions (single source of truth for the palette, shortcuts, app menu, action sheets). |
| Browser | `js/palette.js` | Ctrl/Cmd+K command palette overlay: filter, keyboard navigation, combobox/listbox semantics, focus trap. |
| Browser | `js/actionsheet.js` | Bottom action sheets for cards, columns and the app menu. |
| Browser | `js/pwa.js` | Service-worker registration, update toast flow, deferred install prompt. |
| Browser | `js/filters.js` | Filter controls adapter: reads DOM filter values, owns selected labels and the sort mode, delegates matching/sorting to `KB.Core.Filtering`. |
| Browser | `js/dom.js` | Tiny helpers: `h()` element builder, inline SVG pixel-icon set, presentation date formatting, `KB.el` selector shortcut. |
| Browser | `js/dragdrop.js` | HTML5 drag-and-drop wiring; every drop routes through the shared policy-gated move path. |
| Browser | `js/modals/core.js` | Modal system (overlay, focus, prompt/dialog helpers) plus the card, column, recurrence, triage, labels, backup, capture/merge and lens editors. |
| Browser | `js/modals/day.js` | The Day Sheet ritual modal: pick band with 1-9 key badges and reason chips, stamping, commitment checkboxes, and the end-of-day roll band (K/P/D/X) applied as one atomic undo entry. |
| Browser | `js/moveto.js` | Move-to menu (board/column/position with cross-board label mapping) and keyboard move mode with `aria-live` announcements. |
| Browser | `js/selection.js` | Ephemeral multi-select (Ctrl/Shift-click, Escape) and the bulk-action toolbar. |
| Browser | `js/workspaces.js` | Workspace switching, My Desk / Inbox / Review rendering, lens bar, UI preference persistence. |
| Browser | `js/render.js` | Rendering: board → columns → cards (priority/size/flow/dependency/recurrence badges, SLE-aware aging), filter bar, quick-add rows, archive panel, empty states. |
| Browser | `js/app.js` | Bootstrapping and wiring: header actions, workspace events, policy-gated moves, recurrence triggers (boot/focus/visibility/timer), quick-add, toasts, shortcuts. |
| Browser | `sw.js` | Service worker: offline precache, network-first app shell, consent-gated update flow, `kanban-`-scoped cache cleanup. |
| Browser | `manifest.webmanifest` | Installable-PWA manifest (name, theme, icons, `start_url`). |
| Browser | `serve.js` | Zero-dependency static file server for local development and PWA testing (`npm run serve`). |

`js/core/` contains deterministic application logic shared by the browser
and the Node test suite. Core files never touch `window`, `document`,
`localStorage`, `KB.el` or the DOM. Functions that need the current time
receive an explicit timestamp, and functions that generate identifiers
receive an ID factory — this is what makes the unit tests deterministic.

### Data model

State **version 3** (persisted to IndexedDB; an atomic localStorage envelope
`kanban.mirror.v1` holds the crash-recovery copy, and the legacy key
`kanban.board.v1` feeds the first-run migration from pre-envelope builds):

```js
{
  version: 3,
  theme: 'dark' | 'light',
  activeBoardId: '…',
  inbox: { items: [ { id, title, note, url, archived, capturedAt, updatedAt } ] },
  lenses: [ { id, name, scope, boardIds, query, sort, display, createdAt, updatedAt } ],
  dayplans: { 'YYYY-MM-DD': { dateISO, stampedAt, rolledAt,
              commitments: [ { cardId, order, status } ] } },
  focusDays: { 'YYYY-MM-DD': { minutes, pomodoros } },
  focusSession: { cardId, startedAt, kind: 'pomodoro'|'stopwatch' } | null,
  recurrences: [ { id, enabled, mode, schedule, target, template, dueOffsetDays,
                   overlapPolicy, missedPolicy, activeCardRef, nextRunAt,
                   lastRunAt, lastCompletedAt, endAt, remainingOccurrences,
                   needsAttention, policyBlocked, pausedReason, createdAt, updatedAt } ],
  boards: [
    {
      id, name,
      flowSettings: { staleAfterDays, oversizedChecklistThreshold,
                      completedReviewAfterDays, slePercentile, manualSleDays },
      labels, templates,
      columns: [
        { id, title, role: 'backlog'|'queue'|'active'|'done', isDone, wipLimit,
          collapsed, policy: { wipMode, overrideRequiresReason, entryCriteria,
                                exitCriteria, defaultLabelIds, defaultAssignee,
                                countsTowardCycleTime (reserved, unused) },
          cards: [ … ] }
      ],
      archive: { cards: [ … ], columns: [ … ] }
    }
  ]
}
```

Cards carry: `priority`, `size`, `startedAt`, `completedAt`,
`flow: { state, reason, since, periods }`, `dependencies: { blockers, related }`
(cross-board `{ boardId, cardId }` references), `recurrenceId`,
`effort: { minutes, pomodoros }` and a capped `transitions` log.

Everything is saved to **IndexedDB** (`kanban-store` database) after every
mutation through a serialized write queue, with an atomic localStorage
crash-mirror envelope (`kanban.mirror.v1`) and up to 10 rotating automatic
backups. Data saved by older versions (v1, v2) is migrated automatically on
first load; corrupt or malformed payloads are repaired rather than crashing;
the boot recovery chain is newer valid mirror → primary → newest valid backup →
legacy payload → fresh default board. Derived data (review queues, lens
results, ready state) is never persisted.

## Testing

The app itself needs nothing installed, but two test layers document and
verify it:

```sh
npm install        # once — brings in puppeteer (development-only) for the browser suite
npm run test:unit  # fast Node unit tests for the js/core rules (no browser)
npm run test:e2e   # headless Chromium end-to-end suites (tests/kanban-smoke.js)
npm test           # unit tests first, then the end-to-end suite
```

- **Unit tests** (`tests/unit/*.test.js`) validate the browser-independent
  application rules in `js/core/` with Node's built-in test runner: date
  arithmetic, filtering and sorting, markdown safety, model factories,
  migration/normalization (v1/v2/v3, malformed payloads, reference
  independence), undo/redo, lifecycle, relations and cycle detection, policies,
  metrics and SLE, recurrence scheduling and idempotency, inbox triage
  atomicity, lens evaluation, the placement pipeline (policy + defaults +
  lifecycle + recurrence side effect), bulk operations, the storage engine
  (serialized writes, backup rotation and throttling, the full recovery
  chain), the command registry (search, shortcuts, contexts, availability,
  dispatch), and performance budgets on large deterministic fixtures (20
  boards, 5,000 cards).
- **End-to-end tests** (`tests/kanban-smoke.js`) validate the integrated
  application in Chromium: boot, rendering, keyboard and button wiring, modal
  workflows, drag/drop, IndexedDB persistence across reloads, backup recovery
  from a corrupted store, serialized-write ordering, sync-observer events,
  localStorage legacy migration, theme, undo/redo, migration, corrupt-data
  resilience, import/export, markdown/XSS safety, priority/size, column roles,
  flow states, dependencies and ready-to-pull, policy enforcement (including
  soft-WIP "Move anyway" and per-criterion confirmation), recurrence, inbox
  triage through policies, archived dependencies, lens semantics, My Desk,
  move-to menu, keyboard movement with live-region text, multi-select bulk
  actions, the command palette (open, filter, run, escape, combobox semantics),
  mobile pager/tabs and card action sheets with focus trapping, reduced-motion
  behavior, PWA installability (manifest), service-worker registration,
  precache integrity, and rendering fully offline from cache, and
  cross-feature composition scenarios (recurring card → bulk move into a
  hard-WIP column → confirm → completion recorded → next occurrence scheduled
  → one undo restores everything).
- The app itself still has no runtime dependencies and no build step.
  Puppeteer remains a development-only dependency.
