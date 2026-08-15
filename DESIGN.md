---
name: Floban
description: One board skeleton, seven design worlds — a token contract that lets a whole visual language be swapped without touching a single component.
colors:
  primary: "#3fd7e0"
  primary-hi: "#7ceaf0"
  on-primary: "#101116"
  accent: "#7c3aed"
  on-accent: "#f5f5f2"
  win-bg: "#5b22c9"
  win-ink: "#f5f5f2"
  success: "#31d078"
  on-success: "#101116"
  danger: "#c81e14"
  warn: "#ffb020"
  bg: "#101116"
  surface: "#1a1c23"
  surface-2: "#22252e"
  surface-3: "#2b2f3a"
  border: "#3a3f4d"
  border-strong: "#4a5161"
  input: "#12141a"
  text: "#f0eee8"
  muted: "#a7adbb"
  faint: "#8b93a3"
  chrome: "#f0eee8"
  shadow-ink: "rgba(0,0,0,0.55)"
  chip-border: "rgba(0,0,0,0.35)"
  ramp-0: "#c81e14"
  ramp-1: "#a34800"
  ramp-2: "#ffd60a"
  ramp-3: "#a9e020"
  ramp-4: "#13643c"
  ramp-5: "#3fd7e0"
  ramp-6: "#2a58c4"
  ramp-7: "#6d30d6"
  ramp-8: "#b11f75"
  logo-red: "#ff4136"
typography:
  display:
    fontFamily: "Press Start 2P, Courier New, monospace"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "1px"
  title:
    fontFamily: "VT323, Courier New, monospace"
    fontSize: "23px"
    fontWeight: 400
    lineHeight: 1.25
    letterSpacing: "0.4px"
  body:
    fontFamily: "VT323, Courier New, monospace"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.3
    letterSpacing: "0.3px"
  small:
    fontFamily: "VT323, Courier New, monospace"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.3
  label:
    fontFamily: "Press Start 2P, Courier New, monospace"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "1px"
rounded:
  none: "0px"
spacing:
  tight: "6px"
  chip: "8px"
  card: "10px"
  board: "16px"
  modal: "18px"
  bar: "10px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.none}"
    padding: "8px 11px"
    typography: "{typography.label}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.none}"
    padding: "8px 11px"
    typography: "{typography.label}"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.none}"
    padding: "8px 11px"
    typography: "{typography.label}"
  chip-label:
    backgroundColor: "{colors.ramp-6}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.none}"
    padding: "3px 9px"
    typography: "{typography.small}"
  card-file:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text}"
    rounded: "{rounded.none}"
    padding: "10px 12px"
  input-field:
    backgroundColor: "{colors.input}"
    textColor: "{colors.text}"
    rounded: "{rounded.none}"
    padding: "6px 10px"
    typography: "{typography.body}"
  window-column:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.none}"
---

# Design System: Floban

> The frontmatter above describes the 8-Bit Atelier specifically, the
> flagship world and the `:root` default. It is not the whole system. Six other
> worlds redefine most of those values; see *The Seven Worlds* below.

## Overview

This is not a themed app. It is one skeleton with seven design worlds.

A theme is usually a palette swap: same shapes, same type, different hues. This
system swaps the whole visual language. A world sets its own type families *and*
scale, corner language, line weights, depth model, texture, motion character,
column width and card composition. Cloud Quarry and Festival Lineup share every
line of component code and have nothing else in common.

That is possible because no component hardcodes an appearance. Every visual
decision in `css/styles.css` reads a custom property, and a world is a block of
~35 properties in `css/worlds.css`. **Adding a seventh world is a data file plus
a token block, no change to any component.**

### The Contract

Seven axes. A world may use this vocabulary plus a short, named list of
structural overrides where its grammar genuinely changes an element's anatomy.

| Axis | Tokens | What it decides |
|---|---|---|
| **Colour** | `--bg` `--surface{,-2,-3}` `--text` `--muted` `--faint` `--border{,-strong}` `--accent` `--primary` `--danger` `--warn` `--success` + their `--on-*` inks | ground, chrome and semantics |
| **Type** | `--font-chrome` `--font-body` `--font-num`, `--fs-*`, `--tracking-*`, `--weight-*`, `--case-chrome`, `--lh-*` | families **and** the size ramp |
| **Shape** | `--r-window` `--r-card` `--r-control` `--r-chip`, `--clip-window` `--clip-card` | corners, including chamfers |
| **Line** | `--bw-window` `--bw-card` `--bw-control` `--bw-hair`, `--border-style-empty` | how heavily things are drawn |
| **Depth** | `--shadow-*` (window, modal, control, lift, press, header…), `--press-shift` | the depth *model*, not one shadow |
| **Texture** | `--tex-ground` `--tex-ground-size`, `--wall-checker`, `--hs-line` | what the ground is made of |
| **Motion** | `--dur-*`, `--ease-*`, `--enter-shift`, `--lift-shift` | the character of every transition |
| **Layout** | `--col-w` `--gap-board` `--pad-card` `--pad-list` `--pad-colhead` | density and composition |

