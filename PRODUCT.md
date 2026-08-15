# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Solo developers and freelancers tracking their own work between meetings, commits, and side projects. One person, one board, quick capture without ceremony. The same audience is also the evaluator of the app's craft: this is a personal task board that is also meant to impress the person who built and uses it.

## Product Purpose

A personal, flow-aware board (Floban) for task management: multiple boards with a switcher; create, rename, reorder, collapse and delete columns; cards with titles, descriptions (light markdown), colour-coded labels, assignees, due dates and checklists; templates and duplication; WIP limits; drag-and-drop between and within columns; archive with restore; undo/redo; search, due-date filters and sorting; JSON backup/export; seven switchable design worlds. Everything persists locally in the browser (IndexedDB with a localStorage crash mirror and rotating automatic backups). There is no backend and no accounts.

## Positioning

An extremely high-end frontend showcase and stress test: the UI itself is the statement. The vibe is fun and premium; the execution has production-grade craft. It is the benchmark for what frontend work on this machine should look like, not a generic kanban clone. Design quality is a first-class feature; the product truth it carries (real task management, nothing destroyed, everything persisted) must stay intact underneath.

## Operating Context

Opened as a local file or served statically, it works offline and without a build step today. Data persists per-browser in IndexedDB, with an atomic localStorage crash-mirror envelope (`kanban.mirror.v1`) and rotating automatic backups. Mouse and keyboard are both used; drag-and-drop is mouse-driven. The user evaluates it both as a daily task tool and as a reference-quality frontend artifact, including via the e2e/headless test workflow already in place.

## Capabilities and Constraints

- Capabilities: boards (create, rename, duplicate, delete, switch), columns (add, rename, reorder by header drag, collapse, delete with card archiving, WIP limits), cards (title, markdown-lite description, one or more labels, optional assignee, due date, checklist with progress, aging indicator), templates, card duplication, completion indicator on Done columns, undo/redo, archive + restore + permanent delete, search plus label/assignee/due filters and sorting, JSON backup/export/import, seven switchable design worlds, toast feedback with undo, empty states.
- Current implementation: vanilla HTML/CSS/JS, no dependencies, no build step, works from `file://`. These are facts, not commitments: future design work is free to change architecture or add libraries.
- Terminology: board, column, card, label, assignee, archive, Done/completion column.

## Brand Commitments

None binding. The working name is "Kanban" and the agreed direction is fun and premium, but neither is a locked brand commitment.

## Evidence on Hand

No fabricated testimonials, benchmarks, user data or press. The seed cards in the default board are placeholder demo content, not product evidence. A headless e2e suite under `tests/kanban-smoke.js` (run with `npm test`) documents behavior locally; screenshots exist as verification, not as user-facing evidence.

## Product Principles

1. Design is the product: every surface should read as a deliberate, premium artifact, never a default.
2. Fun and premium over neutral: personality is welcome, but never at the cost of clarity or usability.
3. Behavior stays complete: archive/restore, filters, persistence and keyboard support must keep working while the look evolves.
4. Refinement preserves identity and function; a redesign replaces the look, never the product truth.

## Accessibility & Inclusion

No product-specific standard is committed. Existing baseline: keyboard operability, focus-visible outlines, and dark/light contrast work already in the codebase.
