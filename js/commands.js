(function (KB) {
  // Command definitions — the single source of truth behind the command
  // palette (Ctrl/Cmd+K), the keyboard-shortcut dispatcher, the app menu,
  // and the mobile action sheets. Every action here reuses the existing
  // state, policy, placement, lifecycle, history and undo machinery; no
  // business rule is duplicated.

  var registry = KB.Core.Commands.createRegistry();
  var C = {
    register: function (command) { return registry.register(command); },
    unregister: registry.unregister,
    get: registry.get,
    all: registry.all,
    list: registry.list,
    search: registry.search,
    findByShortcut: registry.findByShortcut,
    availableIn: registry.availableIn,
    run: registry.run,
    normalizeShortcut: registry.normalizeShortcut
  };

  // ---------- helpers ----------

  function refresh() { KB.App.refresh(); }

  function toast(message, type, actionLabel, onAction) {
    KB.UI.toast(message, type, actionLabel, onAction);
  }

  function undoAction() { KB.UI.undoAction(); }

  function isMobile() {
    return KB.Dom.isMobile();
  }

  function cardLocation(ctx) {
    // Prefer the card in the exact column the action came from: board
    // imports preserve card ids, so the same id can exist in two boards, and
    // a cross-board search would hit the wrong instance. The column is
    // resolved within the ORIGIN board (ctx.boardId) when the context carries
    // one — active-board-only lookup would miss cross-board workspaces. The
    // global search is only a fallback for contexts that carry no column.
    if (ctx && ctx.columnId && ctx.cardId) {
      var board = ctx.boardId ? KB.State.internal.boardById(ctx.boardId) : null;
      var column = null;
      var card = null;
      if (board) {
        column = board.columns.find(function (c) { return c.id === ctx.columnId; }) || null;
        card = KB.State.internal.findCardInBoard(board, ctx.columnId, ctx.cardId);
      } else {
        column = KB.State.internal.findColumn(ctx.columnId);
        card = KB.State.internal.findCard(ctx.columnId, ctx.cardId);
      }
      if (column && card) {
        return {
          board: board || KB.State.internal.boardForColumn(ctx.columnId) || KB.State.internal.activeBoard(),
          column: column,
          card: card,
          archived: false
        };
      }
    }
    return KB.State.internal.findCardAnywhere(KB.State.data(), ctx.cardId);
  }

  // ---------- Workspace ----------

  function workspaceCommand(id, name, workspace) {
    return C.register({
      id: id,
      title: name,
      category: 'Workspace',
      icon: workspace === 'board' ? 'board' : (workspace === 'inbox' ? 'box' : 'doc'),
      order: 1,
      run: function () {
        KB.Workspaces.set(workspace);
      }
    });
  }
  workspaceCommand('workspace.board', 'Board', 'board');
  workspaceCommand('workspace.mydesk', 'My Desk', 'mydesk');
  workspaceCommand('workspace.inbox', 'Inbox', 'inbox');
  workspaceCommand('workspace.review', 'Review', 'review');

  // ---------- Board ----------

  C.register({
    id: 'board.new',
    title: 'New board…',
    keywords: ['create board'],
    category: 'Board',
    icon: 'plus',
    order: 1,
    run: function () {
      KB.Modal.promptModal('New board', 'Board name', '', function (name) {
        KB.State.addBoard(name);
        toast('Board created', 'success');
        refresh();
      });
    }
  });

  C.register({
    id: 'board.rename',
    title: 'Rename board…',
    category: 'Board',
    icon: 'edit',
    order: 2,
    run: function () {
      var active = KB.State.activeBoard();
      KB.Modal.promptModal('Rename board', 'Board name', active.name, function (name) {
        KB.State.renameBoard(active.id, name);
        toast('Board renamed', 'success');
        refresh();
      });
    }
  });

  C.register({
    id: 'board.duplicate',
    title: 'Duplicate board',
    category: 'Board',
    icon: 'copy',
    order: 3,
    run: function () {
      var active = KB.State.activeBoard();
      KB.State.duplicateBoard(active.id);
      toast('Board duplicated', 'success', 'Undo', undoAction);
      refresh();
    }
  });

  C.register({
    id: 'board.delete',
    title: 'Delete board…',
    category: 'Board',
    icon: 'x',
    order: 4,
    available: function () {
      return KB.State.boards().length > 1;
    },
    run: function () {
      var active = KB.State.activeBoard();
      if (!window.confirm('Delete "' + active.name + '" and all of its cards? You can undo this right after.')) return;
      if (KB.State.deleteBoard(active.id)) {
        toast('Board deleted', 'info', 'Undo', undoAction);
        refresh();
      }
    }
  });

  C.register({
    id: 'board.backup',
    title: 'Backup / restore…',
    keywords: ['export', 'import', 'json'],
    category: 'Board',
    icon: 'download',
    order: 5,
    run: function () {
      KB.Modal.backupModal();
    }
  });

  function registerBoardSwitchCommands() {
    var dynamic = C.all().filter(function (command) {
      return command.id.indexOf('board.switch.') === 0;
    });
    dynamic.forEach(function (command) { C.unregister(command.id); });
    KB.State.boards().forEach(function (board) {
      C.register({
        id: 'board.switch.' + board.id,
        title: 'Switch to "' + board.name + '"',
        keywords: ['board', 'switch', board.name],
        category: 'Board',
        icon: 'board',
        order: 0,
        run: function () {
          var active = KB.State.activeBoard();
          if (board.id !== active.id) {
            KB.State.setActiveBoard(board.id);
            toast('Switched to "' + board.name + '"', 'info');
            refresh();
          }
        }
      });
    });
  }

  // ---------- Column ----------

  C.register({
    id: 'column.new',
    title: 'New column',
    shortcut: 'c',
    category: 'Column',
    icon: 'plus',
    order: 1,
    run: function () {
      KB.Modal.columnEditor(null);
    }
  });

  C.register({
    id: 'column.labels',
    title: 'Manage labels',
    category: 'Column',
    icon: 'palette',
    order: 2,
    run: function () {
      KB.Modal.labelManager();
    }
  });

  C.register({
    id: 'column.recurrences',
    title: 'Recurring work',
    keywords: ['recurrence', 'schedule'],
    category: 'Column',
    icon: 'clock',
    order: 3,
    run: function () {
      KB.Modal.recurrenceManager();
    }
  });

  C.register({
    id: 'column.edit',
    title: 'Edit column…',
    category: 'Column',
    icon: 'edit',
    scope: 'column',
    order: 4,
    available: function (ctx) { return Boolean(ctx && ctx.columnId); },
    run: function (ctx) {
      KB.Modal.columnEditor(ctx.columnId);
    }
  });

  C.register({
    id: 'column.collapse',
    title: 'Collapse / expand column',
    category: 'Column',
    icon: 'chevronUp',
    scope: 'column',
    order: 5,
    available: function (ctx) { return Boolean(ctx && ctx.columnId); },
    run: function (ctx) {
      var column = KB.State.findColumn(ctx.columnId);
      if (column) {
        KB.State.updateColumn(ctx.columnId, { collapsed: !column.collapsed });
        refresh();
      }
    }
  });

  C.register({
    id: 'column.addCard',
    title: 'Add card…',
    category: 'Column',
    icon: 'plus',
    scope: 'column',
    order: 6,
    available: function (ctx) { return Boolean(ctx && ctx.columnId); },
    run: function (ctx) {
      KB.Modal.cardEditor(ctx.columnId, null);
    }
  });

  // ---------- Card ----------

  C.register({
    id: 'card.capture',
    title: 'Capture into Inbox',
    keywords: ['capture', 'inbox', 'quick add note'],
    shortcut: 'i',
    category: 'Card',
    icon: 'box',
    order: 1,
    run: function () {
      KB.Modal.captureModal();
    }
  });

  C.register({
    id: 'card.quickadd',
    title: 'Focus quick add',
    keywords: ['add card', 'quick'],
    shortcut: 'n',
    category: 'Card',
    icon: 'plus',
    order: 2,
    available: function () {
      return KB.Workspaces.current() === 'board' && Boolean(KB.el('board') && KB.el('board').querySelector('.qa-input'));
    },
    run: function () {
      var qa = KB.el('board') && KB.el('board').querySelector('.qa-input');
      if (qa) qa.focus();
    }
  });

  C.register({
    id: 'card.search',
    title: 'Focus search',
    shortcut: '/',
    category: 'Card',
    icon: 'search',
    order: 3,
    run: function () {
      var input = KB.el('search-input');
      if (input) input.focus();
    }
  });

  C.register({
    id: 'card.open',
    title: 'Open card',
    keywords: ['edit'],
    category: 'Card',
    icon: 'doc',
    scope: 'card',
    order: 4,
    available: function (ctx) { return Boolean(ctx && ctx.cardId && !ctx.archived); },
    run: function (ctx) {
      var located = cardLocation(ctx);
      if (!located) return;
      KB.Modal.cardEditor(located.column ? located.column.id : '', located.card, null, located.board.id);
    }
  });

  C.register({
    id: 'card.move',
    title: 'Move to…',
    keywords: ['move card', 'transfer'],
    category: 'Card',
    icon: 'box',
    scope: 'card',
    order: 5,
    available: function (ctx) { return Boolean(ctx && ctx.cardId && !ctx.archived); },
    run: function (ctx) {
      var located = cardLocation(ctx);
      if (!located) return;
      KB.MoveTo.moveToMenu(located.board.id, located.column ? located.column.id : '', ctx.cardId);
    }
  });

  C.register({
    id: 'card.duplicate',
    title: 'Duplicate card',
    category: 'Card',
    icon: 'copy',
    scope: 'card',
    order: 6,
    available: function (ctx) { return Boolean(ctx && ctx.cardId && !ctx.archived); },
    run: function (ctx) {
      var located = cardLocation(ctx);
      if (!located) return;
      KB.State.duplicateCard(located.column ? located.column.id : '', ctx.cardId, located.board.id);
      toast('Card duplicated', 'success', 'Undo', undoAction);
      refresh();
    }
  });

  function flowCommand(id, title, state) {
    C.register({
      id: id,
      title: title,
      category: 'Card',
      icon: 'check',
      scope: 'card',
      order: 7,
      available: function (ctx) { return Boolean(ctx && ctx.cardId && !ctx.archived); },
      run: function (ctx) {
        var located = cardLocation(ctx);
        if (!located) return;
        var apply = function (reason) {
          KB.State.setFlowState(located.column ? located.column.id : '', ctx.cardId, state, reason || '', located.board.id);
          toast('Marked ' + state, 'success');
          refresh();
        };
        if (state === 'normal') {
          apply('');
          return;
        }
        KB.Modal.promptOptionalModal('Mark ' + state, 'Reason (optional)', 'Why?', function (reason) {
          apply(reason);
        });
      }
    });
  }
  flowCommand('card.block', 'Mark blocked…', 'blocked');
  flowCommand('card.wait', 'Mark waiting…', 'waiting');
  flowCommand('card.pause', 'Mark paused…', 'paused');
  flowCommand('card.unblock', 'Clear flow state', 'normal');

  C.register({
    id: 'card.archive',
    title: 'Archive card',
    category: 'Card',
    icon: 'archive',
    scope: 'card',
    order: 8,
    available: function (ctx) { return Boolean(ctx && ctx.cardId && !ctx.archived); },
    run: function (ctx) {
      var located = cardLocation(ctx);
      if (!located) return;
      KB.State.archiveCard(located.column ? located.column.id : '', ctx.cardId, located.board.id);
      toast('Card archived', 'info', 'Undo', undoAction);
      refresh();
    }
  });

  // ---------- Edit ----------

  C.register({
    id: 'edit.undo',
    title: 'Undo',
    shortcut: 'mod+z',
    category: 'Edit',
    icon: 'undo',
    order: 1,
    available: function () { return KB.State.canUndo(); },
    run: function () {
      if (KB.State.undo()) refresh();
    }
  });

  C.register({
    id: 'edit.redo',
    title: 'Redo',
    shortcut: 'mod+shift+z',
    category: 'Edit',
    icon: 'check',
    order: 2,
    available: function () { return KB.State.canRedo(); },
    run: function () {
      if (KB.State.redo()) refresh();
    }
  });
  // Ctrl+Y is an alias for redo, matching the existing app behavior. It is
  // hidden from palettes and menus but remains dispatchable via shortcut.
  C.register({
    id: 'edit.redo.y',
    title: 'Redo (alias)',
    shortcut: 'mod+y',
    category: 'Edit',
    hidden: true,
    order: 3,
    run: function () {
      if (KB.State.redo()) refresh();
    }
  });

  C.register({
    id: 'edit.clearFilters',
    title: 'Clear filters',
    keywords: ['reset filters'],
    category: 'Edit',
    icon: 'x',
    order: 4,
    available: function () { return KB.Workspaces.current() === 'board'; },
    run: function () {
      KB.App.clearFilters();
    }
  });

  // ---------- View ----------

  C.register({
    id: 'view.theme',
    title: 'Toggle dark / light theme',
    category: 'View',
    icon: 'sun',
    order: 1,
    run: function () {
      var next = KB.State.data().theme === 'dark' ? 'light' : 'dark';
      KB.State.setTheme(next);
      KB.App.applyTheme();
      toast('Theme: ' + next, 'info');
    }
  });

  C.register({
    id: 'view.archive',
    title: 'Open archive',
    category: 'View',
    icon: 'archive',
    order: 2,
    run: function () {
      KB.App.openArchive(true);
    }
  });

  // ---------- App ----------

  C.register({
    id: 'app.palette',
    title: 'Command palette',
    keywords: ['palette', 'commands', 'search commands'],
    shortcut: 'mod+k',
    category: 'App',
    icon: 'command',
    order: 1,
    run: function () {
      KB.Palette.open(null);
    }
  });

  C.register({
    id: 'app.help',
    title: 'Keyboard shortcuts',
    keywords: ['help', 'keys', 'hotkeys'],
    category: 'App',
    icon: 'doc',
    order: 2,
    run: function () {
      KB.Commands.showHelp();
    }
  });

  C.register({
    id: 'app.install',
    title: 'Install app',
    keywords: ['pwa', 'install', 'offline', 'add to home screen'],
    category: 'App',
    icon: 'download',
    order: 3,
    available: function () { return Boolean(KB.PWA && KB.PWA.canInstall()); },
    run: function () {
      if (KB.PWA) KB.PWA.install();
    }
  });

  // ---------- public surface ----------

  // Board identity/name changes — create, rename, delete, import, snapshot
  // restore — must be reflected in the palette's board-switch commands, which
  // are built once at boot. Rebuild them lazily whenever the board signature
  // (ids + names) changes; registration is idempotent and cheap.
  var lastBoardSignature = '';
  KB.Sync.subscribe(function (change) {
    var state = change.state || {};
    var signature = (state.boards || []).map(function (b) {
      return b.id + ':' + b.name;
    }).join('|');
    if (signature !== lastBoardSignature) {
      lastBoardSignature = signature;
      registerBoardSwitchCommands();
    }
  });

  KB.Commands = C;
  KB.Commands.registerBoardSwitchCommands = registerBoardSwitchCommands;
  KB.Commands.isMobile = isMobile;
  KB.Commands.helpModal = function () {
    var h = KB.Dom.h;
    var items = C.list().filter(function (command) {
      return command.shortcut;
    });
    var form = h('div', { class: 'card-form' });
    form.appendChild(h('h2', { textContent: 'Keyboard shortcuts' }));
    var list = h('div', { class: 'shortcut-list' });
    items.forEach(function (command) {
      var row = h('div', { class: 'shortcut-row' });
      var label = h('span', { class: 'shortcut-label' });
      label.textContent = command.title;
      var key = h('kbd', { class: 'shortcut-key' });
      key.textContent = command.shortcut
        .replace('mod', 'Ctrl/Cmd')
        .split('+').join(' + ');
      row.appendChild(label);
      row.appendChild(key);
      list.appendChild(row);
    });
    form.appendChild(list);
    var actions = h('div', { class: 'modal-actions' });
    var closeBtn = h('button', { type: 'button', class: 'btn ghost' });
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', function () { KB.Modal.close(); });
    actions.appendChild(h('span', { class: 'spacer' }));
    actions.appendChild(closeBtn);
    form.appendChild(actions);
    KB.Modal.open(form);
  };
  KB.Commands.showHelp = KB.Commands.helpModal;

  // Dynamic board commands refresh once boards are loaded and whenever the
  // board list changes; app.js calls this after the initial state load.
})(window.KB = window.KB || {});
