(function (KB) {
  var icon = KB.Dom.icon;

  var searchTimer = null;

  function toast(message, type) {
    var el = KB.Dom.h('div', { class: 'toast ' + (type || 'info') });
    el.textContent = message;
    KB.el('toast-root').appendChild(el);
    setTimeout(function () {
      el.classList.add('out');
      setTimeout(function () { el.remove(); }, 300);
    }, 2600);
  }

  function applyTheme() {
    document.documentElement.dataset.theme = KB.State.data().theme;
  }

  function refresh() {
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
    var archive = KB.State.data().archive;
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
    KB.Filters.selected.clear();
    refresh();
  }

  function toggleArchive(open) {
    KB.el('archive-panel').classList.toggle('open', open);
    KB.el('archive-backdrop').classList.toggle('show', open);
  }

  function wireHeader() {
    KB.el('toggle-theme').addEventListener('click', function () {
      var next = KB.State.data().theme === 'dark' ? 'light' : 'dark';
      KB.State.setTheme(next);
      applyTheme();
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
        case 'add-column-empty':
          KB.Modal.columnEditor(null);
          break;
        case 'edit-card':
          KB.Modal.cardEditor(columnId, KB.State.findCard(columnId, cardId));
          break;
        case 'archive-card':
          KB.State.archiveCard(columnId, cardId);
          toast('Card archived', 'info');
          refresh();
          break;
        case 'clear-filters':
          clearFilters();
          break;
      }
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
          KB.State.restoreCard(id);
          toast('Card restored', 'success');
          refresh();
          break;
        case 'restore-column':
          KB.State.restoreColumn(id);
          toast('Column restored', 'success');
          refresh();
          break;
        case 'purge-card':
          if (confirm('Delete this card permanently? This cannot be undone.')) {
            KB.State.purgeCard(id);
            toast('Card deleted permanently', 'info');
            refresh();
          }
          break;
        case 'purge-column':
          if (confirm('Delete this column and its cards permanently? This cannot be undone.')) {
            KB.State.purgeColumn(id);
            toast('Column deleted permanently', 'info');
            refresh();
          }
          break;
      }
    });
  }

  function wireKeys() {
    window.addEventListener('resize', updateBoardOverflow);
    document.addEventListener('keydown', function (e) {      if (e.key !== '/') return;
      var tag = document.activeElement && document.activeElement.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      e.preventDefault();
      KB.el('search-input').focus();
    });
  }

  function mountIcons() {
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
    var mascot = { jump: function () {}, stop: function () {} };

    function bootLines() {
      var state = KB.State.data();
      var cols = state.columns.length;
      var cards = state.columns.reduce(function (n, c) { return n + c.cards.length; }, 0);
      var archived = state.archive.cards.length + state.archive.columns.length;
      return [
        { t: 'KANBAN/OS v4.0.4  ·  THE 8-BIT ATELIER', c: 'chrome' },
        { t: 'MEM 64K OK · CRT 60HZ', c: 'muted' },
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
      mascot.jump();
      setTimeout(function () { overlay.classList.add('off'); }, 700);
      setTimeout(function () {
        overlay.remove();
        mascot.stop();
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

  KB.App = { init: init, refresh: refresh, clearFilters: clearFilters };
  KB.UI = { toast: toast, el: KB.el };

  init();
})(window.KB = window.KB || {});
