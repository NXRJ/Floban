# Kanban

A personal Kanban board built with vanilla HTML, CSS and JavaScript. No build step,
no framework, no backend — everything runs in the browser and persists to `localStorage`.

**Design world: The 8-Bit Atelier.** A colored ditherpunk desktop — columns are
windows with accent title bars, cards are paper files, drags cut holes with
marching ants, and every blend is an ordered dither. The system is documented in
`DESIGN.md` (with its machine-readable sidecar at `.impeccable/design.json`).

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

## Features

### Board & columns
- Default columns: **To Do**, **In Progress**, **Done**.
- Add columns with the **New column** button in the header.
- Rename a column via its `⋯` menu (also lets you mark a column as a
  **completion column**, which shows checkmarks on its cards).
- Reorder columns by dragging a column header (drag from the title/grip area,
  not from the buttons).
- Columns are spaced evenly across the board and re-balance as you add or
  remove columns; when they overflow the window they switch to left-aligned
  scrolling with a fixed gap.
- Delete a column via its `⋯` menu. Deleting a column **never destroys its
  cards**: you are told how many cards it contains and they are moved to the
  archive along with the column.

### Cards
- Create with the `+` in a column header, edit and archive from the `⋯` buttons
  that appear when hovering a card.
- Every card has a **required title**, a plain-text **description**, one or more
  **colour-coded labels**, and an optional **assignee** (free text, with
  autocomplete from names already in use).
- Cards in a column marked as a completion column (the default **Done** column)
  show a green checkmark badge and a green left border.
- Drag cards between columns and reorder them within a column. A blue insertion
  line shows exactly where the card will land. Dropping a card on a column
  header appends it to the end of that column.

### Archiving
- Cards can be soft-deleted to the **Archive** panel (button in the header).
- Deleting a column archives the column together with its cards.
- In the archive you can **Restore** items or **Delete forever** (permanent
  delete is confirmed with a prompt).
- Restore behaviour:
  - A restored card returns to its original column if that column still exists;
    otherwise it goes to the first column (a "To Do" column is created if the
    board is empty).
  - A restored column is appended at the end of the board with its cards.

### Search & filters
- The search bar matches card **title and description** (case-insensitive).
- Filter by **label** (click label chips in the filter bar) and by
  **assignee** (dropdown, including an "Unassigned" option).
- Filters combine with AND logic across categories (search *and* labels *and*
  assignee), while multiple selected labels match a card if it has *any* of
  them (OR within the label group).
- Press `/` anywhere to jump to the search box. "Clear filters" resets
  everything.

### Theme
- Dark/light toggle in the header, applied consistently across the whole app
  and remembered across reloads.

### Feedback & empty states
- Toasts confirm every action (added, saved, archived, restored, deleted).
- Dedicated empty states: empty board, empty column ("drop cards here"),
  and a "no cards match your filters" banner with a clear-filters shortcut.
- Keyboard works throughout: Tab + Enter for buttons, Esc closes modals,
  Enter submits forms, `/` focuses search. Drag-and-drop is mouse-based.

## Code structure

Plain classic scripts (no ES modules) are used so the app works from
`file://`. Each file attaches to a shared `window.KB` namespace; load order
in `index.html` matters.

| File | Responsibility |
| --- | --- |
| `index.html` | Page skeleton: header, filter bar, board, archive panel, modal/toast roots. Also an inline script that applies the saved theme before first paint. |
| `css/styles.css` | All styling. Theming via CSS custom properties on `:root` with `[data-theme="light"]` overrides; components (columns, cards, chips, modal, toasts) are styled there. |
| `js/state.js` | Data model and persistence: default board, `localStorage` read/write (`kanban.board.v1`), and every mutation (`add/update/delete/move/archive/restore/purge` for cards and columns, label CRUD). |
| `js/filters.js` | Pure filtering logic: reading the active filter values and `matches(card, filters)` with the AND/OR combination rules. |
| `js/dom.js` | Tiny helpers: `h()` element builder, inline SVG icon set, date formatting, `KB.el` selector shortcut. |
| `js/dragdrop.js` | HTML5 drag-and-drop wiring: card drag between/within columns with an insertion-line indicator, column header drag for reordering. |
| `js/modal.js` | Modal system (backdrop, Esc, focus return) plus the card editor, column editor and label manager dialogs. |
| `js/render.js` | Rendering: board → columns → cards, filter bar chips and assignee dropdown, archive panel, and all empty states. |
| `js/app.js` | Bootstrapping and wiring: header actions, filter events, event delegation for board/archive clicks, toasts, theme toggle. |

### Data model

```js
{
  version: 1,
  theme: 'dark' | 'light',
  labels: [ { id, name, color } ],
  columns: [
    { id, title, isDone, cards: [ { id, columnId, title, description, labels: [labelId], assignee, createdAt, updatedAt } ] }
  ],
  archive: {
    cards:    [ /* card records plus archivedAt and fromColumn (origin column title) */ ],
    columns:  [ /* column records with their nested cards, plus archivedAt */ ]
  }
}
```

Everything is saved to `localStorage` under the key `kanban.board.v1` after
every mutation, so a refresh never loses work. If the stored data is missing
or corrupt, a fresh default board (with a few example cards) is created.
