/* The world registry.
 *
 * One entry per world: its id (the `data-theme` value), its display name,
 * the ground it commits to, and its curated accent row. Accents are drawn
 * from the world's own material and each is checked to 4.5:1 against the
 * text it carries, so no choice in the swapper can break contrast or look
 * foreign to the world.
 *
 * Adding a seventh world is an entry here plus a token block in
 * css/worlds.css — no change to styles.css.
 */
(function () {
  var WORLDS = [
    {
      id: 'atelier',
      name: 'Atelier — Ink',
      lineage: 'the ditherpunk desktop, night shift',
      ground: 'dark',
      softAlpha: 0.3,
      accents: [
        { id: 'cyan', name: 'Atelier Cyan', value: '#3fd7e0', on: '#101116' },
        { id: 'violet', name: 'Atelier Violet', value: '#7c3aed', on: '#f5f5f2' },
        { id: 'lime', name: 'Pixel Lime', value: '#a9e020', on: '#101116' },
        { id: 'pink', name: 'Pixel Pink', value: '#b11f75', on: '#f5f5f2' },
        { id: 'orange', name: 'Pixel Orange', value: '#a34800', on: '#f5f5f2' },
        { id: 'green', name: 'Success Green', value: '#31d078', on: '#101116' }
      ]
    },
    {
      id: 'atelier-paper',
      name: 'Atelier — Paper',
      lineage: 'the ditherpunk desktop, day shift',
      ground: 'light',
      softAlpha: 0.22,
      accents: [
        { id: 'cyan', name: 'Atelier Cyan', value: '#0f7f88', on: '#ffffff' },
        { id: 'violet', name: 'Window Violet', value: '#6d30d6', on: '#ffffff' },
        { id: 'green', name: 'Pixel Green', value: '#13643c', on: '#ffffff' },
        { id: 'pink', name: 'Pixel Pink', value: '#b11f75', on: '#ffffff' },
        { id: 'orange', name: 'Pixel Orange', value: '#a34800', on: '#ffffff' },
        { id: 'blue', name: 'Pixel Blue', value: '#2a58c4', on: '#ffffff' }
      ]
    },
    {
      id: 'quarry',
      name: 'Cloud Quarry',
      lineage: 'cut cumulus, void blue, chamfered spec plates',
      ground: 'light',
      softAlpha: 0.32,
      accents: [
        { id: 'void', name: 'Void Blue', value: '#1d6fd0', on: '#ffffff' },
        { id: 'thunder', name: 'Thunder', value: '#47535f', on: '#ffffff' },
        { id: 'saw', name: 'Saw Silver', value: '#5a6b7a', on: '#ffffff' },
        { id: 'strata', name: 'Strata Green', value: '#1c7a52', on: '#ffffff' },
        { id: 'shear', name: 'Wind Shear', value: '#b3301f', on: '#ffffff' }
      ]
    },
    {
      id: 'memphis',
      name: 'Memphis Workshop',
      lineage: 'laminate slabs, terrazzo, a squiggle that refuses to divide',
      ground: 'light',
      softAlpha: 0.3,
      accents: [
        { id: 'bacterio', name: 'Bacterio Pink', value: '#d81e5b', on: '#ffffff' },
        { id: 'cyan', name: 'Laminate Cyan', value: '#00688f', on: '#ffffff' },
        { id: 'ochre', name: 'Lacquer Ochre', value: '#8a5600', on: '#ffffff' },
        { id: 'green', name: 'Terrazzo Green', value: '#1c7a52', on: '#ffffff' },
        { id: 'ink', name: 'Drawing Ink', value: '#1b1b1b', on: '#ffffff' }
      ]
    },
    {
      id: 'lineup',
      name: 'Festival Lineup',
      lineage: 'billing is priority; size carries the hierarchy',
      ground: 'dark',
      softAlpha: 0.4,
      accents: [
        { id: 'flame', name: 'Flame', value: '#ff5a3c', on: '#16215c' },
        { id: 'amber', name: 'Amber', value: '#ffc247', on: '#16215c' },
        { id: 'mint', name: 'Mint', value: '#6ee7a5', on: '#16215c' },
        { id: 'bone', name: 'Bone', value: '#f3efe4', on: '#16215c' }
      ]
    },
    {
      id: 'quote',
      name: 'Industrial Quote',
      lineage: 'ordinary words in straight quotes, hazard stripes, zip ties',
      ground: 'light',
      softAlpha: 0.3,
      accents: [
        { id: 'safety', name: 'Safety Orange', value: '#c24800', on: '#ffffff' },
        { id: 'nylon', name: 'Nylon Black', value: '#141414', on: '#ffffff' },
        { id: 'hi-vis', name: 'Hi-Vis Green', value: '#1c7a52', on: '#ffffff' },
        { id: 'alert', name: 'Alert Red', value: '#b3261e', on: '#ffffff' }
      ]
    },
    {
      id: 'archive',
      name: 'Specimen Archive',
      lineage: 'linen board, foxed stock, brass pins — nothing destroyed',
      ground: 'dark',
      softAlpha: 0.34,
      accents: [
        { id: 'oxblood', name: 'Oxblood', value: '#a8463a', on: '#ffffff' },
        { id: 'brass', name: 'Brass', value: '#c9b489', on: '#2a241d' },
        { id: 'sage', name: 'Herbarium Sage', value: '#7fa86b', on: '#2a241d' },
        { id: 'amber', name: 'Shellac Amber', value: '#cf9b4a', on: '#2a241d' }
      ]
    }
  ];

  var BY_ID = {};
  WORLDS.forEach(function (w) { BY_ID[w.id] = w; });

  // Pre-upgrade builds stored only 'dark' / 'light'. Those are the Atelier's
  // two shifts, so they map rather than reset — a peer on an old build keeps
  // the ground it had.
  var LEGACY = { dark: 'atelier', light: 'atelier-paper' };
  var DEFAULT = 'atelier';

  function normalize(id) {
    if (typeof id !== 'string') return DEFAULT;
    if (BY_ID[id]) return id;
    if (LEGACY[id]) return LEGACY[id];
    return DEFAULT;
  }

  function get(id) { return BY_ID[normalize(id)]; }

  // An accent is only legal inside its own world.
  function normalizeAccent(themeId, accentId) {
    var world = get(themeId);
    var found = null;
    world.accents.forEach(function (a) { if (a.id === accentId) found = a; });
    return found ? found.id : world.accents[0].id;
  }

  function accent(themeId, accentId) {
    var world = get(themeId);
    var id = normalizeAccent(themeId, accentId);
    var found = world.accents[0];
    world.accents.forEach(function (a) { if (a.id === id) found = a; });
    return found;
  }

  // --accent, --on-accent and --accent-soft are ONE token, written in three
  // places: a focus ring is --accent-soft, its outline is --accent, and the
  // text on it is --on-accent. Each world declares the trio in its own block,
  // but the picked accent has to be written inline to outrank that block — and
  // an inline write that sets only two thirds leaves the third pointing at the
  // world's *default* accent, so every focus halo keeps the old colour. The
  // soft alpha is the world's, since it is tuned to the world's depth model,
  // not to the colour.
  function softOf(world, value) {
    var hex = String(value || '').replace('#', '');
    if (hex.length === 3) {
      hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    }
    if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
    var n = parseInt(hex, 16);
    var alpha = typeof world.softAlpha === 'number' ? world.softAlpha : 0.3;
    return 'rgba(' + ((n >> 16) & 255) + ', ' + ((n >> 8) & 255) + ', ' +
      (n & 255) + ', ' + alpha + ')';
  }

  // The single way to put an element into a world. Anything that sets
  // data-theme by hand — the picker's hover preview did — inherits whatever
  // accent was already written inline and previews the world in a colour that
  // does not belong to it.
  function applyTo(root, themeId, accentId) {
    var id = normalize(themeId);
    var a = accent(id, accentId);
    var soft = softOf(get(id), a.value);
    root.dataset.theme = id;
    root.dataset.ground = get(id).ground;
    root.style.setProperty('--accent', a.value);
    root.style.setProperty('--on-accent', a.on);
    if (soft) root.style.setProperty('--accent-soft', soft);
    return a;
  }

  window.KB = window.KB || {};
  window.KB.Themes = {
    all: WORLDS,
    DEFAULT: DEFAULT,
    LEGACY: LEGACY,
    normalize: normalize,
    normalizeAccent: normalizeAccent,
    get: get,
    accent: accent,
    applyTo: applyTo
  };
})();
