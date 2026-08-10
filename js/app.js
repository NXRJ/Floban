(function (KB) {
  var h = KB.Dom.h;
  var icon = KB.Dom.icon;

  var searchTimer = null;
  var pop = null;
  var popHandlers = [];

  function clearToasts() {
    var root = KB.el('toast-root');
    Array.prototype.slice.call(root.children).forEach(function (el) { el.remove(); });
  }

  function toast(message, type, actionLabel, onAction) {
    var el = h('div', { class: 'toast ' + (type || 'info') });
    var text = h('span', { class: 'toast-text' });
    text.textContent = message;
    el.appendChild(text);
    var timer = null;
    function dismiss() {
      if (timer) clearTimeout(timer);
      if (!el.parentNode) return;
      el.classList.add('out');
      setTimeout(function () { el.remove(); }, 300);
    }
    if (actionLabel && onAction) {
      var btn = h('button', { type: 'button', class: 'btn sm toast-btn' });
      btn.textContent = actionLabel;
      btn.addEventListener('click', function () {
        onAction();
        dismiss();
      });
      el.appendChild(btn);
    }
    KB.el('toast-root').appendChild(el);
    timer = setTimeout(dismiss, 3000);
  }

  function download(filename, text) {
    var blob = new Blob([text], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function undoAction() {
    if (KB.State.undo()) KB.App.refresh();
  }

  function applyTheme() {
    var current = KB.State.data();
    document.documentElement.dataset.theme = current ? current.theme : 'dark';
  }

  function refresh() {
    if (!KB.State.data()) return;
    applyTheme();
    KB.Workspaces.render();
    KB.Workspaces.inboxBadge();
    updateMobileTabs();
    renderFocusHud();
    if (KB.Scoreboard) KB.Scoreboard.sync();
    if (KB.Workspaces.current() !== 'board') {
      KB.Render.boardPager();
      return;
    }
    KB.Render.board();
    KB.Render.filterBar();
    KB.Render.archivePanel();
    refreshHeader();
    updateBoardOverflow();
    updateFilterToggle();
    KB.Select.syncAll();
  }

  function updateFilterToggle() {
    var toggle = KB.el('filter-toggle');
    if (!toggle) return;
    var active = KB.Filters.active(KB.Filters.read());
    toggle.classList.toggle('active', active);
    var bar = KB.el('filter-bar');
    toggle.setAttribute('aria-expanded', bar ? (bar.classList.contains('open') ? 'true' : 'false') : 'false');
  }

  function updateBoardOverflow() {
    var board = KB.el('board');
    board.classList.toggle('has-overflow', board.scrollWidth > board.clientWidth + 1);
  }

  function refreshHeader() {
    var board = KB.State.activeBoard();
    KB.el('board-name').textContent = board.name;
    KB.el('board-switch').title = 'Switch board — ' + board.name;
    var archive = board.archive;
    var count = archive.cards.length;
    archive.columns.forEach(function (entry) {
      count += 1 + entry.cards.length;
    });
    var badge = KB.el('archive-badge');
    badge.textContent = count;
    badge.classList.toggle('show', count > 0);
  }

  function clearFilters() {
    KB.el('search-input').value = '';
    KB.el('assignee-filter').value = '';
    KB.el('due-filter').value = '';
    KB.el('priority-filter').value = '';
    KB.el('size-filter').value = '';
    KB.el('flow-filter').value = '';
    KB.el('ready-filter').checked = false;
    KB.el('depblocked-filter').checked = false;
    KB.Filters.selected.clear();
    refresh();
  }

  function toggleArchive(open) {
    KB.el('archive-panel').classList.toggle('open', open);
    KB.el('archive-backdrop').classList.toggle('show', open);
  }

  function openPop(trigger, build) {
    closePop();
    pop = h('div', { class: 'pop' });
    build(pop);
    document.body.appendChild(pop);
    var rect = trigger.getBoundingClientRect();
    var margin = 6;
    pop.style.maxHeight = Math.min(420, window.innerHeight - 16) + 'px';
    var below = rect.bottom + margin;
    var fitsBelow = below + pop.offsetHeight <= window.innerHeight - 8;
    pop.style.top = (fitsBelow ? below : Math.max(4, rect.top - margin - pop.offsetHeight)) + 'px';
    pop.style.left = Math.max(4, Math.min(rect.left, window.innerWidth - pop.offsetWidth - 8)) + 'px';

    function onDown(e) {
      if (!pop.contains(e.target) && e.target !== trigger) closePop();
    }
    function onKey(e) {
      if (e.key === 'Escape') closePop();
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    popHandlers = [onDown, onKey];
  }

  function closePop() {
    if (pop) {
      pop.remove();
      pop = null;
    }
    popHandlers.forEach(function (fn) {
      document.removeEventListener('mousedown', fn);
      document.removeEventListener('keydown', fn);
    });
    popHandlers = [];
  }

  function popDivider() {
    return h('div', { class: 'pop-divider' });
  }

  function popItem(label, onClick, extraClass) {
    var item = h('button', { type: 'button', class: 'pop-item' + (extraClass ? ' ' + extraClass : '') });
    item.textContent = label;
    if (extraClass && extraClass.indexOf('disabled') !== -1) {
      item.disabled = true;
    } else {
      item.addEventListener('click', function () {
        closePop();
        onClick();
      });
    }
    return item;
  }

  function openBoardMenu(trigger) {
    openPop(trigger, function (popEl) {
      var active = KB.State.activeBoard();
      KB.State.boards().forEach(function (board) {
        var item = h('button', {
          type: 'button',
          class: 'pop-item' + (board.id === active.id ? ' active' : ''),
          title: 'Switch to this board'
        });
        var name = h('span', { class: 'pop-item-name' });
        name.textContent = board.name;
        var cards = board.columns.reduce(function (n, c) { return n + c.cards.length; }, 0);
        var count = h('span', { class: 'pop-item-count' });
        count.textContent = KB.Dom.plural(cards, 'card');
        item.appendChild(name);
        item.appendChild(count);
        item.addEventListener('click', function () {
          closePop();
          if (board.id !== active.id) {
            KB.State.setActiveBoard(board.id);
            toast('Switched to "' + board.name + '"', 'info');
            KB.App.refresh();
          }
        });
        popEl.appendChild(item);
      });

      popEl.appendChild(popDivider());
      popEl.appendChild(popItem('New board…', function () {
        KB.Modal.promptModal('New board', 'Board name', '', function (name) {
          KB.State.addBoard(name);
          toast('Board created', 'success');
          KB.App.refresh();
        });
      }));
      popEl.appendChild(popItem('Rename board…', function () {
        KB.Modal.promptModal('Rename board', 'Board name', active.name, function (name) {
          KB.State.renameBoard(active.id, name);
          toast('Board renamed', 'success');
          KB.App.refresh();
        });
      }));
      popEl.appendChild(popItem('Duplicate board', function () {
        KB.State.duplicateBoard(active.id);
        toast('Board duplicated', 'success', 'Undo', undoAction);
        KB.App.refresh();
      }));
      popEl.appendChild(popItem('Delete board…', function () {
        if (!confirm('Delete "' + active.name + '" and all of its cards? You can undo this right after.')) return;
        if (KB.State.deleteBoard(active.id)) {
          toast('Board deleted', 'info', 'Undo', undoAction);
          KB.App.refresh();
        }
      }, KB.State.boards().length <= 1 ? 'disabled' : ''));

      popEl.appendChild(popDivider());
      popEl.appendChild(popItem('Backup / restore…', function () {
        KB.Modal.backupModal();
      }));
    });
  }

  function openAppMenu(trigger) {
    if (KB.Commands.isMobile()) {
      KB.Sheet.open({ title: 'KANBAN MENU', ctx: null, opener: trigger });
      return;
    }
    openPop(trigger, function (popEl) {
      var lastCategory = null;
      KB.Commands.availableIn(null).forEach(function (command) {
        if (command.category !== lastCategory) {
          if (lastCategory !== null) popEl.appendChild(popDivider());
          var label = h('div', { class: 'pop-category' });
          label.textContent = command.category.toUpperCase();
          popEl.appendChild(label);
          lastCategory = command.category;
        }
        var item = popItem(command.title, function () {
          KB.Commands.run(command.id, null);
        });
        if (command.shortcut) {
          var key = h('span', { class: 'pop-shortcut' });
          key.textContent = command.shortcut.replace('mod', 'Ctrl/Cmd');
          item.appendChild(key);
        }
        popEl.appendChild(item);
      });
    });
  }

  function openTemplatesMenu(trigger, columnId) {
    openPop(trigger, function (popEl) {
      var templates = KB.State.templates();
      if (templates.length === 0) {
        var none = h('div', { class: 'pop-none' });
        none.textContent = 'No templates yet — open a card and pick "Save as template".';
        popEl.appendChild(none);
        return;
      }
      templates.forEach(function (template) {
        var item = h('button', { type: 'button', class: 'pop-item' });
        item.textContent = template.title;
        item.addEventListener('click', function () {
          closePop();
          var data = {
            title: template.title,
            description: template.description,
            labels: (template.labels || []).slice(),
            assignee: template.assignee,
            priority: template.priority || 'none',
            size: template.size || 'none',
            checklist: (template.checklist || []).map(function (item) {
              return { id: KB.Dom.uid('ck'), text: item.text, done: false };
            })
          };
          var createCard = function (opts) {
            var created = KB.State.addCard(columnId, data, opts);
            if (created) {
              toast('Card created from template', 'success', 'Undo', undoAction);
            } else {
              toast('Column policy blocks this card', 'error');
            }
            KB.App.refresh();
          };
          var evaluation = KB.State.createNeedsConfirmation(columnId);
          if (evaluation) {
            KB.Modal.moveConfirmModal('Adding this card requires confirmation', evaluation, '', function (reason) {
              createCard({ confirmed: true, overrideReason: reason });
            });
            return;
          }
          createCard();
        });
        popEl.appendChild(item);
      });
    });
  }

  // Smart Quick Add: each line runs through the deterministic natural-language
  // parser ("fix bug in 3 days p2 #launch" sets due, priority and labels and
  // strips the tokens from the title). Parsing happens before the dispatch, so
  // the whole batch is still one atomic, undoable operation.
  function parseQuickAddLines(lines) {
    var labels = KB.State.labels();
    return lines.map(function (line) {
      var parsed = KB.Core.Nlparse.parseQuickAdd(line, { now: Date.now(), labels: labels });
      var fields = {};
      if (parsed.due) fields.due = parsed.due;
      if (parsed.when) fields.when = parsed.when;
      if (parsed.priority) fields.priority = parsed.priority;
      if (parsed.labelIds.length > 0) fields.labels = parsed.labelIds;
      return { title: parsed.title || line, fields: fields, raw: line };
    });
  }

  // Live feedback for the last (visible) line of the quick-add box: recognized
  // tokens become chips ("DUE AUG 14", "HIGH", "#launch") before commit.
  function previewQuickAdd(input) {
    var preview = input.parentNode && input.parentNode.querySelector('.qa-preview');
    if (!preview) return;
    var lines = input.value.split('\n').map(function (line) { return line.trim(); }).filter(Boolean);
    var text = lines.length > 0 ? lines[lines.length - 1] : '';
    if (!text) {
      preview.hidden = true;
      preview.textContent = '';
      return;
    }
    var parsed = KB.Core.Nlparse.parseQuickAdd(text, { now: Date.now(), labels: KB.State.labels() });
    var chips = KB.Render.qaPreviewChips(parsed);
    preview.textContent = '';
    if (!chips) {
      preview.hidden = true;
      return;
    }
    chips.forEach(function (chip) {
      var el = h('span', { class: 'chip chip-static qa-preview-chip ' + chip.class, title: chip.title });
      el.textContent = chip.text;
      preview.appendChild(el);
    });
    preview.hidden = false;
  }

  function submitQuickAdd(input) {
    var list = input.closest('.card-list');
    if (!list) return;
    var columnId = list.dataset.columnId;
    var lines = input.value.split('\n').map(function (line) { return line.trim(); }).filter(Boolean);
    if (lines.length === 0) return;
    var parsedLines = parseQuickAddLines(lines);
    var titles = parsedLines.map(function (p) { return p.title; });
    var fields = parsedLines.map(function (p) { return p.fields; });
    var raw = parsedLines.map(function (p) { return p.raw; }).join('\n');
    var preview = input.parentNode && input.parentNode.querySelector('.qa-preview');
    if (preview) preview.hidden = true;
    var finish = function (added, keepInput) {
      if (!keepInput) input.value = '';
      if (added > 0) {
        toast(KB.Dom.plural(added, 'card') + ' added', 'success', 'Undo', undoAction);
      } else {
        toast('Column policy blocks these cards', 'error');
      }
      KB.App.refresh();
      var fresh = KB.el('board').querySelector('.card-list[data-column-id="' + CSS.escape(columnId) + '"] .qa-input');
      if (fresh) {
        if (keepInput) fresh.value = raw;
        fresh.focus();
      }
    };
    var evaluation = KB.State.createNeedsConfirmation(columnId, lines.length);
    if (evaluation) {
      KB.Modal.moveConfirmModal('Adding these cards requires confirmation', evaluation, '', function (reason) {
        var added = KB.State.addCards(columnId, titles, { confirmed: true, overrideReason: reason, fields: fields });
        finish(added, added === 0);
      });
      return;
    }
    var added = KB.State.addCards(columnId, titles, { fields: fields });
    finish(added, added === 0);
  }

  function announceMove(toColumnId, toIndex) {
    if (!KB.MoveTo.announce) return;
    var target = KB.State.findColumn(toColumnId);
    KB.MoveTo.announce('Moved to ' + (target ? target.title : '') + ', position ' + ((toIndex || 0) + 1) + '.');
  }

  function requestMove(fromColumnId, cardId, toColumnId, toIndex, onDone) {
    var evaluation = KB.State.evaluateMove(fromColumnId, cardId, toColumnId);
    if (!evaluation) {
      if (onDone) onDone();
      return;
    }
    if (evaluation.allowed && !evaluation.requiresConfirmation) {
      var moved = KB.State.moveCardChecked(fromColumnId, cardId, toColumnId, toIndex);
      afterCardMove(moved);
      if (moved && moved.ok) announceMove(toColumnId, toIndex);
      if (onDone) onDone(moved);
      return;
    }
    KB.Modal.moveConfirmModal('Move requires confirmation', evaluation, '', function (reason) {
      var moved = KB.State.moveCardChecked(fromColumnId, cardId, toColumnId, toIndex, { confirmed: true, overrideReason: reason });
      afterCardMove(moved);
      if (moved && moved.ok) announceMove(toColumnId, toIndex);
      if (onDone) onDone(moved);
    });
  }

  function afterCardMove(moved) {
    if (moved && moved.ok) {
      KB.App.refresh();
    }
  }

  function processRecurrences() {
    KB.State.processRecurrences();
    KB.App.refresh();
  }

  function requestRestore(cardId, onDone) {
    var result = KB.State.restoreCardChecked(cardId);
    if (result.ok) {
      if (onDone) onDone(result);
      return;
    }
    if (result.reason === 'policy') {
      KB.Modal.moveConfirmModal('Restore requires confirmation', result.evaluation, '', function (reason) {
        var confirmed = KB.State.restoreCardChecked(cardId, { confirmed: true, overrideReason: reason });
        if (onDone) onDone(confirmed);
      });
      return;
    }
    if (onDone) onDone(result);
  }

  function wireHeader() {
    document.querySelectorAll('.ws-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        KB.Workspaces.set(btn.dataset.workspace);
      });
    });
    KB.el('toggle-theme').addEventListener('click', function () {
      var next = KB.State.data().theme === 'dark' ? 'light' : 'dark';
      KB.State.setTheme(next);
      applyTheme();
    });
    KB.el('board-switch').addEventListener('click', function () {
      openBoardMenu(KB.el('board-switch'));
    });
    KB.el('add-column').addEventListener('click', function () {
      KB.Modal.columnEditor(null);
    });
    KB.el('manage-labels').addEventListener('click', function () {
      KB.Modal.labelManager();
    });
    KB.el('toggle-archive').addEventListener('click', function () {
      toggleArchive(true);
    });
    KB.el('archive-backdrop').addEventListener('click', function () {
      toggleArchive(false);
    });
    KB.el('open-recurrences').addEventListener('click', function () {
      KB.Modal.recurrenceManager();
    });
    KB.el('palette-btn').addEventListener('click', function () {
      KB.Palette.open(null, KB.el('palette-btn'));
    });
    KB.el('app-menu').addEventListener('click', function () {
      openAppMenu(KB.el('app-menu'));
    });
    var readout = KB.el('streak-readout');
    if (readout && KB.Scoreboard) {
      readout.addEventListener('click', function () { KB.Scoreboard.open(); });
    }
  }

  function wireMobile() {
    var tabs = KB.el('mobile-tabs');
    tabs.addEventListener('click', function (e) {
      var btn = e.target.closest('.mt-btn');
      if (!btn) return;
      KB.Workspaces.set(btn.dataset.workspace);
    });

    var boardEl = KB.el('board');
    boardEl.addEventListener('scroll', function () {
      KB.Render.updatePagerState();
    }, { passive: true });

    var pager = KB.el('board-pager');
    pager.querySelector('.bp-prev').addEventListener('click', function () {
      KB.Render.scrollToColumn(KB.Render.pagerActiveIndex() - 1);
    });
    pager.querySelector('.bp-next').addEventListener('click', function () {
      KB.Render.scrollToColumn(KB.Render.pagerActiveIndex() + 1);
    });

    var filterToggle = KB.el('filter-toggle');
    filterToggle.addEventListener('click', function () {
      var bar = KB.el('filter-bar');
      var open = bar.classList.toggle('open');
      filterToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  function updateMobileTabs() {
    var tabs = KB.el('mobile-tabs');
    if (!tabs) return;
    var current = KB.Workspaces.current();
    tabs.querySelectorAll('.mt-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.workspace === current);
    });
    KB.Workspaces.inboxBadge();
  }

  function wireFilters() {
    KB.el('search-input').addEventListener('input', function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(refresh, 120);
    });
    KB.el('assignee-filter').addEventListener('change', refresh);
    KB.el('due-filter').addEventListener('change', refresh);
    KB.el('priority-filter').addEventListener('change', refresh);
    KB.el('size-filter').addEventListener('change', refresh);
    KB.el('flow-filter').addEventListener('change', refresh);
    KB.el('ready-filter').addEventListener('change', refresh);
    KB.el('depblocked-filter').addEventListener('change', refresh);
    KB.el('sort-select').addEventListener('change', function () {
      KB.Filters.setSortMode(this.value);
      if (KB.Filters.sortActive()) {
        toast('Cards sorted — drag reordering is off until you pick "Manual order"', 'info');
      }
      refresh();
    });
    KB.el('label-filters').addEventListener('click', function (e) {
      var chip = e.target.closest('[data-label-id]');
      if (!chip) return;
      var id = chip.dataset.labelId;
      if (KB.Filters.selected.has(id)) KB.Filters.selected.delete(id);
      else KB.Filters.selected.add(id);
      refresh();
      var refocus = KB.el('label-filters').querySelector('[data-label-id="' + id + '"]');
      if (refocus) refocus.focus();
    });
    KB.el('clear-filters').addEventListener('click', clearFilters);
  }

  function wireWorkspaces() {
    KB.el('ws-review').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) return;
      var row = e.target.closest('.review-row');
      if (!row) return;
      var boardId = row.dataset.boardId;
      var columnId = row.dataset.columnId;
      var cardId = row.dataset.cardId;
      switch (btn.dataset.action) {
        case 'review-open': {
          var card = KB.State.findCardInBoard(KB.State.boardById(boardId), columnId, cardId);
          if (card) KB.Modal.cardEditor(columnId, card, null, boardId);
          break;
        }
        case 'review-move':
          KB.MoveTo.moveToMenu(boardId, columnId, cardId);
          break;
        case 'review-archive':
          KB.State.archiveCard(columnId, cardId, boardId);
          KB.UI.toast('Card archived', 'info', 'Undo', KB.UI.undoAction);
          KB.App.refresh();
          break;
      }
    });

    KB.el('ws-inbox').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) return;
      var itemEl = e.target.closest('.inbox-item');
      var id = itemEl ? itemEl.dataset.id : null;
      switch (btn.dataset.action) {
        case 'inbox-capture':
          KB.Modal.captureModal();
          break;
        case 'inbox-triage': {
          var item = KB.State.inboxItems().find(function (it) { return it.id === id; });
          if (item) KB.Modal.triageModal(item);
          break;
        }
        case 'inbox-merge': {
          var item = KB.State.inboxItems().find(function (it) { return it.id === id; });
          if (item) KB.Modal.mergeModal(item);
          break;
        }
        case 'inbox-restore':
          KB.State.updateInboxItem(id, { archived: false });
          KB.UI.toast('Item restored', 'success', 'Undo', KB.UI.undoAction);
          KB.App.refresh();
          break;
        case 'inbox-delete':
          KB.State.deleteInboxItem(id);
          KB.UI.toast('Item deleted', 'info', 'Undo', KB.UI.undoAction);
          KB.App.refresh();
          break;
      }
    });
  }

  function wireBoard() {
    KB.el('board-area').addEventListener('click', function (e) {
      var actionEl = e.target.closest('[data-action]');
      if (!actionEl) {
        // Mobile: tapping a card opens its action sheet (selection clicks
        // with modifiers are left alone). Taps on links or controls inside a
        // card — e.g. a markdown link in the description — must not hijack
        // into the sheet.
        var tappedCard = e.target.closest('.card');
        if (tappedCard && e.target.closest('a, button, input, select, textarea')) {
          tappedCard = null;
        }
        if (tappedCard && KB.Commands.isMobile() && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
          var columnEl = tappedCard.closest('.column');
          var columnId = columnEl ? columnEl.dataset.id : null;
          var cardId = tappedCard.dataset.id;
          var card = KB.State.findCard(columnId, cardId);
          if (card) {
            KB.Sheet.open({
              title: card.title,
              ctx: { boardId: KB.State.activeBoard().id, columnId: columnId, cardId: cardId },
              opener: tappedCard
            });
          }
        }
        return;
      }
      var action = actionEl.dataset.action;
      var columnEl = e.target.closest('.column');
      var cardEl = e.target.closest('.card');
      var columnId = columnEl ? columnEl.dataset.id : null;
      var cardId = cardEl ? cardEl.dataset.id : null;

      switch (action) {
        case 'col-add':
          KB.Commands.run('column.addCard', { boardId: KB.State.activeBoard().id, columnId: columnId });
          break;
        case 'col-menu':
          if (KB.Commands.isMobile()) {
            KB.Sheet.open({
              title: 'COLUMN',
              ctx: { boardId: KB.State.activeBoard().id, columnId: columnId },
              opener: actionEl
            });
          } else {
            KB.Modal.columnEditor(columnId);
          }
          break;
        case 'col-collapse':
          KB.Commands.run('column.collapse', { boardId: KB.State.activeBoard().id, columnId: columnId });
          break;
        case 'add-column-empty':
          KB.Modal.columnEditor(null);
          break;
        case 'edit-card':
          KB.Commands.run('card.open', { boardId: KB.State.activeBoard().id, columnId: columnId, cardId: cardId });
          break;
        case 'move-card':
          KB.Commands.run('card.move', { boardId: KB.State.activeBoard().id, columnId: columnId, cardId: cardId });
          break;
        case 'duplicate-card':
          KB.Commands.run('card.duplicate', { boardId: KB.State.activeBoard().id, columnId: columnId, cardId: cardId });
          break;
        case 'archive-card':
          KB.Commands.run('card.archive', { boardId: KB.State.activeBoard().id, columnId: columnId, cardId: cardId });
          break;
        case 'card-sheet': {
          var boardId = KB.State.activeBoard().id;
          var card = KB.State.findCard(columnId, cardId);
          KB.Sheet.open({
            title: card ? card.title : 'CARD',
            ctx: { boardId: boardId, columnId: columnId, cardId: cardId },
            opener: actionEl
          });
          break;
        }
        case 'qa-templates':
          openTemplatesMenu(actionEl, columnId);
          break;
        case 'clear-filters':
          clearFilters();
          break;
      }
    });

    KB.el('board-area').addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || e.shiftKey) return;
      var input = e.target.closest('.qa-input');
      if (!input) return;
      e.preventDefault();
      submitQuickAdd(input);
    });

    KB.el('board-area').addEventListener('input', function (e) {
      var input = e.target.closest('.qa-input');
      if (!input) return;
      previewQuickAdd(input);
    });
  }

  function wireArchive() {
    KB.el('archive-panel').addEventListener('click', function (e) {
      var actionEl = e.target.closest('[data-action]');
      if (!actionEl) return;
      var id = actionEl.dataset.id;
      switch (actionEl.dataset.action) {
        case 'close-archive':
          toggleArchive(false);
          break;
        case 'restore-card':
          KB.App.requestRestore(id, function (result) {
            if (result && result.ok) {
              KB.UI.toast('Card restored', 'success', 'Undo', KB.UI.undoAction);
              KB.App.refresh();
            } else {
              KB.App.refresh();
            }
          });
          break;
        case 'restore-column':
          KB.State.restoreColumn(id);
          toast('Column restored', 'success', 'Undo', undoAction);
          refresh();
          break;
        case 'purge-card':
          KB.State.purgeCard(id);
          toast('Card deleted permanently', 'info', 'Undo', undoAction);
          refresh();
          break;
        case 'purge-column':
          KB.State.purgeColumn(id);
          toast('Column deleted permanently', 'info', 'Undo', undoAction);
          refresh();
          break;
      }
    });
  }

  function keyCombo(e) {
    var parts = [];
    if (e.ctrlKey || e.metaKey) parts.push('mod');
    if (e.altKey) parts.push('alt');
    // Shift + a bare letter is just case (N, C, I...) — the old dispatcher
    // matched both cases, so do not let Shift change the shortcut identity
    // unless a modifier is already held (Ctrl/Cmd+Shift+Z must stay redo).
    if (e.shiftKey && !(e.ctrlKey || e.metaKey) && !e.altKey && /^[a-zA-Z]$/.test(e.key)) {
      parts.push(e.key.toLowerCase());
    } else {
      if (e.shiftKey) parts.push('shift');
      var key = e.key === ' ' ? 'space' : String(e.key || '').toLowerCase();
      parts.push(key);
    }
    return parts.join('+');
  }

  function wireKeys() {
    window.addEventListener('resize', function () {
      updateBoardOverflow();
      KB.Render.boardPager();
    });
    // Cards decide their information hierarchy (description visibility,
    // label-chip cap) at render time via KB.Dom.isMobile(). Re-render only
    // when the mobile breakpoint is actually crossed — not on every resize —
    // so a desktop->mobile rotation re-caps labels without a manual refresh.
    var mobileMq = window.matchMedia && window.matchMedia('(max-width: 640px)');
    if (mobileMq) {
      var onBreakpointCross = function () { refresh(); };
      if (mobileMq.addEventListener) mobileMq.addEventListener('change', onBreakpointCross);
      else if (mobileMq.addListener) mobileMq.addListener(onBreakpointCross); // Safari 13 and older
    }
    document.addEventListener('keydown', function (e) {
      // Palette and action sheets own their keys while open.
      if (KB.Palette.isOpen() || KB.Sheet.isOpen()) return;
      var tag = document.activeElement && document.activeElement.tagName;
      var typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if (typing || KB.Modal.isOpen()) return;
      // A workspace may claim a plain letter it advertises on screen (the Work
      // Log's COPY (C) / PRINT (P)) before the global registry sees it.
      var bare = keyCombo(e);
      if (!e.ctrlKey && !e.metaKey && !e.altKey && KB.Workspaces.handleKey(bare)) {
        e.preventDefault();
        return;
      }
      var shortcut = KB.Commands.normalizeShortcut(bare);
      var command = KB.Commands.findByShortcut(shortcut);
      if (!command) return;
      e.preventDefault();
      KB.Commands.run(command.id, null);
    });
  }

  function mountIcons() {
    KB.el('board-switch').querySelector('.btn-icon').innerHTML = icon('board');
    KB.el('board-switch').querySelector('.btn-caret').innerHTML = icon('chevronDown');
    KB.el('add-column').querySelector('.btn-icon').innerHTML = icon('plus');
    KB.el('manage-labels').querySelector('.btn-icon').innerHTML = icon('palette');
    KB.el('toggle-archive').querySelector('.btn-icon').innerHTML = icon('archive');
    KB.el('open-recurrences').querySelector('.btn-icon').innerHTML = icon('clock');
    KB.el('toggle-theme').querySelector('.icon-sun').innerHTML = icon('sun');
    KB.el('toggle-theme').querySelector('.icon-moon').innerHTML = icon('moon');
    KB.el('palette-btn').querySelector('.btn-icon').innerHTML = icon('command');
    KB.el('app-menu').querySelector('.btn-icon').innerHTML = icon('menu');
    KB.el('search-input').previousElementSibling.innerHTML = icon('search');

    var tabIcons = {
      board: 'board', mydesk: 'star', inbox: 'box', review: 'check',
      calendar: 'clock', log: 'doc', tuning: 'clock', ping: 'doc'
    };
    KB.el('mobile-tabs').querySelectorAll('.mt-btn').forEach(function (btn) {
      btn.querySelector('.mt-icon').innerHTML = icon(tabIcons[btn.dataset.workspace] || 'doc');
    });
    KB.el('board-pager').querySelector('.bp-prev').innerHTML = icon('chevronLeft');
    KB.el('board-pager').querySelector('.bp-next').innerHTML = icon('chevronRight');
  }

  function tickClock() {
    var now = new Date();
    var hh = String(now.getHours()).padStart(2, '0');
    var mm = String(now.getMinutes()).padStart(2, '0');
    KB.el('clock').textContent = hh + ':' + mm;
  }

  function bootScreen() {
    var overlay = KB.el('homescreen');
    if (!overlay) return;
    if (/[?&]boot=off/.test(location.search)) {
      overlay.remove();
      return;
    }

    var started = false;
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function bootLines() {
      var board = KB.State.activeBoard();
      var cols = board.columns.length;
      var cards = board.columns.reduce(function (n, c) { return n + c.cards.length; }, 0);
      var archived = board.archive.cards.length + board.archive.columns.length;
      return [
        { t: 'KANBAN/OS v5.0.0  ·  THE 8-BIT ATELIER', c: 'chrome' },
        { t: 'MEM 64K OK · CRT 60HZ', c: 'muted' },
        { t: 'BOARD: ' + board.name, c: 'muted' },
        { t: 'MOUNTING DESKTOP...', c: 'muted' },
        { t: 'WINDOWS FOUND: ' + cols, c: 'cyan' },
        { t: 'FILES MOUNTED: ' + cards, c: 'cyan' },
        { t: 'ARCHIVE: ' + archived + ' ITEM' + (archived === 1 ? '' : 'S'), c: 'cyan' },
        { t: 'READY.', c: 'green' }
      ];
    }

    function appendBootLine(log, line, withCaret) {
      var p = document.createElement('p');
      var span = document.createElement('span');
      span.className = 'c-' + line.c;
      span.textContent = line.t;
      p.appendChild(span);
      if (withCaret) {
        var caret = document.createElement('span');
        caret.className = 'hs-caret';
        p.appendChild(caret);
      }
      log.appendChild(p);
    }

    function bootSequence() {
      var log = KB.el('hs-boot');
      var lines = bootLines();
      if (reduced) {
        lines.forEach(function (line) {
          appendBootLine(log, line);
        });
        setTimeout(function () { overlay.classList.add('booted'); }, 120);
        return;
      }
      var i = 0;
      function next() {
        if (i >= lines.length) {
          setTimeout(function () { overlay.classList.add('booted'); }, 260);
          return;
        }
        appendBootLine(log, lines[i], i === lines.length - 1);
        i++;
        setTimeout(next, 210);
      }
      setTimeout(next, 380);
    }

    function powerOn() {
      if (started) return;
      started = true;
      overlay.classList.add('starting');
      setTimeout(function () { overlay.classList.add('off'); }, 700);
      setTimeout(function () {
        overlay.remove();
        document.removeEventListener('keydown', onStartKey);
      }, reduced ? 320 : 1080);
    }

    function onStartKey() {
      powerOn();
    }

    overlay.addEventListener('click', powerOn);
    document.addEventListener('keydown', onStartKey);
    bootSequence();
  }

  // ---- Focus HUD (task-tied timer) ----

  function focusCardTitle(cardId) {
    var state = KB.State.data();
    if (!state) return '';
    for (var i = 0; i < state.boards.length; i++) {
      var board = state.boards[i];
      for (var j = 0; j < board.columns.length; j++) {
        var card = board.columns[j].cards.find(function (c) { return c.id === cardId; });
        if (card) return card.title || '';
      }
    }
    return '';
  }

  function formatClock(totalSeconds) {
    var m = Math.floor(totalSeconds / 60);
    var s = totalSeconds % 60;
    return m + ':' + String(s).padStart(2, '0');
  }

  // Corner HUD showing the running session. The source of truth is the
  // session's startedAt timestamp — this renderer may tick as often as it
  // likes without drift.
  function renderFocusHud() {
    var hud = KB.el('focus-hud');
    if (!hud) return;
    var session = KB.State.focusSession();
    if (!session) {
      hud.hidden = true;
      hud.innerHTML = '';
      return;
    }
    var now = Date.now();
    hud.innerHTML = '';
    var title = h('span', { class: 'focus-hud-title' });
    title.textContent = focusCardTitle(session.cardId) || 'Focus';
    title.title = 'Focusing on this card';
    hud.appendChild(title);
    var time = h('span', { class: 'focus-hud-time' });
    if (session.kind === 'pomodoro') {
      var left = Math.max(0, Math.ceil((KB.Core.Focus.DEFAULT_POMODORO_MS - (now - session.startedAt)) / 1000));
      time.textContent = formatClock(left) + ' POMO';
    } else {
      time.textContent = KB.Core.Focus.formatEffort(Math.round((now - session.startedAt) / 60000)) + ' FOCUS';
    }
    hud.appendChild(time);
    var stop = h('button', { type: 'button', class: 'btn sm focus-hud-stop', title: 'End focus (F)' });
    stop.textContent = 'STOP';
    stop.addEventListener('click', function () {
      KB.Commands.run('focus.toggle', null);
    });
    hud.appendChild(stop);
    hud.hidden = false;
  }

  function init() {
    // The cross-tab guard must know whether this tab is read-only before the
    // first save (e.g. the defaults save on a fresh profile).
    if (KB.MultiTab) KB.MultiTab.init();
    KB.State.load().then(function () {
      KB.Commands.registerBoardSwitchCommands();
      KB.Workspaces.loadPrefs();
      applyTheme();
      bootScreen();
      mountIcons();
      KB.DnD.init(KB.el('board'));
      KB.MoveTo.wireKeyboardMove();
      KB.Select.wire();
      wireHeader();
      wireMobile();
      wireFilters();
      wireBoard();
      wireArchive();
      wireWorkspaces();
      wireKeys();
      toggleArchive(false);
      tickClock();
      setInterval(tickClock, 10000);
      renderFocusHud();
      setInterval(renderFocusHud, 1000);
      processRecurrences();
      setInterval(processRecurrences, 60000);
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') processRecurrences();
      });
      window.addEventListener('focus', processRecurrences);
      refresh();
      KB.PWA.init();
      document.documentElement.dataset.ready = '1';
    });
  }

  KB.App = {
    init: init,
    refresh: refresh,
    requestMove: requestMove,
    requestRestore: requestRestore,
    afterCardMove: afterCardMove,
    clearFilters: clearFilters,
    applyTheme: applyTheme,
    openArchive: function (open) { toggleArchive(open !== false); }
  };
  KB.UI = { toast: toast, clearToasts: clearToasts, download: download, undoAction: undoAction };

  init();
})(window.KB = window.KB || {});