### The Column Ramp

Columns pick a colour by hashing their id to one of nine **slots**, not to a
literal. `js/render.js` writes `data-accent="0..8"` on the `.column`; one
mapping in `styles.css` resolves `--ramp-N` / `--ramp-N-ink` into `--win-bg` /
`--win-ink`.

This is load-bearing. Painting a literal there would emit an *inline style*,
which outranks every world stylesheet. Every world would then wear the
Atelier's palette in its busiest region no matter what its tokens said. The same
reason governs labels: `KB.Dom.paintChip` publishes `--chip-bg` / `--chip-fg` /
`--chip-bd` as properties rather than writing `background` directly, so a world
can reinterpret a label's colour (the Lineup declines the fill entirely and
keeps only the dot).

**Rule: user data may supply a colour, never a rendered declaration.**

## The Seven Worlds

Four dark grounds, three light. Each commits to its own ground; there is no
global light/dark switch, and the sun/moon toggle was replaced by the picker.

### Atelier — Ink *(default, `:root` and `[data-theme="atelier"]`)*
The colored ditherpunk desktop. Square corners, hard pixel offsets, ordered
dithers instead of gradients, Press Start 2P over VT323. Colour is emitted
light: luminous cyan and lime, alpha shadows. Motion is `steps()`: nothing
tweens. The flagship; every other world is measured against it.

### Atelier — Paper
The same desktop *printed* rather than emitted. The distinction is not the
background value: pigment sits **on** stock, so the nine slots are re-mixed as
denser printing inks, depth becomes a **solid** offset (a two-pass print
misregistering, not a glow), and the ground carries a halftone dot screen over
laid-paper grain.

### Cloud Quarry
Cut cumulus, void blue, chamfered spec plates. Cards are **spec plates**: a
stencilled plate number in a colour block, a data table, a status row. The
number is a CSS counter, a *position* in the cut list, so it renumbers itself
when cards move. Saira Stencil One over Archivo, Roboto Mono for measures. The
ground is a survey grid with major and minor divisions. Depth is a plate lying
on fog; corners are `clip-path` chamfers, never radii.

### Memphis Workshop
Laminate slabs, terrazzo speckle, a squiggle that refuses to be a divider.
Archivo Black over Figtree. The pill and the slab together, on purpose: 14px
card radius against fully round controls. Depth is a hard black outline offset,
the way a Sottsass object is drawn before it is built. The one world that
overshoots: a light plastic slab set down rebounds.

### Festival Lineup
No chrome at all. **Billing is priority**: hierarchy is carried by type size and
nothing else. Cards expose `data-priority`, and titles step 36 → 27 → 21 → 17 →
15px, with case and colour shifting alongside. There is no border, no shadow,
and no chip to hide behind; the priority badge is visually hidden but kept for
assistive tech, which cannot perceive the ladder replacing it. Anton over
Archivo Narrow on a navy poster ground with a stage wash from above.

### Industrial Quote
Stockroom cotton and nylon. Ordinary words set in straight quotes (`.col-title`
gains `"` on both sides), hazard stripes laid under the ground, and zip-tie
heads on tags. Archivo Black over Archivo, flat screen-print offsets. A column
over its WIP limit takes the hazard stripe across its header: **state, not
decoration**.

### Specimen Archive
Linen board carrying foxed card stock: the only world whose cards are *light on
a dark ground*. Zilla Slab over Spectral, brass pins, oxblood and sage. Depth is
a vitrine lit from above; motion is the slow settle of something set down
carefully. Nothing is ever destroyed; the archive is a collection.

> **Extending the Archive:** it is the only world whose `--text` has no contrast
> against its `--surface-2`. Every element sitting on a card must state its ink
> explicitly. A new card child that simply inherits `--text` will be invisible
> here and nowhere else.

## What Does Not Vary

The worlds differ in almost everything. These hold across all seven, and a
change to any of them is a change to the system, not to a world.

**The Contrast Commitment.** Every colour pairing resolves to at least 4.5:1:
the semantic tokens against their `--on-*` inks, all nine ramp slots against
their inks, and every curated accent in `js/themes.js` against the text it
carries. `--success` is a status green, light in some worlds and dark in others,
so it carries its own `--on-success` rather than borrowing another ink.

