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
    document.documentElement.dataset.theme = KB.State.data().theme;
  }

  function refresh() {
    applyTheme();
    KB.Render.board();
    KB.Render.filterBar();
    KB.Render.archivePanel();
    refreshHeader();
    updateBoardOverflow();
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
          KB.State.addCard(columnId, {
            title: template.title,
            description: template.description,
            labels: (template.labels || []).slice(),
            assignee: template.assignee,
            priority: template.priority || 'none',
            size: template.size || 'none',
            checklist: (template.checklist || []).map(function (item) {
              return { id: KB.Dom.uid('ck'), text: item.text, done: false };
            })
          });
          toast('Card created from template', 'success', 'Undo', undoAction);
          KB.App.refresh();
        });
        popEl.appendChild(item);
      });
    });
  }

  function submitQuickAdd(input) {
    var list = input.closest('.card-list');
    if (!list) return;
    var columnId = list.dataset.columnId;
    var lines = input.value.split('\n').map(function (line) { return line.trim(); }).filter(Boolean);
    if (lines.length === 0) return;
    var added = KB.State.addCards(columnId, lines);
    input.value = '';
    toast(KB.Dom.plural(added, 'card') + ' added', 'success', 'Undo', undoAction);
    KB.App.refresh();
    var fresh = KB.el('board').querySelector('.card-list[data-column-id="' + columnId + '"] .qa-input');
    if (fresh) fresh.focus();
  }

  function requestMove(fromColumnId, cardId, toColumnId, toIndex, onDone) {
    var evaluation = KB.State.evaluateMove(fromColumnId, cardId, toColumnId);
    if (!evaluation) {
      if (onDone) onDone();
      return;
    }
    if (evaluation.allowed) {
      KB.State.moveCardChecked(fromColumnId, cardId, toColumnId, toIndex);
      if (onDone) onDone();
      return;
    }
    KB.Modal.moveConfirmModal('Move requires confirmation', evaluation, '', function (reason) {
      KB.State.moveCardChecked(fromColumnId, cardId, toColumnId, toIndex, { confirmed: true, overrideReason: reason });
      if (onDone) onDone();
    });
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

  function wireBoard() {
    KB.el('board-area').addEventListener('click', function (e) {
      var actionEl = e.target.closest('[data-action]');
      if (!actionEl) return;
      var action = actionEl.dataset.action;
      var columnEl = e.target.closest('.column');
      var cardEl = e.target.closest('.card');
      var columnId = columnEl ? columnEl.dataset.id : null;
      var cardId = cardEl ? cardEl.dataset.id : null;

      switch (action) {
        case 'col-add':
          KB.Modal.cardEditor(columnId, null);
          break;
        case 'col-menu':
          KB.Modal.columnEditor(columnId);
          break;
        case 'col-collapse': {
          var column = KB.State.findColumn(columnId);
          if (column) {
            KB.State.updateColumn(columnId, { collapsed: !column.collapsed });
            refresh();
          }
          break;
        }
        case 'add-column-empty':
          KB.Modal.columnEditor(null);
          break;
        case 'edit-card':
          KB.Modal.cardEditor(columnId, KB.State.findCard(columnId, cardId));
          break;
        case 'duplicate-card':
          KB.State.duplicateCard(columnId, cardId);
          toast('Card duplicated', 'success', 'Undo', undoAction);
          refresh();
          break;
        case 'archive-card':
          KB.State.archiveCard(columnId, cardId);
          toast('Card archived', 'info', 'Undo', undoAction);
          refresh();
          break;
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

  function wireKeys() {
    window.addEventListener('resize', updateBoardOverflow);
    document.addEventListener('keydown', function (e) {
      var tag = document.activeElement && document.activeElement.tagName;
      var typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      var mod = e.ctrlKey || e.metaKey;

      if (mod && (e.key === 'z' || e.key === 'Z')) {
        if (typing || KB.Modal.isOpen()) return;
        e.preventDefault();
        if (e.shiftKey) {
          if (KB.State.redo()) refresh();
        } else if (KB.State.undo()) {
          refresh();
        }
        return;
      }
      if (mod && (e.key === 'y' || e.key === 'Y')) {
        if (typing || KB.Modal.isOpen()) return;
        e.preventDefault();
        if (KB.State.redo()) refresh();
        return;
      }
      if (e.key === '/') {
        if (typing) return;
        e.preventDefault();
        KB.el('search-input').focus();
        return;
      }
      if (typing || mod || e.altKey) return;
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        var qa = KB.el('board').querySelector('.qa-input');
        if (qa) qa.focus();
      } else if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        KB.Modal.columnEditor(null);
      }
    });
  }

  function mountIcons() {
    KB.el('board-switch').querySelector('.btn-icon').innerHTML = icon('board');
    KB.el('board-switch').querySelector('.btn-caret').innerHTML = icon('chevronDown');
    KB.el('add-column').querySelector('.btn-icon').innerHTML = icon('plus');
    KB.el('manage-labels').querySelector('.btn-icon').innerHTML = icon('palette');
    KB.el('toggle-archive').querySelector('.btn-icon').innerHTML = icon('archive');
    KB.el('toggle-theme').querySelector('.icon-sun').innerHTML = icon('sun');
    KB.el('toggle-theme').querySelector('.icon-moon').innerHTML = icon('moon');
    KB.el('search-input').previousElementSibling.innerHTML = icon('search');
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
      var state = KB.State.data();
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

    function bootSequence() {
      var log = KB.el('hs-boot');
      var lines = bootLines();
      if (reduced) {
        lines.forEach(function (line) {
          var p = document.createElement('p');
          var span = document.createElement('span');
          span.className = 'c-' + line.c;
          span.textContent = line.t;
          p.appendChild(span);
          log.appendChild(p);
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
        var line = lines[i];
        var p = document.createElement('p');
        var span = document.createElement('span');
        span.className = 'c-' + line.c;
        span.textContent = line.t;
        p.appendChild(span);
        if (i === lines.length - 1) {
          var caret = document.createElement('span');
          caret.className = 'hs-caret';
          p.appendChild(caret);
        }
        log.appendChild(p);
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

  function init() {
    KB.State.load();
    applyTheme();
    bootScreen();
    mountIcons();
    KB.DnD.init(KB.el('board'));
    wireHeader();
    wireFilters();
    wireBoard();
    wireArchive();
    wireKeys();
    toggleArchive(false);
    tickClock();
    setInterval(tickClock, 10000);
    refresh();
  }

  KB.App = { init: init, refresh: refresh, requestMove: requestMove, requestRestore: requestRestore };
  KB.UI = { toast: toast, clearToasts: clearToasts, download: download, undoAction: undoAction };

  init();
})(window.KB = window.KB || {});
