---
name: Kanban
description: A colored ditherpunk desktop kanban — a love letter to retro computing, executed with modern craft.
colors:
  primary: "#3fd7e0"
  primary-hi: "#7ceaf0"
  on-primary: "#101116"
  accent: "#8b5cf6"
  on-accent: "#f5f5f2"
  win-bg: "#5b22c9"
  win-ink: "#f5f5f2"
  success: "#31d078"
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
  pixel-red: "#c81e14"
  pixel-orange: "#a34800"
  pixel-yellow: "#ffd60a"
  pixel-lime: "#a9e020"
  pixel-green: "#13643c"
  pixel-cyan: "#3fd7e0"
  pixel-blue: "#2a58c4"
  pixel-violet: "#6d30d6"
  pixel-pink: "#b11f75"
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
    backgroundColor: "{colors.pixel-blue}"
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

# Design System: Kanban

## Overview

**Creative North Star: "The 8-Bit Atelier"**

A love letter to retro computing, executed with modern craft: the board is a desktop of pixel windows and paper files, where every gray is an ordered dither, every corner is square, every shadow is a hard pixel offset, and every blend is a deliberate texture rather than a gradient. The world is playful and vividly colored — title bars wear nine saturated accent colors, labels are painted chips, Done is a green check — but nothing is casual: the system is a workshop bench where each part sits exactly where it was milled.

The atelier runs in two shifts: the ink desktop (deep charcoal ground, white chrome, for late-night work under dim light) and the paper desktop (warm off-white ground, ink chrome, for daylight). Both carry the same vivid pixel palette; only the ground and chrome invert. Motion is discrete, mechanical, and restrained to one authored moment — the drag-and-drop: dragging a card cuts a hole in its column with marching ants, and the drop target blinks a pixel line. Everything else lands instantly, like a window snapping shut.

**Key Characteristics:**
- Square corners everywhere; zero radius is a rule, not an omission.
- Depth is hard offset shadows (no blur) or 1px chrome borders — never both at once on one element.
- Dithers stand in for every blend; gradients do not exist in the system.
- Color is structural: column title bars, labels, and state (Done/success/danger) own whole regions.
- Two fonts only: Press Start 2P for chrome, VT323 for body. Nothing else.

## Colors

