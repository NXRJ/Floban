/* The world picker.
 *
 * Replaces the old sun/moon toggle. Every world is shown as a thumbnail
 * rendered in its OWN tokens — the swatch is a miniature of the board, not
 * a colour chip, so the choice is made on the thing itself. Beneath the
 * active world sits its curated accent row.
 *
 * Keyboard: Tab moves between worlds, Enter commits, Escape closes and
 * restores whatever was active on open. Opening is by the header button or
 * the "Change world…" command — there is no single-key shortcut, because `t`
 * already belongs to the Date Desk.
 */
(function () {
  var KB = window.KB;
  var open = false;
  var panel = null;
  var restore = null;

  function h(tag, attrs, text) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    if (text != null) el.textContent = text;
    return el;
  }

  /* A miniature of the board, rendered in the world's own tokens. Scoped by
   * data-theme on the thumbnail itself, so each preview is genuinely that
   * world's ground, chrome, corner language and depth — not a swatch row. */
  function thumb(world) {
    var t = h('span', { class: 'world-thumb', 'data-theme': world.id });
    t.appendChild(h('span', { class: 'world-thumb-bar' }));
    var body = h('span', { class: 'world-thumb-body' });
    for (var i = 0; i < 3; i++) body.appendChild(h('span', { class: 'world-thumb-card' }));
    t.appendChild(body);
    return t;
  }

  function accentRow(world, activeAccentId, onPick) {
    var row = h('div', { class: 'world-accents', role: 'radiogroup', 'aria-label': 'Accent colour' });
    world.accents.forEach(function (a) {
      var b = h('button', {
        type: 'button',
        class: 'world-accent' + (a.id === activeAccentId ? ' active' : ''),
        role: 'radio',
        'aria-checked': a.id === activeAccentId ? 'true' : 'false',
        'aria-label': a.name,
        title: a.name
      });
      b.style.setProperty('--swatch', a.value);
      b.addEventListener('click', function () { onPick(a.id); });
      row.appendChild(b);
    });
    return row;
  }

  function close(commit) {
    if (!open) return;
    open = false;
    if (!commit && restore) {
      KB.State.setTheme(restore.theme);
      KB.State.setAccent(restore.accent);
      KB.App.applyTheme();
    }
    if (panel) panel.remove();
    panel = null;
    document.removeEventListener('keydown', onKey, true);
    var btn = KB.el('open-worlds');
    if (btn) btn.focus();
  }

  function onKey(e) {
    if (!open) return;
    if (e.key === 'Escape') { e.preventDefault(); close(false); return; }
    if (e.key === 'Enter') { e.preventDefault(); close(true); }
  }

  function render() {
    var current = KB.State.data();
    var activeId = KB.Themes.normalize(current.theme);
    var activeAccent = KB.Themes.normalizeAccent(activeId, current.accent);

    if (panel) panel.remove();
    panel = h('div', { class: 'world-backdrop' });

    var box = h('div', {
      class: 'world-panel',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': 'Choose a world'
    });
    var head = h('h2', { class: 'world-head' }, 'Worlds');
    box.appendChild(head);

    var grid = h('div', { class: 'world-grid' });
    KB.Themes.all.forEach(function (w) {
      var item = h('button', {
        type: 'button',
        class: 'world-item' + (w.id === activeId ? ' active' : ''),
        'aria-pressed': w.id === activeId ? 'true' : 'false'
      });
      item.appendChild(thumb(w));
      item.appendChild(h('span', { class: 'world-name' }, w.name));
      item.appendChild(h('span', { class: 'world-lineage' }, w.lineage));
      item.addEventListener('click', function () {
        // The one moment where all seven worlds meet: cross-fade the whole
        // document rather than snapping every surface at once. Falls back to a
        // plain swap where view transitions are unavailable or unwanted.
        KB.Motion.switchWorld(function () {
          KB.State.setTheme(w.id);
          KB.App.applyTheme();
          render();
        });
      });
      // Previewing on hover is the whole point of a world picker — but the
      // preview has to be the whole world. Setting data-theme alone leaves the
      // active world's accent written inline, where it outranks the hovered
      // world's block: you would preview the Lineup wearing the Quarry's blue.
      // Passing no accent id resolves to the hovered world's own first accent.
      item.addEventListener('mouseenter', function () {
        KB.Themes.applyTo(document.documentElement, w.id, null);
      });
      item.addEventListener('mouseleave', function () {
        KB.App.applyTheme();
      });
      grid.appendChild(item);
    });
    box.appendChild(grid);

    var world = KB.Themes.get(activeId);
    var accentHead = h('h3', { class: 'world-subhead' }, 'Accent');
    box.appendChild(accentHead);
    box.appendChild(accentRow(world, activeAccent, function (id) {
      KB.State.setAccent(id);
      KB.App.applyTheme();
      render();
    }));

    var done = h('button', { type: 'button', class: 'btn primary world-done' }, 'Done');
    done.addEventListener('click', function () { close(true); });
    box.appendChild(done);

    panel.appendChild(box);
    panel.addEventListener('click', function (e) { if (e.target === panel) close(true); });
    document.body.appendChild(panel);

    var first = box.querySelector('.world-item.active') || box.querySelector('.world-item');
    if (first) first.focus();
  }

  function show() {
    if (open) { close(true); return; }
    open = true;
    var current = KB.State.data();
    restore = { theme: current.theme, accent: current.accent };
    document.addEventListener('keydown', onKey, true);
    render();
  }

  KB.Worlds = { show: show, close: close, isOpen: function () { return open; } };
})();
