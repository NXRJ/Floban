# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Solo developers and freelancers tracking their own work — between meetings, commits, and side projects. One person, one board, quick capture with no ceremony. The same audience doubles as the evaluator of the app's craft: this is a personal task board that is also meant to impress the person who built and uses it.

## Product Purpose

A personal Kanban board for task management: create, rename, reorder and delete columns; cards with titles, descriptions, colour-coded labels and assignees; drag-and-drop between and within columns; archive with restore; search and combined filtering; dark/light theme. Everything persists to localStorage in the browser — no backend, no accounts.

## Positioning

An extremely high-end frontend showcase and stress test: the UI itself is the statement. The vibe is fun and premium, executed with production-grade craft — it is the benchmark for what frontend work on this machine should look like, not a generic kanban clone. Design quality is a first-class feature; the product truth it carries (real task management, nothing destroyed, everything persisted) must stay intact underneath.

## Operating Context

Opened as a local file or served statically; works offline and without a build step today. Data persists per-browser in localStorage under `kanban.board.v1`. Mouse and keyboard are both used; drag-and-drop is mouse-driven. The user evaluates it both as a daily task tool and as a reference-quality frontend artifact, including via the e2e/headless test workflow already in place.

## Capabilities and Constraints

- Capabilities: columns (add, rename, reorder by header drag, delete with card archiving), cards (title, plain-text description, one or more labels, optional assignee), completion indicator on Done columns, archive + restore + permanent delete, search plus label and assignee filters (AND across categories, OR within labels), dark/light theme, toast feedback, empty states.
- Current implementation: vanilla HTML/CSS/JS, no dependencies, no build step, works from `file://`. These are facts, not commitments: future design work is free to change architecture or add libraries.
- Terminology: board, column, card, label, assignee, archive, Done/completion column.

## Brand Commitments

None binding. The working name is "Kanban" and the agreed direction is fun and premium, but neither is a locked brand commitment.

## Evidence on Hand

No fabricated testimonials, benchmarks, user data or press. The seed cards in the default board are placeholder demo content, not product evidence. A headless e2e suite (49 checks) documents behavior locally; screenshots exist as verification, not as user-facing evidence.

## Product Principles

1. Design is the product: every surface should read as a deliberate, premium artifact, never a default.
2. Fun and premium over neutral: personality is welcome, but never at the cost of clarity or usability.
3. Behavior stays complete: archive/restore, filters, persistence and keyboard support must keep working while the look evolves.
4. Refinement preserves identity and function; a redesign replaces the look, never the product truth.

## Accessibility & Inclusion

No product-specific standard is committed. Existing baseline: keyboard operability, focus-visible outlines, and dark/light contrast work already in the codebase.