Nine vivid pixel colors (the palette of a classic machine's usable spectrum) carry meaning across title bars, labels, and state; neutrals carry the machine itself.

### Primary
- **Atelier Cyan** (#3fd7e0): the primary action. "New column", Save buttons, selected states. Text on it is ink (#101116) — the one light color that carries dark text.
- **Atelier Cyan High** (#7ceaf0): primary hover.
- **On Primary** (#101116): ink text on cyan.

### Secondary
- **Atelier Violet** (#8b5cf6): focus outlines, the drag drop-line, selection color, decorative accents. Structural violet for focus and windows lives darker as **Window Violet** (#5b22c9 / #6d30d6 light) so white chrome text holds 4.5:1.
- **On Accent** (#f5f5f2): white chrome text for dark fills.

### Tertiary
- **Success Green** (#31d078): done checkmarks, success toasts, completed state.
- **Danger Red** (#c81e14): destructive actions, delete, error toasts, archive badge.
- **Warn Amber** (#ffb020): caution toasts.

### Neutral
- **Ink Ground** (#101116): dark desktop. **Paper Ground** (#e8e6df): light desktop.
- **Window Face** (#1a1c23 / #f6f4ee): columns, modals, panels, header.
- **File Face** (#22252e / #ece9e1): cards.
- **Button Face** (#2b2f3a / #e0ddd4): buttons, chips at rest.
- **Machine Chrome** (#f0eee8 / #17181d): borders, chrome text, ants; the theme's inverted accent.
- **Text** (#f0eee8 / #17181d), **Muted** (#a7adbb / #585e6b), **Faint** (#8b93a3 / #5a6172): the three-step voice.
- **Ink Shadow** (rgba(0,0,0,.55) / rgba(23,24,29,.28)): the one shadow color.
- **Chip Border** (rgba(0,0,0,.35)): the one border carried by painted chips in both themes.

### The Pixel Palette
- **Pixel Red** (#c81e14), **Pixel Orange** (#a34800), **Pixel Yellow** (#ffd60a), **Pixel Lime** (#a9e020), **Pixel Green** (#13643c), **Pixel Cyan** (#3fd7e0), **Pixel Blue** (#2a58c4), **Pixel Violet** (#6d30d6), **Pixel Pink** (#b11f75): the label palette and the column title-bar accents. Each is chosen so its fill and its readable text (ink or white, per luminance) hold 4.5:1. Yellow, lime and cyan carry ink text; the rest carry white.
- **Logo Red** (#ff4136): the brand mark's red square, alongside Logo Yellow (pixel-yellow), Logo Cyan (primary), and Logo Violet (accent). The four-square mark appears in the favicon, the menu bar, and the homescreen title; its colors never carry UI meaning.

### Named Rules
**The Dither Rule.** Every blend in the system is an ordered dither — a repeating conic checker or marching-ant dash — never a gradient. A gradient anywhere is a foreign object.
**The Contrast Commitment.** Every colored fill in the system already resolves its own text color (ink or white) for 4.5:1; new label colors must pass the same test before they enter the palette.

## Typography

**Display Font:** Press Start 2P (fallback: Courier New, monospace)
**Body Font:** VT323 (fallback: Courier New, monospace)

**Character:** A machine's two voices: the chunky pixel caps of the window chrome, and the soft CRT glow of the reading text. Chrome never carries more than a word; body never dresses up.

### Hierarchy
- **Display** (400, 11px, 1.5, +1px): window titles, buttons, field labels, section titles, the clock, the logo. Chrome only — short strings, never paragraphs.
- **Title** (400, 23px, 1.25, +0.4px): card titles, archive item titles. The only 23px step.
- **Body** (400, 18px, 1.3, +0.3px): card descriptions, inputs, toasts, empty states.
- **Small** (400, 16px, 1.3): card meta, chips, list hints, form hints, archive meta.
- **Label** (400, 11px, 1.5, +1px): the chrome voice on buttons and field names, uppercased by convention.

### Named Rules
**The Two-Voice Rule.** Chrome is Press Start 2P at 11px, body is VT323 at 16/18/23px — there is no third face and no middle size between 11 and 16. A size outside the ramp is a defect, not a token. The one documented exception is **micro-chrome at 9px** — PS2P 9px, letter-spacing 1px — reserved for hint text, shortcut chips, count badges, and pager labels where 11px would crowd the row (palette footer/hints, sheet and palette shortcut chips, bottom-tab labels and badges, snapshot timestamps). Nothing else drops below 11.

## Layout

The desktop is a single horizontal bench: columns tile as windows (fixed 300px), spaced with a 16px rhythm, and the bench distributes them evenly across the width (`space-evenly` up to a 1480px centered desk). When columns outgrow the desk, the bench scrolls left-aligned with the fixed gap. Vertical rhythm is tight by design: 6px inside control groups, 8px between chips, 10px between cards, 16px between windows, 18px inside modals. Cards sit 10px apart in a column with a 10px inset; the column list is the only scrolling region besides the bench itself. At 640px and below the search field takes the full row, the clock hides, and header buttons collapse to icons.

## Elevation & Depth

Depth is mechanical, not atmospheric: no blur, no softness. Windows, modals, panels and toasts cast a hard offset shadow (4px 4px 0 ink-shadow; 6px for modals; 3px for buttons and small controls); the menu bar casts a 4px floor shadow. Cards are flat at rest and gain a 3px hard shadow on hover — a lift, never a glow. Depth is a response to interaction; resting surfaces are flat.

### Shadow Vocabulary
- **Window cast** (`box-shadow: 4px 4px 0 rgba(0,0,0,.55)`): columns, archive panel, board dialogs.
- **Modal cast** (`box-shadow: 6px 6px 0 var(--shadow-ink)`): the one deep shadow; modals are the topmost windows.
- **Control cast** (`box-shadow: 3px 3px 0 var(--shadow-ink)`): buttons, toasts, small panels; pressed buttons translate 2px into their shadow.
- **Card lift** (`box-shadow: 3px 3px 0 var(--shadow-ink)`): hover only.

### Named Rules
**The Press Rule.** A button pressed is a button moved: `:active` translates 2px into its own shadow and shrinks the shadow to 1px. Nothing fades, glows, or scales on press.

## Shapes

Square, everywhere: the system's radius is zero and there is no rounding anywhere — not on cards, buttons, chips, inputs, or windows. Borders are 1px chrome hairlines or 2px machine borders; windows use 2px strong borders; selection and focus use a 2px dashed violet outline. Icons are drawn as crisp-edge pixel rects on a 16px grid, never outlined glyphs.

## Components

### Buttons
- **Shape:** square (0px), 2px border, hard 3px shadow, Press Start 2P 11px with +0.5px tracking.
- **Primary:** Atelier Cyan fill with ink text; hover Cyan High. The board's one loud action.
- **Ghost:** transparent fill, muted text, no shadow — secondary actions (Cancel, Add label, Remove).
- **Danger:** Danger Red fill with white text; hover brightens. Ghost-danger: red text on transparent, fills on hover.
- **Icon:** square 34px (26px small) with a 16px pixel icon.
- **Hover / Focus:** hover inverts fill against chrome; active presses into the shadow; focus is a 2px dashed violet outline.

### Chips
- **Style:** a painted square (0px radius), label-color fill, ink or white text by luminance, 2px dark border, 16px VT323. Active chips add a 2px text-colored border and a hard shadow.
- **State:** filter chips toggle active; label chips on cards are static paint; assignee chips are chrome-outlined with a person pixel.

### Cards / Containers
- **Corner Style:** square (0px).
- **Background:** File Face (#22252e dark / #ece9e1 light).
- **Shadow Strategy:** flat at rest; hard 3px lift on hover.
- **Border:** 2px machine border, brightening to text-color on hover.
- **Internal Padding:** 10px 12px. Title 23px, description clamped to two lines in Muted, meta chips below.
- **Done cards:** carry a green check pixel in a Success square; no stripes, no fills.

### Inputs / Fields
- **Style:** 2px machine border on Input Face, VT323 18px, square.
- **Focus:** border swaps to violet with a 2px violet-soft hard offset; caret is violet.
- **Disabled / Error:** disabled is 45% opacity; errors are toast-level red, never inline glow.

### Navigation
- **Menu bar:** Window Face with a 2px chrome floor and a 4px shadow; KANBAN wordmark with the four-square pixel logo; the board switcher (board icon, board name, caret — opens the board/backup menu); New column (cyan), Labels (violet icon), Archive (red trash + badge), the clock, and the sun/moon theme toggle. At 640px labels hide, clock hides.
- **Column window header:** the title bar is the column's accent (one of the nine), carrying its own ink-or-white text and a 2px rule; the count badge inverts bar text onto bar fill; grip, add and menu live on the bar.

### Signature Component: The Column Window
A window with an accent title bar and a file list. Title bars are painted per-column from the nine-pixel palette (deterministic hash of the column id), so the board reads as a wall of colored windows whose colors are stable across reloads. The card list is the window's interior: paper files that drag between windows; dragging cuts a hole (marching ants around the source) and the landing slot blinks a violet pixel line.

### Command Palette (Ctrl/Cmd+K)
A centered window (`min(560px, 94vw)`) at 12vh, square, 2px strong border, 6px modal cast, `win-in` in four steps. A violet title bar reads `COMMANDS`; beneath it a full-width search field (input face, violet focus ring). Results are `listbox` rows: 16px pixel icon, VT323 18px title, and a PS2P 9px shortcut chip on the right. The selected row inverts to accent fill with white chrome — the same selected-chip state as filters. A PS2P 9px footer shows `↑↓ MOVE · ENTER RUN · ESC CLOSE`. Category labels are PS2P 9px muted chrome. The palette opens above everything except the homescreen (z 75) and closes instantly on Escape or run.

### Action Sheets
On touch screens, hover-only menus become bottom sheets: a full-width window docked to the bottom edge with a 2px strong top border and a hard 4px upward cast, entering with `sheet-in` in four steps (`translateY(100%) → 0`). The violet title bar carries the sheet's name (card title, `COLUMN`, or `KANBAN MENU`); rows are VT323 18px items with a 16px pixel icon, label, and optional shortcut chip. Rows hover/focus on surface-2 with a strong border and press 2px into the sheet. The sheet sits above modals (z 55) but below toasts; `env(safe-area-inset-bottom)` pads the list so the dock never hides under an iPhone home bar.

### Mobile: The Board Becomes a Pager
At ≤640px the bench collapses into a single-column pager: each column window is `calc(100% - 24px)` wide with `scroll-snap-align: center`, so the board swipes like a machine dial and always shows one window plus a hint of the next. A pager strip under the header holds the **Filters** toggle (chip, accent-filled while filters are active), ◀ ▶ arrows (disabled at the ends), and one 10px square dot per column — the active dot is accent-filled with a 1px ink shadow, exactly like an active filter chip. Workspace switching moves to a fixed bottom tab bar (Board / Desk / Inbox / Review) with 18px pixel icons and PS2P 9px labels; the active tab inverts to surface-2 with an accent icon. The filter bar becomes a collapsible drawer under the header (max-height steps transition, 52vh at most, internally scrollable). Touch targets grow: cards keep the 23px title but add padding, quick-add becomes 44px tall, and the card's hover actions collapse to a single 34px `⋯` that opens the card's action sheet. No new fonts, sizes outside the 11/16/18/23 ramp, radii, gradients, or blur enter the system on mobile — the pager, tabs, palette, and sheets all use the same chrome, shadows, and steps motion as the desktop.

### Motion
- **The one authored moment:** drag-and-drop — marching ants (0.6s, steps(1)) around the cut hole, blinking drop line (0.5s, steps(1)).
- **Everything else is mechanical:** modal windows pop in at 0.18s in four steps; toasts step in at 0.16s; the archive panel slides in five steps over 0.2s; buttons press instantly. No tweening, no easing curves, no entrance choreography on page load.
- **Reduced motion:** all steps-based animation is disabled under
  `prefers-reduced-motion` — including the palette, action sheets, and the
  filter-bar drawer (their keyframes are on the same kill-list as the modal
  and toast).

## Do's and Don'ts

### Do:
- **Do** keep every corner square and every shadow a hard offset with zero blur.
- **Do** let the nine pixel colors own whole regions — title bars, labels, state — and keep each fill's ink-or-white text at 4.5:1.
- **Do** cut one font from each world: Press Start 2P for chrome, VT323 for body, sizes from the ramp (11/16/18/23) only.
- **Do** keep the board bench even-spaced and centered until it overflows, then scroll left-aligned.

### Don't:
- **Don't** introduce gradients, glass, glow, blur, or rounded corners — the dither and the hard shadow are the system's only depth and blend devices.
- **Don't** animate anything on load, hover, or theme change; motion belongs to drag-and-drop and window mechanics.
- **Don't** add a third typeface, a size outside the ramp, or emoji/Unicode glyphs in place of the pixel icon set.
- **Don't** let a colored border stripe carry meaning — state lives in title bars, badges, and checks, never side stripes.
