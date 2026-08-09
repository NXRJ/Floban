(function (KB) {
  // Command palette — Ctrl/Cmd+K. A keyboard-first overlay that lists every
  // command available in the current context and runs it on Enter/click.

  var h = KB.Dom.h;

  var root = null;
  var panel = null;
  var input = null;
  var listEl = null;
  var items = [];
  var selectedIndex = -1;
  var context = null;
  var opener = null;

  function isOpen() {
    return root !== null;
  }

  function close() {
    if (!root) return;
    root.remove();
    root = null;
    panel = null;
    input = null;
    listEl = null;
    items = [];
    selectedIndex = -1;
    document.removeEventListener('keydown', onKey);
    KB.Dom.setPageInert(false);
    if (opener && opener.focus) {
      // The opener may have been removed from the DOM while the palette was
      // open; focusing a detached element throws a SecurityError.
      try { opener.focus(); } catch (err) {}
    }
    opener = null;
  }

  function availableCommands() {
    return KB.Commands.availableIn(context);
  }

  function render() {
    var query = input.value;
    var commands = query ? KB.Commands.search(query).filter(function (command) {
      return command.available(context) !== false;
    }) : availableCommands();

    listEl.innerHTML = '';
    items = commands;
    selectedIndex = -1;

    if (commands.length === 0) {
      var none = h('div', { class: 'palette-empty' });
      none.textContent = 'NO COMMANDS MATCH';
      listEl.appendChild(none);
      input.removeAttribute('aria-activedescendant');
      return;
    }

    var lastCategory = null;
    commands.forEach(function (command, index) {
      if (command.category !== lastCategory) {
        var label = h('div', { class: 'palette-category' });
        label.textContent = command.category.toUpperCase();
        listEl.appendChild(label);
        lastCategory = command.category;
      }
      var item = h('div', {
        class: 'palette-item',
        role: 'option',
        id: 'palette-opt-' + index,
        'aria-selected': 'false',
        'data-index': index
      });
      var iconEl = h('span', { class: 'palette-icon' });
      if (command.icon) iconEl.innerHTML = KB.Dom.icon(command.icon);
      item.appendChild(iconEl);
      var title = h('span', { class: 'palette-title' });
      title.textContent = command.title;
      item.appendChild(title);
      if (command.shortcut) {
        var chip = h('span', { class: 'palette-shortcut' });
        chip.textContent = command.shortcut.replace('mod', 'Ctrl/Cmd');
        item.appendChild(chip);
      }
      item.addEventListener('mousedown', function (e) {
        e.preventDefault();
        runAt(index);
      });
      item.addEventListener('mouseenter', function () {
        select(index);
      });
      listEl.appendChild(item);
    });

    select(0);
  }

  function select(index) {
    if (items.length === 0) return;
    index = Math.max(0, Math.min(index, items.length - 1));
    selectedIndex = index;
    var rows = listEl.querySelectorAll('.palette-item');
    for (var i = 0; i < rows.length; i++) {
      var active = i === index;
      rows[i].classList.toggle('selected', active);
      rows[i].setAttribute('aria-selected', active ? 'true' : 'false');
    }
    input.setAttribute('aria-activedescendant', 'palette-opt-' + index);
    var selectedEl = rows[index];
    if (selectedEl && selectedEl.scrollIntoView) {
      selectedEl.scrollIntoView({ block: 'nearest' });
    }
  }

  function move(step) {
    if (items.length === 0) return;
    var next = selectedIndex + step;
    if (next < 0) next = items.length - 1;
    if (next >= items.length) next = 0;
    select(next);
  }

  function runAt(index) {
    var command = items[index];
    if (!command) return;
    var ctx = context;
    close();
    KB.Commands.run(command.id, ctx);
  }

  function runSelected() {
    if (selectedIndex >= 0) runAt(selectedIndex);
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      move(1);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      move(-1);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      runSelected();
      return;
    }
    if (e.key === 'Tab') {
      // trapKey intercepts only at the wrap boundaries; mid-list Tab keeps
      // the browser's default movement.
      KB.Dom.trapKey(e, panel);
    }
  }

  function open(ctx, trigger) {
    if (isOpen()) close();
    context = ctx || null;
    opener = trigger || document.activeElement;

    root = h('div', { class: 'palette-backdrop' });
    KB.Dom.setPageInert(true);
    panel = h('div', { class: 'palette-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Command palette' });
    var header = h('div', { class: 'palette-header' });
    var title = h('span', { class: 'palette-title-lg' });
    title.textContent = 'COMMANDS';
    header.appendChild(title);
    header.appendChild(h('span', { class: 'spacer' }));
    panel.appendChild(header);

    var inputWrap = h('div', { class: 'palette-input-wrap' });
    var iconEl = h('span', { class: 'palette-input-icon' });
    iconEl.innerHTML = KB.Dom.icon('command');
    inputWrap.appendChild(iconEl);
    input = h('input', {
      type: 'text',
      id: 'palette-input',
      class: 'palette-input',
      placeholder: 'TYPE A COMMAND…',
      'aria-label': 'Command palette search',
      role: 'combobox',
      'aria-expanded': 'true',
      'aria-autocomplete': 'list',
      'aria-controls': 'palette-list',
      autocomplete: 'off',
      spellcheck: 'false'
    });
    inputWrap.appendChild(input);
    panel.appendChild(inputWrap);

    listEl = h('div', { class: 'palette-list', role: 'listbox', id: 'palette-list', 'aria-label': 'Commands' });
    panel.appendChild(listEl);

    var hints = h('div', { class: 'palette-hints' });
    hints.textContent = '\u2191\u2193 MOVE  \u00B7  ENTER RUN  \u00B7  ESC CLOSE';
    panel.appendChild(hints);

    root.appendChild(panel);
    KB.el('palette-root').appendChild(root);

    root.addEventListener('mousedown', function (e) {
      if (e.target === root) close();
    });
    document.addEventListener('keydown', onKey);
    input.addEventListener('input', render);
    input.focus();
    render();
  }

  KB.Palette = {
    open: open,
    close: close,
    isOpen: isOpen
  };
})(window.KB = window.KB || {});
