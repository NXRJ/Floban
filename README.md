# Kanban

A personal Kanban board built with vanilla HTML, CSS and JavaScript. No build step,
no framework, no backend — everything runs in the browser and persists to `localStorage`.

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

## Features

### Boards
- Multiple boards, switched from the board menu in the header (also: new, rename,
  duplicate, delete). Deleting a board keeps an Undo toast nearby — nothing is
  unrecoverable.
- Every board has its own labels, templates, columns and archive.

### Board & columns
- Default columns: **To Do**, **In Progress**, **Done**.
- Add columns with the **New column** button in the header.
- Rename a column via its `⋯` menu (also lets you mark a column as a
  **completion column**, which shows checkmarks on its cards).
- Set a **WIP limit** per column (0 = none); the count badge becomes `n/limit`
  and turns red when the column is over its limit.
- **Collapse/expand** a column to a title bar with the chevron on the header.
- Reorder columns by dragging a column header (drag from the title/grip area,
  not from the buttons).
- Columns are spaced evenly across the board and re-balance as you add or
  remove columns; when they overflow the window they switch to left-aligned
  scrolling with a fixed gap.
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
- Due dates render as chips: red when **overdue**, amber when due today or
  tomorrow. Filter by overdue / today / this week / none, or sort the whole
  board by due date, created or last updated (sorting disables card
  drag-reordering until you switch back to manual order).
- Cards show an **aging chip** (`3D`) once they have sat in a column for more
  than a day.
- Duplicate a card from its hover buttons or the editor, or save any card as a
  **template** and re-create it from any column's quick-add menu.
- Cards in a column marked as a completion column (the default **Done** column)
  show a green checkmark badge and a green left border.
- Drag cards between columns and reorder them within a column. A blue insertion
  line shows exactly where the card will land. Dropping a card on a column
  header appends it to the end of that column.

### Undo & redo
- Every mutation is tracked in memory: press **Ctrl/Cmd+Z** to undo and
  **Ctrl/Cmd+Shift+Z** (or Ctrl+Y) to redo — including board switches.
- Destructive actions (archive, delete, purge, restore, duplicate, board
  delete) also show a toast with an **Undo** button for the same 3-second
  window.

### Archiving
- Cards can be soft-deleted to the **Archive** panel (button in the header).
- Deleting a column archives the column together with its cards.
- In the archive you can **Restore** items or **Delete forever** (both
  undoable via toast or Ctrl+Z).
- Restore behaviour:
  - A restored card returns to its original column if that column still exists;
    otherwise it goes to the first column (a "To Do" column is created if the
    board is empty).
  - A restored column is appended at the end of the board with its cards.

### Search & filters
- The search bar matches card **title and description** (case-insensitive).
- Filter by **label** (click label chips in the filter bar), by **assignee**
  (dropdown, including an "Unassigned" option) and by **due date**.
- Filters combine with AND logic across categories (search *and* labels *and*
  assignee *and* due), while multiple selected labels match a card if it has
  *any* of them (OR within the label group).
- **Sort** cards within each column (manual / due date / created / last
  updated) from the filter bar.
- Press `/` anywhere to jump to the search box. "Clear filters" resets
  everything.

### Backup
- From the board menu: **Backup / restore** exports all boards (or just the
  current one) to a JSON file, and imports a backup back — everything lives in
  `localStorage` only, so take one before clearing the browser.

### Theme
- Dark/light toggle in the header, applied consistently across the whole app
  and remembered across reloads.

### Feedback & empty states
- Toasts confirm every action (added, saved, archived, restored, deleted) and
  carry **Undo** for destructive ones.
- Dedicated empty states: empty board, empty column ("drop cards here"),
  and a "no cards match your filters" banner with a clear-filters shortcut.
- Keyboard works throughout: Tab + Enter for buttons, Esc closes modals,
  Enter submits forms, `/` focuses search, `N` focuses quick-add, `C` opens
  the column editor, Ctrl/Cmd+Z / +Shift+Z undo/redo. Drag-and-drop is
  mouse-based.

## Code structure

Plain classic scripts (no ES modules) are used so the app works from
`file://`. Each file attaches to a shared `window.KB` namespace; load order
in `index.html` matters.

| File | Responsibility |
| --- | --- |
| `index.html` | Page skeleton: header (board switcher), filter bar, board, archive panel, modal/toast roots. Also an inline script that applies the saved theme before first paint. |
| `css/styles.css` | All styling. Theming via CSS custom properties on `:root` with `[data-theme="light"]` overrides; components (columns, cards, chips, popups, modal, toasts) are styled there. |
| `js/state.js` | Data model and persistence: multi-board store, `localStorage` read/write (`kanban.board.v1`, version 2 with v1 migration), undo/redo history, and every mutation (card/column/label/template/board CRUD, move, archive, restore, purge, duplicate, export/import). |
| `js/filters.js` | Pure filtering and sorting logic: reading the active filter values, `matches(card, filters)` with the AND/OR combination rules, due-date matching, and the sort comparator. |
| `js/dom.js` | Tiny helpers: `h()` element builder, inline SVG pixel-icon set, date formatting, `KB.el` selector shortcut. |
| `js/dragdrop.js` | HTML5 drag-and-drop wiring: card drag between/within columns with an insertion-line indicator, column header drag for reordering (card drag is disabled while a non-manual sort is active). |
| `js/modal.js` | Modal system (backdrop, Esc, focus return) plus the card editor (due date, checklist, templates), column editor (WIP limit), board prompt, label manager and backup/restore dialogs. |
| `js/render.js` | Rendering: board → columns → cards (due chips, checklist progress, aging chips), filter bar chips and dropdowns, quick-add rows, archive panel, and all empty states. |
| `js/app.js` | Bootstrapping and wiring: header actions (board menu, theme), filter/sort events, event delegation for board/archive clicks, quick-add, popups, undo/redo shortcuts, toasts, export downloads. |

### Data model

```js
{
  version: 2,
  theme: 'dark' | 'light',
  activeBoardId: '…',
  boards: [
    {
      id, name,
      labels: [ { id, name, color } ],
      templates: [ { id, title, description, labels: [labelId], assignee, checklist: [{ id, text, done }] } ],
      columns: [
        { id, title, isDone, wipLimit, collapsed, cards: [
          { id, columnId, title, description, labels: [labelId], assignee,
            createdAt, updatedAt, movedAt, due: 'YYYY-MM-DD' | '',
            checklist: [{ id, text, done }] }
        ] }
      ],
      archive: {
        cards:    [ /* card records plus archivedAt and fromColumn (origin column title) */ ],
        columns:  [ /* column records with their nested cards, plus archivedAt */ ]
      }
    }
  ]
}
```

Everything is saved to `localStorage` under the key `kanban.board.v1` after
every mutation, so a refresh never loses work. Data saved by older versions
(`version: 1`) is migrated automatically on first load, and corrupt or
malformed payloads are repaired on load rather than crashing. If the stored
data is missing or corrupt, a fresh default board (with a few example cards)
is created.

## Testing

The app itself needs nothing installed, but a headless end-to-end suite
documents the behaviour of every feature (boards, undo/redo, due dates,
checklists, quick-add, templates, WIP limits, collapse, backup, filters,
sorting, migration, corrupt-data resilience, markdown/XSS safety):

```sh
npm install   # once — brings in puppeteer for the test runner only
npm test      # runs tests/kanban-smoke.js against the built-in browser
```
