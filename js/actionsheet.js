(function (KB) {
  // Bottom action sheet — the mobile menu surface. Lists the registry
  // commands available for a context (card, column, or the whole app) in a
  // full-width bottom panel; on touch devices it replaces hover-only card
  // actions and cramped header menus.

  var h = KB.Dom.h;

  var root = null;
  var panel = null;
  var items = [];
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
    items = [];
    context = null;
    document.removeEventListener('keydown', onKey);
    KB.Dom.setPageInert(false);
    if (opener && opener.focus) {
      try { opener.focus(); } catch (err) {}
    }
    opener = null;
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      moveFocus(e.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (e.key === 'Tab') {
      // No caller-side preventDefault: trapKey only intercepts at the wrap
      // boundaries (or when focus escapes the panel); mid-list Tab must keep
      // the browser's default movement.
      KB.Dom.trapKey(e, panel);
    }
  }

  function moveFocus(step) {
    var buttons = panel.querySelectorAll('.sheet-item');
    if (buttons.length === 0) return;
    var index = 0;
    for (var i = 0; i < buttons.length; i++) {
      if (buttons[i] === document.activeElement) { index = i; break; }
    }
    var next = (index + step + buttons.length) % buttons.length;
    buttons[next].focus();
  }

  function runCommand(commandId) {
    var ctx = context;
    close();
    KB.Commands.run(commandId, ctx);
  }

  function open(opts) {
    opts = opts || {};
    if (isOpen()) close();
    context = opts.ctx || null;
    opener = opts.opener || document.activeElement;
    var commands = opts.commands || KB.Commands.availableIn(context);

    root = h('div', { class: 'sheet-backdrop' });
    KB.Dom.setPageInert(true);
    panel = h('div', { class: 'sheet-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title || 'Actions' });

    var head = h('div', { class: 'sheet-head' });
    var title = h('span', { class: 'sheet-title' });
    title.textContent = opts.title || 'ACTIONS';
    head.appendChild(title);
    head.appendChild(h('span', { class: 'spacer' }));
    var closeBtn = h('button', { type: 'button', class: 'btn icon sm sheet-close', 'aria-label': 'Close', title: 'Close' });
    closeBtn.innerHTML = KB.Dom.icon('x');
    closeBtn.addEventListener('click', close);
    head.appendChild(closeBtn);
    panel.appendChild(head);

    var list = h('div', { class: 'sheet-list' });
    commands.forEach(function (command) {
      var btn = h('button', { type: 'button', class: 'sheet-item', 'data-command': command.id });
      var iconEl = h('span', { class: 'sheet-icon' });
      if (command.icon) iconEl.innerHTML = KB.Dom.icon(command.icon);
      btn.appendChild(iconEl);
      var label = h('span', { class: 'sheet-label' });
      label.textContent = command.title;
      btn.appendChild(label);
      if (command.shortcut) {
        var chip = h('span', { class: 'sheet-shortcut' });
        chip.textContent = command.shortcut.replace('mod', 'Ctrl/Cmd');
        btn.appendChild(chip);
      }
      btn.addEventListener('click', function () {
        runCommand(command.id);
      });
      list.appendChild(btn);
      items.push(btn);
    });
    panel.appendChild(list);

    root.appendChild(panel);
    KB.el('sheet-root').appendChild(root);

    root.addEventListener('mousedown', function (e) {
      if (e.target === root) close();
    });
    document.addEventListener('keydown', onKey);
    var first = list.querySelector('.sheet-item');
    if (first) first.focus();
  }

  KB.Sheet = {
    open: open,
    close: close,
    isOpen: isOpen
  };
})(window.KB = window.KB || {});
