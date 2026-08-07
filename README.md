# Kanban

A personal, flow-aware Kanban board built with vanilla HTML, CSS and JavaScript.
No build step, no framework, no backend — everything runs in the browser and
persists to `localStorage`. Works directly from `file://`.

**Design world: The 8-Bit Atelier.** A colored ditherpunk desktop — columns are
windows with accent title bars, cards are paper files, drags cut holes with
marching ants, and every blend is an ordered dither. The system is documented in
`DESIGN.md`.

**Power-on homescreen.** The app boots like a machine: a live terminal log
announces your actual board (windows, files, archive), the four-square mark
winks, a tiny pixel mascot wanders the floor, and `CLICK TO START` blinks —
click, press any key, or add `?boot=off` to the URL to skip straight to the
desktop.

## Running the app

There are two equally valid ways to run it:

1. **Open `index.html` directly** — double-click the file (or drag it into a browser
   tab). It works over `file://` with no server, fully offline.
2. **Any static file server**, e.g.:

   ```sh
   npx serve .
   # or
   python -m http.server 8000
   ```

   then open `http://localhost:8000`.

No dependencies are required and nothing needs to be installed or compiled.

## Workspaces

The header switches between four workspaces:

- **Board** — the classic board experience.
- **My Desk** — a cross-board focus view with default sections (Blocked, Due
  this week, Active work, Ready to pull, Recently completed) plus built-in and
  saved **lenses** (saved ways of looking at original cards).
- **Inbox** — global capture and triage (press `I` anywhere to capture).
- **Review** — flow health and an actionable attention queue.

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
  override), WIP limit, entry and exit criteria, default labels and default
  assignee on entry, and whether the column counts toward cycle time.
- **WIP enforcement**: soft mode warns but never blocks; hard mode requires an
  explicit confirmation (and optionally a reason) before a card can move in.
  Every movement path — drag, move-to menu, keyboard move, bulk move, restore,
  recurrence creation and inbox triage — runs the same policy evaluator.
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
  tomorrow. Filter by overdue / today / this week / none, or sort the whole
  board by due date, priority, size, created or last updated (sorting disables
  card drag-reordering until you switch back to manual order).
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
- All movement paths share this lifecycle core (drag, move-to, keyboard, bulk,
  restore, recurrence, triage).

### Undo & redo
- Every mutation is tracked in memory: press **Ctrl/Cmd+Z** to undo and
  **Ctrl/Cmd+Shift+Z** (or Ctrl+Y) to redo — including board switches.
- Destructive actions (archive, delete, purge, restore, duplicate, board
  delete) also show a toast with an **Undo** button for the same 3-second
  window.
- No-op operations never consume undo history.

### Archiving
- Cards can be soft-deleted to the **Archive** panel (button in the header).
- Deleting a column archives the column together with its cards.
- In the archive you can **Restore** items or **Delete forever** (both
  undoable via toast or Ctrl+Z). Deleting forever cleans up dependency
  references to that card across all boards.
- Archiving preserves relationships; restoring preserves them too.

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

### Inbox
- Capture from the **Inbox** workspace or with the `I` shortcut: a title, a
  note, a URL, or several pasted lines. Safe `http(s)` URLs are detected;
  `javascript:`/`data:` URLs are never stored as links.
- **Triage** turns an item into a card (board, column, due date, labels,
  assignee, priority, size) in one atomic, undoable step. Items can also be
  **converted to a recurring definition**, **merged** into an existing card or
  archived as references.