**Colour is never the only carrier.** Priority reads as size in the Lineup and
as a chip elsewhere; done state is a check mark, not a fill; WIP overflow is a
stripe *and* a count. No world may make a state colour-only.

**No side stripes.** A coloured border stripe never carries meaning. State lives
in title bars, badges, checks and headers.

**Motion is one choreography, seven characters.** `js/motion.js` decides *when*
something animates; the world decides *how*. Cards animate on genuine arrival
only; the board is re-rendered wholesale, so "appeared in the DOM" is not "is
new", and arrivals are tracked by id across renders. Everything is disabled
under `prefers-reduced-motion`.

**Theme switching cross-fades.** Changing world runs through
`document.startViewTransition` where available, falling back to a plain swap.

## Layout

Columns tile as windows at `--col-w` (290-320px depending on world), spaced by
`--gap-board`, distributed `space-evenly` up to a 1480px centered desk, then
scrolling left-aligned. Vertical rhythm is tight: 6px inside control groups, 8px
between chips, `--gap-card` between cards, `--pad-board` around the bench.

### Mobile

At ≤640px the bench collapses into a scroll-snapped pager: one column per
screen plus a hint of the next, a pager strip (Filters toggle, ◀ ▶, one dot per
column), and a fixed bottom tab bar. The filter bar becomes a collapsible
drawer. Hover-only menus become bottom sheets.

**The actions gutter.** On desktop the card action cluster appears on hover, so
it may overlay the title harmlessly. At ≤640px it is *always* shown and
absolutely positioned, so `--actions-gutter` reserves space in `.card-top` or
the first line runs underneath the button, worst in worlds with large titles.
The Quarry restates the reserve in `worlds.css` because its own card padding
ties on specificity and wins on source order.

## Components

Components are described here in their **Atelier** form, because that is the
`:root` default. Read every value below as "unless the world says otherwise":
the shape, weight, depth and type will differ elsewhere, but the anatomy will
not.

### Buttons
Square, `--bw-control` border, `--shadow-control`, chrome font at `--fs-chrome`.
**Primary** is the board's one loud action; **ghost** is transparent with muted
text; **danger** fills with `--danger`. Icon buttons are 34px (26px small).
Pressed buttons translate `--press-shift` into their own shadow.

### Chips
A painted chip carries `--chip-bg` with ink resolved for contrast, plus the
world's `--chip-border`. Unpainted chips fall back to `--surface-3` and
`--text`. Filter chips toggle active; card labels are static paint; assignee
chips are chrome-outlined.

### Cards
`--surface-2` at `--pad-card`, `--r-card` corners, `--bw-card` border, flat at
rest with `--shadow-lift` on hover. Title at `--fs-title`, description clamped
to two lines in `--muted`, meta chips below. Done cards carry a check, never a
fill. Cards expose `data-id` and `data-priority`.

### The Column Window
A window with an accent title bar and a file list. Title bars take their slot
from `.column[data-accent]`, so the board reads as a wall of coloured windows
whose colours are stable across reloads and *correct for the active world*.
Dragging cuts a hole with marching ants; the landing slot blinks.

### The World Picker
Replaces the old theme toggle. Every world is a **live thumbnail carrying its
own `data-theme`**: a miniature of the board rendered in that world's real
tokens, not a colour chip, so the choice is made on the thing itself. Hovering
previews the world on the whole document; Escape restores, Done commits.
Beneath sits the active world's curated accent row.

*This is why the Atelier needs an explicit `[data-theme="atelier"]` selector
even though it is also `:root`: without it, a subtree cannot be put into the
Atelier, and its own thumbnail would render in whatever world is active.*

## Do's and Don'ts

### Do
- **Do** add appearance as a token first. If a component needs a literal, the
  contract is missing a token.
- **Do** give a new world a full position on all seven axes. A block that only
  changes colours is a palette swap, which is the thing this system exists to
  avoid.
- **Do** check every new colour pair to 4.5:1, including all nine ramp slots
  and every curated accent.
- **Do** let a world override the *declaration* when it must reinterpret user
  data; overriding an inline custom property will silently lose.

### Don't
- **Don't** write appearance from JavaScript. An inline style outranks every
  world stylesheet and cannot be themed.
- **Don't** let a colour stripe carry meaning, or a state be colour-only.
- **Don't** animate on load or on every render; motion belongs to genuine
  arrivals, drag-and-drop, and window mechanics.
- **Don't** assume the Atelier's rules elsewhere: square corners, `steps()`
  motion and hard offsets are *that world's* position, not the system's.