- The header badge and the workspace show triage pressure ("3 unprocessed ·
  oldest: 2d").

### My Desk & lenses
- Built-in lenses: Ready to Pull, Blocked, Waiting on Others, Aging, Due Soon,
  Overdue, No Due Date, Recently Completed, Needs Triage.
- Save the current board view as a **lens** (search, labels, assignees, due,
  priority, size, flow state, ready-only, sort, grouping, density, scope).
- Lens results are references to the original cards — editing a card from a
  lens edits the original board card. Lenses can never be accidentally deleted
  (built-ins are code-defined), and deleting a board trims lens scopes safely.

### Backup
- From the board menu: **Backup / restore** exports all boards (or just the
  current one) to a JSON file, and imports a backup back — everything lives in
  `localStorage` only, so take one before clearing the browser.
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

| Keys | Action |
| --- | --- |
| `N` | Focus the first quick-add box |
| `C` | New column |
| `I` | Capture into the Inbox |
| `/` | Focus search |
| `M` (card focused) | Start keyboard move mode |
| Arrow keys / Home / End (move mode) | Choose destination |
| Enter / Escape (move mode) | Commit / cancel move |
| Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y | Undo / redo |

## Code structure

Plain classic scripts (no ES modules) are used so the app works from
`file://`. Each file attaches to a shared `window.KB` namespace; load order
in `index.html` matters. Core files are loaded before the browser adapters
that use them.

| Area | File | Responsibility |
| --- | --- | --- |
| Core | `js/core/date.js` | Deterministic date logic: ISO formatting, day offsets, due-date classification, due-filter matching, card aging. No browser access. |
| Core | `js/core/model.js` | Factories for cards, columns, labels, boards, templates, inbox items, lenses and recurrences, with injectable `{ uid, now }` dependencies. |
| Core | `js/core/migration.js` | Deterministic, idempotent, reference-independent normalization for **state version 3** (v1/v2/v3 loads, board imports, corrupt payloads, cross-board reference repair). |
| Core | `js/core/lifecycle.js` | Card transitions: role-based `startedAt`/`completedAt`, capped transition log, flow-state periods, durations, cycle time and age. |
| Core | `js/core/relations.js` | Cross-board blockers and related cards: cycle detection, derived readiness, reverse lookups, permanent-delete cleanup, indexed resolution for large boards. |
| Core | `js/core/policies.js` | Column policy evaluation: WIP modes, entry/exit criteria, override reasons, entry defaults. |
| Core | `js/core/metrics.js` | Throughput, cycle times, percentiles, SLE, WIP, review queue with ranked reasons, flow summaries, bottleneck explanations. |
| Core | `js/core/recurrence.js` | Schedule computation, overlap and missed-run policies, occurrence creation, idempotent processing, pause/resume/end. |
| Core | `js/core/inbox.js` | Capture (single/multi-line, safe URLs), update/delete, atomic triage, merge, pressure summary. |
| Core | `js/core/lenses.js` | Built-in and saved lenses: scoping, query matching, sorting, grouping. Results are references, never clones. |
| Core | `js/core/bulk.js` | Atomic multi-card move/update/archive with policy aggregation. |
| Core | `js/core/filtering.js` | Stateless filtering and sorting (search, labels, assignee, due, priority, size, flow state, age, blocked duration). |
| Core | `js/core/history.js` | Undo/redo stack mechanics (record, undo, redo, clear, limits). |
| Core | `js/core/operations.js` | High-risk state mutations (move, duplicate, archive, restore, delete column, board duplicate/delete, label removal) returning `{ changed, state, value }` results. |
| Core | `js/core/markdown.js` | HTML escaping and the light markdown renderer, with explicit safe-link handling. |
| Browser | `index.html` | Page skeleton: workspace nav, filter bar, board, workspace sections, archive panel, modal/toast/live-region roots. Inline theme bootstrap. |
| Browser | `css/styles.css` | All styling. Theming via CSS custom properties; components (columns, cards, chips, popups, modal, toasts, workspaces, bulk toolbar) are styled there. |
| Browser | `js/state.js` | State service: owns the live state, localStorage read/write (`kanban.board.v1`, version 3), undo/redo integration, and the `KB.State` API (board-aware card ops, recurrence/inbox/lens/bulk wrappers). |
| Browser | `js/filters.js` | Filter controls adapter: reads DOM filter values, owns selected labels and the sort mode, delegates matching/sorting to `KB.Core.Filtering`. |
| Browser | `js/dom.js` | Tiny helpers: `h()` element builder, inline SVG pixel-icon set, presentation date formatting, `KB.el` selector shortcut. |
| Browser | `js/dragdrop.js` | HTML5 drag-and-drop wiring; every drop routes through the shared policy-gated move path. |
| Browser | `js/modal.js` | Modal system plus editors: card (planning, flow, relationships, recurrence, activity), column (role + policies), labels, backup, move confirmation, recurrence editor/manager, capture/triage/merge, lens editor. |
| Browser | `js/moveto.js` | Move-to menu (board/column/position with cross-board label mapping) and keyboard move mode with `aria-live` announcements. |
| Browser | `js/selection.js` | Ephemeral multi-select (Ctrl/Shift-click, Escape) and the bulk-action toolbar. |
| Browser | `js/workspaces.js` | Workspace switching, My Desk / Inbox / Review rendering, lens bar, UI preference persistence. |
| Browser | `js/render.js` | Rendering: board → columns → cards (priority/size/flow/dependency/recurrence badges, SLE-aware aging), filter bar, quick-add rows, archive panel, empty states. |
| Browser | `js/app.js` | Bootstrapping and wiring: header actions, workspace events, policy-gated moves, recurrence triggers (boot/focus/visibility/timer), quick-add, toasts, shortcuts. |

`js/core/` contains deterministic application logic shared by the browser
and the Node test suite. Core files never touch `window`, `document`,
`localStorage`, `KB.el` or the DOM. Functions that need the current time
receive an explicit timestamp, and functions that generate identifiers
receive an ID factory — this is what makes the unit tests deterministic.

### Data model

State **version 3** (still stored under the key `kanban.board.v1`):

```js
{
  version: 3,
  theme: 'dark' | 'light',
  activeBoardId: '…',
  inbox: { items: [ { id, title, note, url, archived, capturedAt, updatedAt } ] },
  lenses: [ { id, name, scope, boardIds, query, sort, display, createdAt, updatedAt } ],
  recurrences: [ { id, enabled, mode, schedule, target, template, dueOffsetDays,
                   overlapPolicy, missedPolicy, activeCardRef, nextRunAt,
                   lastRunAt, lastCompletedAt, endAt, remainingOccurrences,
                   pausedReason, createdAt, updatedAt } ],
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
                                countsTowardCycleTime }, cards: [ … ] }
      ],
      archive: { cards: [ … ], columns: [ … ] }
    }
  ]
}
```

Cards carry: `priority`, `size`, `startedAt`, `completedAt`,
`flow: { state, reason, since, periods }`, `dependencies: { blockers, related }`
(cross-board `{ boardId, cardId }` references), `recurrenceId` and a capped
`transitions` log.

Everything is saved to `localStorage` under the key `kanban.board.v1` after
every mutation. Data saved by older versions (v1, v2) is migrated automatically
on first load; corrupt or malformed payloads are repaired rather than crashing;
if recovery is impossible a fresh default board is created. Derived data
(review queues, lens results, ready state) is never persisted.

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
  atomicity, lens evaluation, bulk operations, and performance budgets on
  large deterministic fixtures (20 boards, 5,000 cards).
- **End-to-end tests** (`tests/kanban-smoke.js`) validate the integrated
  application in Chromium: boot, rendering, keyboard and button wiring, modal
  workflows, drag/drop, localStorage persistence, theme, undo/redo, migration,
  corrupt-data resilience, import/export, markdown/XSS safety, priority/size,
  column roles, flow states, dependencies and ready-to-pull, policy
  enforcement, review, recurrence, inbox, lenses, My Desk, move-to menu,
  keyboard movement with live-region text, and multi-select bulk actions.
- The app itself still has no runtime dependencies and no build step.
  Puppeteer remains a development-only dependency.
