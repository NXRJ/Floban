(function (KB) {
  var h = KB.Dom.h;

  var UI_KEY = 'kanban.ui.v1';
  var workspace = 'board';
  var activeLensId = 'desk';

  function loadPrefs() {
    try {
      var raw = localStorage.getItem(UI_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed.workspace === 'string' && isValidWorkspace(parsed.workspace)) {
          workspace = parsed.workspace;
        }
        if (parsed && typeof parsed.lens === 'string') {
          activeLensId = parsed.lens;
        }
      }
    } catch (err) {
      // Corrupt prefs are indistinguishable from 'no prefs' — start from the
      // defaults rather than failing the boot.
    }
  }

  function savePrefs() {
    try {
      localStorage.setItem(UI_KEY, JSON.stringify({ workspace: workspace, lens: activeLensId }));
    } catch (err) {
      // Quota exceeded or storage disabled — prefs are best-effort; the
      // defaults are used next boot.
    }
  }

  function isValidWorkspace(name) {
    return ['board', 'mydesk', 'inbox', 'review', 'calendar', 'log', 'tuning', 'ping', 'power'].indexOf(name) !== -1;
  }

  function current() {
    return workspace;
  }

  function set(name) {
    if (!isValidWorkspace(name)) return;
    if (name === workspace) {
      KB.App.refresh();
      return;
    }
    if (workspace === 'board' && KB.Select) KB.Select.clear();
    workspace = name;
    savePrefs();
    KB.App.refresh();
  }

  function openCard(boardId, columnId, card) {
    KB.Modal.cardEditor(columnId, card, null, boardId);
  }

  function compactCard(boardId, column, card) {
    var el = h('article', { class: 'compact-card', 'data-id': card.id });
    var title = h('p', { class: 'compact-title' });
    title.textContent = card.title;
    el.appendChild(title);
    var meta = h('div', { class: 'card-meta' });
    if (card.flow && card.flow.state !== 'normal') {
      var flowChip = h('span', { class: 'chip chip-static flow flow-' + card.flow.state });
      flowChip.textContent = card.flow.state.toUpperCase();
      meta.appendChild(flowChip);
    }
    if (card.priority && card.priority !== 'none') {
      var pr = h('span', { class: 'chip chip-static priority' });
      pr.textContent = card.priority.toUpperCase();
      meta.appendChild(pr);
    }
    if (card.due) {
      var due = h('span', { class: 'chip chip-static due' });
      due.textContent = KB.Dom.fmtShortDate(card.due);
      meta.appendChild(due);
    }
    var blockers = (card.dependencies && card.dependencies.blockers) || [];
    if (blockers.length > 0) {
      var unresolved = KB.Core.Relations.getUnresolvedBlockers(KB.State.data(), { boardId: boardId, cardId: card.id });
      var dep = h('span', { class: 'chip chip-static dep' + (unresolved.length > 0 ? ' dep-blocked' : ' dep-ready') });
      dep.textContent = unresolved.length > 0 ? unresolved.length + ' BLOCKER' + (unresolved.length === 1 ? '' : 'S') : 'READY';
      meta.appendChild(dep);
    }
    el.appendChild(meta);
    el.appendChild(h('span', { class: 'compact-board', textContent: boardName(boardId) }));
    el.addEventListener('click', function () {
      openCard(boardId, column.id, card);
    });
    return el;
  }

  function boardName(boardId) {
    var board = KB.State.boards().find(function (b) { return b.id === boardId; });
    return board ? board.name : '';
  }

  function section(titleText, children) {
    var wrap = h('section', { class: 'desk-section' });
    var title = h('h2', { class: 'desk-section-title' });
    title.textContent = titleText;
    wrap.appendChild(title);
    (children || []).forEach(function (child) { wrap.appendChild(child); });
    return wrap;
  }

  function emptyNote(text) {
    var p = h('p', { class: 'desk-empty' });
    p.textContent = text;
    return p;
  }

  // ---------------- My Desk ----------------

  function myDeskCards(now) {
    var state = KB.State.data();
    var todayISO = KB.Dom.isoToday();
    var weekEndISO = KB.Dom.isoDaysFromNow(6);
    var sections = {
      blocked: [],
      dueWeek: [],
      active: [],
      ready: [],
      recentlyCompleted: []
    };
    state.boards.forEach(function (board) {
      board.columns.forEach(function (column) {
        column.cards.forEach(function (card) {
          var ref = { boardId: board.id, cardId: card.id };
          var unresolved = KB.Core.Relations.getUnresolvedBlockers(state, ref);
          var inDone = column.role === 'done';
          if (inDone) {
            if (card.completedAt && now - card.completedAt <= 7 * 86400000) {
              sections.recentlyCompleted.push({ boardId: board.id, column: column, card: card });
            }
            return;
          }
          if (unresolved.length > 0 || (card.flow && card.flow.state === 'blocked')) {
            sections.blocked.push({ boardId: board.id, column: column, card: card });
          }
          if (column.role === 'active') {
            sections.active.push({ boardId: board.id, column: column, card: card });
          }
          if (card.due && card.due >= todayISO && card.due <= weekEndISO) {
            sections.dueWeek.push({ boardId: board.id, column: column, card: card });
          }
          if (column.role === 'queue' && unresolved.length === 0 && card.flow && card.flow.state === 'normal') {
            sections.ready.push({ boardId: board.id, column: column, card: card });
          }
        });
      });
    });
    return sections;
  }

  function renderMyDesk() {
    var el = KB.el('ws-mydesk');
    el.innerHTML = '';
    var now = Date.now();

    var head = h('div', { class: 'ws-head' });
    var title = h('h2', { class: 'desk-section-title' });
    title.textContent = 'My Desk';
    head.appendChild(title);

    var lensBar = h('div', { class: 'lens-bar' });
    var deskChip = h('button', { type: 'button', class: 'chip' + (activeLensId === 'desk' ? ' active' : ''), 'data-lens': 'desk' });
    deskChip.textContent = 'Desk';
    lensBar.appendChild(deskChip);
    KB.Core.Lenses.builtInLenses().forEach(function (builtin) {
      var chip = h('button', { type: 'button', class: 'chip' + (activeLensId === builtin.id ? ' active' : ''), 'data-lens': builtin.id });
      chip.textContent = builtin.name;
      lensBar.appendChild(chip);
    });
    KB.State.lenses().forEach(function (lens) {
      var chip = h('button', { type: 'button', class: 'chip user-lens' + (activeLensId === lens.id ? ' active' : ''), 'data-lens': lens.id, title: 'Saved lens' });
      chip.textContent = lens.name;
      lensBar.appendChild(chip);
    });
    head.appendChild(lensBar);
    var saveBtn = h('button', { type: 'button', class: 'btn ghost sm', 'data-action': 'lens-save' });
    saveBtn.textContent = 'Save current view…';
    head.appendChild(h('span', { class: 'spacer' }));
    head.appendChild(saveBtn);
    el.appendChild(head);

    lensBar.addEventListener('click', function (e) {
      var chip = e.target.closest('[data-lens]');
      if (!chip) return;
      activeLensId = chip.dataset.lens;
      savePrefs();
      renderMyDesk();
    });

    saveBtn.addEventListener('click', function () {
      KB.Modal.promptModal('Save lens', 'Lens name', 'My lens', function (name) {
        var lens = KB.State.addLens(currentBoardLensDefinition(name));
        activeLensId = lens.id;
        savePrefs();
        KB.UI.toast('Lens saved', 'success', 'Undo', KB.UI.undoAction);
        renderMyDesk();
      });
    });

    if (activeLensId === 'desk') {
      var sections = myDeskCards(now);

      function renderSection(titleText, list) {
        var cards = list.map(function (entry) {
          return compactCard(entry.boardId, entry.column, entry.card);
        });
        return section(titleText, cards.length > 0 ? cards : [emptyNote('Nothing here.')]);
      }

      el.appendChild(renderSection('Blocked', sections.blocked));
      el.appendChild(renderSection('Due this week', sections.dueWeek));
      el.appendChild(renderSection('Active work', sections.active));
      el.appendChild(renderSection('Ready to pull', sections.ready));
      el.appendChild(renderSection('Recently completed', sections.recentlyCompleted));
      return;
    }

    var lens = null;
    var builtin = KB.Core.Lenses.builtInLenses().find(function (b) { return b.id === activeLensId; });
    var user = KB.State.lenses().find(function (l) { return l.id === activeLensId; });
    if (user) lens = user;
    else if (builtin) lens = builtin;

    if (!lens) {
      el.appendChild(emptyNote('Choose a lens above.'));
      return;
    }

    if (user) {
      var editRow = h('div', { class: 'lens-edit-row' });
      var editBtn = h('button', { type: 'button', class: 'btn ghost sm', 'data-action': 'lens-edit' });
      editBtn.textContent = 'Edit lens';
      var deleteBtn = h('button', { type: 'button', class: 'btn danger-ghost sm', 'data-action': 'lens-delete' });
      deleteBtn.textContent = 'Delete lens';
      editRow.appendChild(editBtn);
      editRow.appendChild(deleteBtn);
      el.appendChild(editRow);
      editBtn.addEventListener('click', function () {
        KB.Modal.lensEditor(user, function () { renderMyDesk(); });
      });
      deleteBtn.addEventListener('click', function () {
        KB.State.deleteLens(user.id);
        activeLensId = 'desk';
        savePrefs();
        KB.UI.toast('Lens deleted', 'info', 'Undo', KB.UI.undoAction);
        renderMyDesk();
      });
    }

    var groups = KB.Core.Lenses.applyLensGrouped(KB.State.data(), lens, now);
    if (groups.length === 0) {
      el.appendChild(emptyNote('No cards match this lens.'));
      return;
    }
    groups.forEach(function (group) {
      var label = group.key;
      if (lens.display.groupBy === 'board') label = boardName(group.key) || group.key;
      if (lens.display.groupBy === 'priority') label = String(group.key).toUpperCase();
      var items = group.items.map(function (result) {
        var column = null;
        var board = KB.State.boardById(result.boardId);
        if (board) column = board.columns.find(function (c) { return c.id === result.columnId; }) || null;
        if (!column) return null;
        return compactCard(result.boardId, column, result.card);
      }).filter(Boolean);
      el.appendChild(section(label, items.length > 0 ? items : [emptyNote('Nothing here.')]));
    });
  }

  function currentBoardLensDefinition(name) {
    var filters = KB.Filters.read();
    return {
      name: name,
      scope: 'active-board',
      boardIds: [],
      query: {
        search: filters.search || '',
        labelIds: filters.labels ? Array.from(filters.labels) : [],
        assignees: filters.assignee ? [filters.assignee] : [],
        due: filters.due ? filters.due : 'any',
        priorities: filters.priority ? [filters.priority] : [],
        sizes: filters.size ? [filters.size] : [],
        flowStates: filters.flowStates || [],
        blockedOnly: false,
        readyOnly: filters.readyOnly,
        columnRoles: [],
        includeCompleted: true
      },
      sort: { field: KB.Filters.sortModeValue(), direction: 'desc' },
      display: { density: 'comfortable', groupBy: 'board' }
    };
  }

  // ---------------- Review ----------------

  function reviewRow(item) {
    var row = h('div', { class: 'review-row' });
    var main = h('div', { class: 'review-main' });
    var title = h('p', { class: 'review-title' });
    title.textContent = item.card.title;
    main.appendChild(title);
    item.reasons.forEach(function (reason) {
      var p = h('p', { class: 'review-reason' });
      p.textContent = '\u25B8 ' + reason;
      main.appendChild(p);
    });
    var meta = h('div', { class: 'card-meta' });
    var boardTag = h('span', { class: 'chip chip-static' });
    boardTag.textContent = boardName(item.boardId) + ' \u00B7 ' + item.columnTitle;
    meta.appendChild(boardTag);
    if (item.card.priority && item.card.priority !== 'none') {
      var pr = h('span', { class: 'chip chip-static priority' });
      pr.textContent = item.card.priority.toUpperCase();
      meta.appendChild(pr);
    }
    main.appendChild(meta);
    row.appendChild(main);
    var actions = h('div', { class: 'review-actions' });
    var openBtn = h('button', { type: 'button', class: 'btn ghost sm', 'data-action': 'review-open' });
    openBtn.textContent = 'Open';
    var moveBtn = h('button', { type: 'button', class: 'btn ghost sm', 'data-action': 'review-move' });
    moveBtn.textContent = 'Move';
    var archiveBtn = h('button', { type: 'button', class: 'btn ghost sm', 'data-action': 'review-archive' });
    archiveBtn.textContent = 'Archive';
    actions.appendChild(openBtn);
    actions.appendChild(moveBtn);
    actions.appendChild(archiveBtn);
    row.appendChild(actions);
    row.dataset.boardId = item.boardId;
    row.dataset.columnId = item.columnId;
    row.dataset.cardId = item.card.id;
    return row;
  }

  function renderReview() {
    var el = KB.el('ws-review');
    el.innerHTML = '';
    var now = Date.now();
    var board = KB.State.activeBoard();
    var queue = KB.Core.Metrics.reviewQueue(KB.State.data(), board.id, now, {});
    var summary = KB.Core.Metrics.flowSummary(board, now);

    var summaryWrap = section('Flow summary', buildSummaryCards(summary));
    el.appendChild(summaryWrap);

    var queueWrap = section('Attention queue', queue.length > 0
      ? queue.map(reviewRow)
      : [emptyNote('Nothing needs attention right now.')]);
    el.appendChild(queueWrap);
  }

  function buildSummaryCards(summary) {
    var items = [];
    function metric(labelText, valueText) {
      var item = h('div', { class: 'metric-card' });
      var label = h('span', { class: 'metric-label' });
      label.textContent = labelText;
      var value = h('span', { class: 'metric-value' });
      value.textContent = valueText;
      item.appendChild(label);
      item.appendChild(value);
      items.push(item);
    }
    metric('Current WIP', String(summary.wip));
    metric('Completed 7d', String(summary.completed7d));
    metric('Completed 30d', String(summary.completed30d));
    metric('Median cycle time', summary.medianCycleTime === null ? '—' : Math.round(summary.medianCycleTime * 10) / 10 + 'd');
    metric('Cycle time P85', summary.cycleTimeP85 === null ? '—' : Math.round(summary.cycleTimeP85 * 10) / 10 + 'd');
    metric('SLE', summary.sle.sleDays === null
      ? (summary.sle.sampleCount === null ? '—' : 'Not enough completed work yet (' + summary.sle.sampleCount + ' samples)')
      : Math.round(summary.sle.sleDays) + 'd');
    metric('Currently blocked', String(summary.blockedTotal));
    metric('Blocked duration (completed 30d)', summary.blockedRecentlyCompletedMs === 0 ? '—' : Math.round(summary.blockedRecentlyCompletedMs / 86400000 * 10) / 10 + 'd');
    metric('Oldest active', summary.oldestActive ? summary.oldestActive.title : '—');
    summary.overWipColumns.forEach(function (bottleneck) {
      metric('Over-WIP: ' + bottleneck.title, bottleneck.explanation);
    });
    return items;
  }

  // ---------------- Inbox (rendered in the Inbox commit) ----------------

  function renderInbox() {
    var el = KB.el('ws-inbox');
    el.innerHTML = '';
    var state = KB.State.data();
    var items = state.inbox && state.inbox.items ? state.inbox.items : [];
    var open = items.filter(function (it) { return !it.archived; });
    var archived = items.filter(function (it) { return it.archived; });
    var head = h('div', { class: 'ws-head' });
    var title = h('h2', { class: 'desk-section-title' });
    title.textContent = 'Inbox';
    head.appendChild(title);
    var summary = KB.Core.Inbox.inboxSummary(state, Date.now());
    if (open.length > 0) {
      var pressure = h('span', { class: 'inbox-pressure' });
      pressure.textContent = open.length + ' unprocessed' + (summary.oldestDays !== null ? ' \u00B7 oldest: ' + summary.oldestDays + 'd' : '');
      head.appendChild(pressure);
    }
    var captureBtn = h('button', { type: 'button', class: 'btn primary sm', 'data-action': 'inbox-capture' });
    captureBtn.textContent = 'Capture…';
    head.appendChild(h('span', { class: 'spacer' }));
    head.appendChild(captureBtn);
    el.appendChild(head);
    if (open.length === 0 && archived.length === 0) {
      el.appendChild(emptyNote('Nothing captured yet. Press I to capture something quickly.'));
      return;
    }
    open.slice().sort(function (a, b) { return a.capturedAt - b.capturedAt; }).forEach(function (item) {
      el.appendChild(inboxItemEl(item, false));
    });
    if (archived.length > 0) {
      el.appendChild(section('Archived references', archived.slice().sort(function (a, b) { return a.capturedAt - b.capturedAt; }).map(function (item) {
        return inboxItemEl(item, true);
      })));
    }
  }

  function inboxItemEl(item, isArchived) {
    var wrap = h('div', { class: 'inbox-item' + (isArchived ? ' archived' : ''), 'data-id': item.id });
    var main = h('div', { class: 'inbox-main' });
    var title = h('p', { class: 'inbox-title' });
    title.textContent = item.title;
    main.appendChild(title);
    if (item.url) {
      var url = h('p', { class: 'inbox-url' });
      url.textContent = item.url;
      main.appendChild(url);
    }
    if (item.note) {
      var note = h('p', { class: 'inbox-note' });
      note.textContent = item.note;
      main.appendChild(note);
    }
    wrap.appendChild(main);
    var actions = h('div', { class: 'inbox-actions' });
    if (!isArchived) {
      var triageBtn = h('button', { type: 'button', class: 'btn ghost sm', 'data-action': 'inbox-triage' });
      triageBtn.textContent = 'Triage';
      var mergeBtn = h('button', { type: 'button', class: 'btn ghost sm', 'data-action': 'inbox-merge' });
      mergeBtn.textContent = 'Merge…';
      var deleteBtn = h('button', { type: 'button', class: 'btn danger-ghost sm', 'data-action': 'inbox-delete' });
      deleteBtn.textContent = 'Delete';
      actions.appendChild(triageBtn);
      actions.appendChild(mergeBtn);
      actions.appendChild(deleteBtn);
    } else {
      var restoreBtn = h('button', { type: 'button', class: 'btn ghost sm', 'data-action': 'inbox-restore' });
      restoreBtn.textContent = 'Restore';
      var purgeBtn = h('button', { type: 'button', class: 'btn danger-ghost sm', 'data-action': 'inbox-delete' });
      purgeBtn.textContent = 'Delete forever';
      actions.appendChild(restoreBtn);
      actions.appendChild(purgeBtn);
    }
    wrap.appendChild(actions);
    return wrap;
  }

  function inboxBadge() {
    var badge = KB.el('inbox-badge');
    var items = KB.State.data().inbox ? KB.State.data().inbox.items : [];
    var open = items.filter(function (it) { return !it.archived; });
    if (open.length > 0) {
      badge.hidden = false;
      badge.textContent = open.length;
    } else {
      badge.hidden = true;
    }
  }

  // ---------------- Date Desk (calendar) ----------------

  var calMonth = null; // 'YYYY-MM'; lazily set to the current month

  function calCurrentMonthKey() {
    if (!calMonth) {
      var d = new Date();
      calMonth = KB.Core.Calendar.monthKeyOf(d.getFullYear(), d.getMonth());
    }
    return calMonth;
  }

  function findCardRef(boardId, columnId, cardId) {
    var state = KB.State.data();
    var board = state.boards.find(function (b) { return b.id === boardId; });
    if (!board) return null;
    var column = board.columns.find(function (c) { return c.id === columnId; });
    if (!column) return null;
    return column.cards.find(function (c) { return c.id === cardId; }) || null;
  }

  function calCardColor(board, card) {
    var labelId = Array.isArray(card.labels) ? card.labels[0] : null;
    if (!labelId) return null;
    var label = board.labels.find(function (l) { return l.id === labelId; });
    return label ? label.color : null;
  }

  function calChip(ref) {
    var chip = h('button', {
      type: 'button',
      class: 'cal-chip' + (ref.completedAt ? ' done' : ''),
      draggable: 'true',
      'data-id': ref.id,
      'data-board': ref.boardId,
      'data-column': ref.columnId,
      'data-due': ref.due,
      title: (ref.completedAt ? 'Completed \u00B7 ' : '') + ref.title + ' \u00B7 drag to reschedule'
    });
    chip.textContent = ref.title;
    if (ref.color) chip.style.borderColor = ref.color;
    chip.addEventListener('click', function () {
      var card = findCardRef(ref.boardId, ref.columnId, ref.id);
      if (card) KB.Modal.cardEditor(ref.columnId, card, null, ref.boardId);
    });
    chip.addEventListener('dragstart', function (e) {
      e.dataTransfer.setData('text/plain', JSON.stringify({
        boardId: ref.boardId, columnId: ref.columnId, cardId: ref.id, fromDue: ref.due
      }));
      e.dataTransfer.effectAllowed = 'move';
      chip.classList.add('dragging');
    });
    chip.addEventListener('dragend', function () {
      chip.classList.remove('dragging');
    });
    return chip;
  }

  function renderCalendar() {
    var el = KB.el('ws-calendar');
    el.innerHTML = '';
    var state = KB.State.data();
    var cards = [];
    (state.boards || []).forEach(function (board) {
      (board.columns || []).forEach(function (column) {
        (column.cards || []).forEach(function (card) {
          cards.push({
            id: card.id, boardId: board.id, columnId: column.id, title: card.title || '',
            color: calCardColor(board, card), priority: card.priority || 'none',
            due: card.due || '', when: card.when || '', completedAt: card.completedAt || null
          });
        });
      });
    });
    var grid = KB.Core.Calendar.calendarGrid(calCurrentMonthKey(), cards, Date.now());

    var head = h('div', { class: 'ws-head' });
    var title = h('h2', { class: 'desk-section-title' });
    title.textContent = 'Date Desk';
    head.appendChild(title);
    var prev = h('button', { type: 'button', class: 'btn ghost sm', 'aria-label': 'Previous month' });
    prev.textContent = '\u2039';
    var next = h('button', { type: 'button', class: 'btn ghost sm', 'aria-label': 'Next month' });
    next.textContent = '\u203A';
    var label = h('span', { class: 'cal-label' });
    label.textContent = grid.label;
    var todayBtn = h('button', { type: 'button', class: 'btn ghost sm', 'aria-label': 'Jump to today' });
    todayBtn.textContent = 'TODAY';
    head.appendChild(prev);
    head.appendChild(next);
    head.appendChild(label);
    head.appendChild(h('span', { class: 'spacer' }));
    head.appendChild(todayBtn);
    el.appendChild(head);

    var refresh = function () { KB.App.refresh(); };
    prev.addEventListener('click', function () {
      calMonth = KB.Core.Calendar.shiftMonth(calCurrentMonthKey(), -1, Date.now());
      refresh();
    });
    next.addEventListener('click', function () {
      calMonth = KB.Core.Calendar.shiftMonth(calCurrentMonthKey(), 1, Date.now());
      refresh();
    });
    todayBtn.addEventListener('click', function () {
      var d = new Date();
      calMonth = KB.Core.Calendar.monthKeyOf(d.getFullYear(), d.getMonth());
      refresh();
    });

    if (grid.overdue.length > 0) {
      var strip = h('div', { class: 'cal-overdue' });
      var stripLabel = h('span', { class: 'cal-overdue-label' });
      stripLabel.textContent = 'OVERDUE';
      strip.appendChild(stripLabel);
      grid.overdue.forEach(function (ref) { strip.appendChild(calChip(ref)); });
      el.appendChild(strip);
    }

    var gridEl = h('div', { class: 'cal-grid' });
    ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'].forEach(function (d) {
      var hd = h('div', { class: 'cal-head' });
      hd.textContent = d;
      gridEl.appendChild(hd);
    });
    grid.weeks.forEach(function (week) {
      week.forEach(function (day) {
        var cell = h('div', {
          class: 'cal-day' + (day.inMonth ? '' : ' out') + (day.isToday ? ' today' : ''),
          tabindex: day.inMonth ? 0 : -1,
          'data-date': day.dateISO,
          'aria-label': day.dateISO
        });
        var stamp = h('span', { class: 'cal-stamp' });
        stamp.textContent = String(Number(day.dateISO.slice(8, 10)));
        cell.appendChild(stamp);
        day.cards.forEach(function (ref) { cell.appendChild(calChip(ref)); });
        if (day.inMonth) {
          cell.addEventListener('dragover', function (e) {
            if (e.dataTransfer.types.indexOf('text/plain') !== -1) {
              e.preventDefault();
              cell.classList.add('drop-target');
            }
          });
          cell.addEventListener('dragleave', function () { cell.classList.remove('drop-target'); });
          cell.addEventListener('drop', function (e) {
            e.preventDefault();
            cell.classList.remove('drop-target');
            var payload = null;
            try { payload = JSON.parse(e.dataTransfer.getData('text/plain')); } catch (err) { return; }
            if (!payload || !payload.cardId || !payload.columnId) return;
            if (payload.fromDue === day.dateISO) return;
            var moved = KB.State.updateCard(payload.columnId, payload.cardId, { due: day.dateISO });
            if (moved) {
              KB.UI.toast('Due moved to ' + KB.Dom.fmtShortDate(day.dateISO), 'success', 'Undo', KB.UI.undoAction);
              refresh();
            }
          });
        }
        gridEl.appendChild(cell);
      });
    });
    el.appendChild(gridEl);

    // Keyboard: arrows walk the in-month cells, Enter opens the first card.
    gridEl.addEventListener('keydown', function (e) {
      var cells = Array.prototype.slice.call(gridEl.querySelectorAll('.cal-day:not(.out)'));
      var index = cells.indexOf(document.activeElement);
      if (index === -1) return;
      var step = null;
      if (e.key === 'ArrowRight') step = 1;
      else if (e.key === 'ArrowLeft') step = -1;
      else if (e.key === 'ArrowDown') step = 7;
      else if (e.key === 'ArrowUp') step = -7;
      if (step !== null) {
        e.preventDefault();
        var target = (index + step + cells.length) % cells.length;
        cells[target].focus();
        return;
      }
      if (e.key === 'Enter') {
        var chip = cells[index].querySelector('.cal-chip');
        if (chip) chip.click();
      }
    });
  }

  // ---------------- Work Log (weekly ledger) ----------------

  var logWeekOffset = 0;
  // Set by renderLog, cleared whenever another workspace renders. Keeps the
  // Work Log's advertised C/P keys out of the global shortcut namespace.
  var logKeyHandler = null;

  function logCards() {
    var state = KB.State.data();
    var out = [];
    (state.boards || []).forEach(function (board) {
      var labelNames = {};
      (board.labels || []).forEach(function (l) { labelNames[l.id] = l.name; });
      function pushCard(column, card, archived) {
        out.push({
          boardId: board.id,
          boardName: board.name,
          columnId: column.id,
          cardId: card.id,
          title: card.title || '',
          labels: (card.labels || []).map(function (id) { return labelNames[id]; }).filter(Boolean),
          priority: card.priority || 'none',
          size: card.size || 'none',
          completedAt: typeof card.completedAt === 'number' ? card.completedAt : null,
          startedAt: typeof card.startedAt === 'number' ? card.startedAt : null,
          columnRole: column.role || 'queue',
          archived: Boolean(archived)
        });
      }
      (board.columns || []).forEach(function (column) {
        (column.cards || []).forEach(function (card) { pushCard(column, card, false); });
      });
      (board.archive && board.archive.columns || []).forEach(function (archivedColumn) {
        (archivedColumn.cards || []).forEach(function (card) { pushCard(archivedColumn, card, true); });
      });
      // Individually archived cards keep no column; they were completed when
      // archived, so they belong in the log's day groups (never the
      // UNSTAMPED band — archived cards are excluded there).
      (board.archive && board.archive.cards || []).forEach(function (card) {
        out.push({
          boardId: board.id,
          boardName: board.name,
          columnId: card.columnId || '',
          cardId: card.id,
          title: card.title || '',
          labels: (card.labels || []).map(function (id) { return labelNames[id]; }).filter(Boolean),
          priority: card.priority || 'none',
          size: card.size || 'none',
          completedAt: typeof card.completedAt === 'number' ? card.completedAt : null,
          startedAt: typeof card.startedAt === 'number' ? card.startedAt : null,
          columnRole: 'done',
          archived: true
        });
      });
    });
    return out;
  }

  function copyText(text, onDone) {
    var done = function () { if (onDone) onDone(); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallback(); });
      return;
    }
    fallback();
    function fallback() {
      // file:// is not a secure context — execCommand is the offline path.
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try { document.execCommand('copy'); } catch (err) { /* clipboard unavailable */ }
      ta.remove();
      done();
    }
  }

  function renderLog() {
    var el = KB.el('ws-log');
    el.innerHTML = '';
    var range = KB.Core.Worklog.weekRange(Date.now(), logWeekOffset);
    var log = KB.Core.Worklog.buildWorkLog(logCards(), range);

    var head = h('div', { class: 'ws-head' });
    var title = h('h2', { class: 'desk-section-title' });
    title.textContent = 'Work Log';
    head.appendChild(title);
    var prev = h('button', { type: 'button', class: 'btn ghost sm', 'aria-label': 'Previous week' });
    prev.textContent = '\u2039';
    var next = h('button', { type: 'button', class: 'btn ghost sm', 'aria-label': 'Next week' });
    next.textContent = '\u203A';
    var label = h('span', { class: 'log-range' });
    label.textContent = range.label;
    var copyBtn = h('button', { type: 'button', class: 'btn primary sm', 'data-log': 'copy' });
    copyBtn.textContent = 'COPY (C)';
    var printBtn = h('button', { type: 'button', class: 'btn ghost sm', 'data-log': 'print' });
    printBtn.textContent = 'PRINT (P)';
    head.appendChild(prev);
    head.appendChild(next);
    head.appendChild(label);
    head.appendChild(h('span', { class: 'spacer' }));
    head.appendChild(printBtn);
    head.appendChild(copyBtn);
    el.appendChild(head);

    var refresh = function () { KB.App.refresh(); };
    prev.addEventListener('click', function () { logWeekOffset -= 1; refresh(); });
    next.addEventListener('click', function () { logWeekOffset += 1; refresh(); });
    copyBtn.addEventListener('click', function () {
      var text = KB.Core.Worklog.composeLog(log, {});
      copyText(text, function () { KB.UI.toast('Log copied to clipboard', 'success'); });
    });
    printBtn.addEventListener('click', function () { window.print(); });
    // The buttons advertise C and P. Without this the global dispatcher would
    // claim them first — C opens the column editor, P jumps to PING — so the
    // Work Log registers them for the duration of this render.
    logKeyHandler = function (key) {
      if (key === 'c') { copyBtn.click(); return true; }
      if (key === 'p') { printBtn.click(); return true; }
      return false;
    };

    var masthead = h('div', { class: 'log-masthead' });
    var done = h('span', { class: 'log-done' });
    done.textContent = log.stats.total + (log.stats.total === 1 ? ' CARD DONE' : ' CARDS DONE');
    masthead.appendChild(done);
    log.stats.perBoard.forEach(function (b) {
      var chip = h('span', { class: 'chip chip-static log-board-count' });
      chip.textContent = b.boardName + ' \u00B7 ' + b.count;
      masthead.appendChild(chip);
    });
    el.appendChild(masthead);

    if (log.unstamped.length > 0) {
      var band = h('div', { class: 'log-unstamped' });
      var bandLabel = h('span', { class: 'log-unstamped-label' });
      bandLabel.textContent = 'UNSTAMPED';
      band.appendChild(bandLabel);
      log.unstamped.forEach(function (card) {
        var row = h('div', { class: 'log-unstamped-row' });
        var t = h('span', { class: 'log-row-title' });
        t.textContent = card.title;
        row.appendChild(t);
        var b = h('span', { class: 'log-board' });
        b.textContent = card.boardName;
        row.appendChild(b);
        row.appendChild(h('span', { class: 'spacer' }));
        var stampBtn = h('button', { type: 'button', class: 'btn ghost sm', 'data-log': 'stamp' });
        stampBtn.textContent = 'STAMP';
        stampBtn.title = 'Complete through the lifecycle so it lands in the log';
        stampBtn.addEventListener('click', function () {
          // The card is already sitting in a done-role column (that is what
          // put it in the band); same-column moves never run the lifecycle
          // transition, so stamp completedAt directly — one history entry.
          var stamped = KB.State.updateCard(card.columnId, card.cardId, { completedAt: Date.now() });
          if (stamped) {
            KB.UI.toast('Stamped', 'success', 'Undo', KB.UI.undoAction);
            refresh();
          } else {
            KB.UI.toast('Could not stamp this card', 'error');
          }
        });
        row.appendChild(stampBtn);
        band.appendChild(row);
      });
      el.appendChild(band);
    }

    if (log.days.length === 0) {
      el.appendChild(emptyNote('Nothing completed in this range. Move cards into a Done column to grow the log.'));
    } else {
      var cols = h('div', { class: 'log-days' });
      log.days.forEach(function (day) {
        var col = h('div', { class: 'log-day' });
        var stamp = h('span', { class: 'log-day-stamp' });
        stamp.textContent = KB.Dom.fmtShortDate(day.dateISO);
        col.appendChild(stamp);
        day.items.forEach(function (item) {
          var row = h('div', { class: 'log-row' });
          var t = h('span', { class: 'log-row-title' });
          t.textContent = item.title;
          row.appendChild(t);
          if (item.labels.length > 0) {
            var lc = h('span', { class: 'chip chip-static log-label' });
            lc.textContent = item.labels[0];
            row.appendChild(lc);
          }
          var cycle = KB.Core.Worklog.cycleDays(item);
          if (cycle !== null && cycle >= 3) {
            var cc = h('span', { class: 'chip chip-static log-cycle' });
            cc.textContent = cycle + 'd';
            row.appendChild(cc);
          }
          col.appendChild(row);
        });
        cols.appendChild(col);
      });
      el.appendChild(cols);
    }
  }

  function render() {
    var isBoard = workspace === 'board';
    KB.el('board-area').hidden = !isBoard;
    KB.el('ws-mydesk').hidden = workspace !== 'mydesk';
    KB.el('ws-inbox').hidden = workspace !== 'inbox';
    KB.el('ws-review').hidden = workspace !== 'review';
    KB.el('ws-calendar').hidden = workspace !== 'calendar';
    KB.el('ws-log').hidden = workspace !== 'log';
    KB.el('ws-tuning').hidden = workspace !== 'tuning';
    KB.el('ws-ping').hidden = workspace !== 'ping';
    KB.el('ws-power').hidden = workspace !== 'power';
    document.querySelectorAll('.ws-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.workspace === workspace);
    });
    var globalWs = workspace !== 'board';
    KB.el('board-switch').style.display = globalWs ? 'none' : '';
    KB.el('add-column').style.display = globalWs ? 'none' : '';
    KB.el('manage-labels').style.display = globalWs ? 'none' : '';
    KB.el('toggle-archive').style.display = globalWs ? 'none' : '';
    logKeyHandler = null; // renderLog re-arms it; every other workspace clears it
    if (workspace === 'review') renderReview();
    else if (workspace === 'mydesk') renderMyDesk();
    else if (workspace === 'inbox') renderInbox();
    else if (workspace === 'calendar') renderCalendar();
    else if (workspace === 'log') renderLog();
    else if (workspace === 'tuning') renderTuning();
    else if (workspace === 'ping') renderPing();
    else if (workspace === 'power') renderPower();
  }

  // ---------------- TUNING (estimate-vs-actual calibration) ----------------

  // All cards across every board (live + archived) — the same source the
  // Work Log and metrics use. Calibration is personal, not per-board.
  function tuningCards() {
    var state = KB.State.data();
    var out = [];
    (state.boards || []).forEach(function (board) {
      (board.columns || []).forEach(function (column) {
        (column.cards || []).forEach(function (card) {
          out.push(card);
        });
      });
      var archive = board.archive || {};
      (archive.columns || []).forEach(function (ac) {
        (ac.cards || []).forEach(function (card) { out.push(card); });
      });
      (archive.cards || []).forEach(function (card) { out.push(card); });
    });
    return out;
  }

  function tuningGauge(size, entry) {
    var wrap = h('div', { class: 'tune-gauge' });
    var head = h('div', { class: 'tune-gauge-head' });
    var name = h('span', { class: 'tune-gauge-size' });
    name.textContent = size;
    head.appendChild(name);
    var val = h('span', { class: 'tune-gauge-value' });
    if (entry.n === 0) {
      val.textContent = 'NO DATA';
      val.classList.add('empty');
    } else {
      val.textContent = entry.medianDays === null ? '—' : (Math.round(entry.medianDays * 10) / 10) + 'd';
    }
    head.appendChild(val);
    wrap.appendChild(head);
    var track = h('div', { class: 'tune-gauge-track' });
    var fill = h('div', { class: 'tune-gauge-fill' });
    if (entry.medianDays !== null) {
      // Scale: XL (3d fallback) maps to full width.
      var pct = Math.min(100, (entry.medianDays / 3) * 100);
      fill.style.width = pct + '%';
    } else {
      fill.classList.add('off');
    }
    track.appendChild(fill);
    wrap.appendChild(track);
    var meta = h('div', { class: 'tune-gauge-meta' });
    if (entry.n > 0) {
      meta.textContent = 'n=' + entry.n + (entry.p85Days !== null ? ' \u00B7 p85 ' + (Math.round(entry.p85Days * 10) / 10) + 'd' : '');
    } else {
      meta.textContent = 'complete sized cards to calibrate';
    }
    wrap.appendChild(meta);
    return wrap;
  }

  function renderTuning() {
    var el = KB.el('ws-tuning');
    el.innerHTML = '';
    var now = Date.now();
    var cards = tuningCards();
    var cal = KB.Core.Calibrate.calibrate(cards, now);
    var capacity = KB.Core.Calibrate.dailyCapacityDays(cards, now);

    var head = h('div', { class: 'ws-head' });
    var title = h('h2', { class: 'desk-section-title' });
    title.textContent = 'TUNING \u00B7 ESTIMATE VS ACTUAL';
    head.appendChild(title);
    head.appendChild(h('span', { class: 'spacer' }));
    var asOf = h('span', { class: 'tune-asof' });
    asOf.textContent = 'AS OF ' + cal.asOfISO;
    head.appendChild(asOf);
    el.appendChild(head);

    var hint = h('p', { class: 'form-hint' });
    hint.textContent = 'Your size estimates (XS\u2013XL) vs the real cycle times the board recorded. Every sized card you complete sharpens these numbers — they feed the Day Sheet reality check and the card editor.';
    el.appendChild(hint);

    if (!cal.ready) {
      var empty = h('div', { class: 'tune-empty' });
      var emptyTitle = h('span', { class: 'tune-empty-title' });
      emptyTitle.textContent = 'NO DATA YET';
      empty.appendChild(emptyTitle);
      var emptySub = h('p');
      emptySub.textContent = 'Complete at least ' + KB.Core.Calibrate.MIN_SAMPLES + ' cards that carry a size (XS\u2013XL). Quick-add accepts size tokens: "Ship 1.0 #M".';
      empty.appendChild(emptySub);
      el.appendChild(empty);
    }

    var gauges = h('div', { class: 'tune-gauges' });
    KB.Core.Calibrate.SIZES.forEach(function (size) {
      gauges.appendChild(tuningGauge(size, cal.bySize[size]));
    });
    el.appendChild(gauges);

    var capacityRow = h('div', { class: 'tune-capacity' });
    var capLabel = h('span', { class: 'tune-capacity-label' });
    capLabel.textContent = 'YOUR REALISTIC DAY';
    capacityRow.appendChild(capLabel);
    var capVal = h('span', { class: 'tune-capacity-value' });
    capVal.textContent = (Math.round(capacity * 10) / 10) + 'd';
    capVal.title = 'Median daily completed workload over the last 14 days';
    capacityRow.appendChild(capVal);
    el.appendChild(capacityRow);

    var drift = h('div', { class: 'tune-drift' });
    var driftLabel = h('span', { class: 'tune-drift-label' });
    driftLabel.textContent = 'PLANNING DRIFT';
    drift.appendChild(driftLabel);
    var driftVal = h('span', { class: 'tune-drift-value' });
    var global = cal.global.medianDays;
    if (global !== null) {
      driftVal.textContent = 'M \u2248 ' + (Math.round(global * 10) / 10) + 'd \u2014 ' +
        (global > 1 ? 'you plan like a day holds ' + (Math.round(global * 10) / 10) + 'd' : 'your plans run close to your days');
    } else {
      driftVal.textContent = 'NO SAMPLES YET';
    }
    drift.appendChild(driftVal);
    el.appendChild(drift);

    var line = h('p', { class: 'tune-hint' });
    line.textContent = 'The Day Sheet now shows "3 PICKS \u2248 5.2D \u2014 YOUR REALISTIC DAY \u2248 1.4D" when a pick band is overloaded. Sizes are honest here.';
    el.appendChild(line);
  }

  // ---------------- PING (waiting-card follow-up engine) ----------------

  function renderPing() {
    var el = KB.el('ws-ping');
    el.innerHTML = '';
    var now = Date.now();
    var cards = KB.State.pingCards();

    var head = h('div', { class: 'ws-head' });
    var title = h('h2', { class: 'desk-section-title' });
    title.textContent = 'PING \u00B7 WHO OWNS THE BALL';
    head.appendChild(title);
    head.appendChild(h('span', { class: 'spacer' }));
    var hintBtn = h('span', { class: 'tune-asof' });
    hintBtn.textContent = 'WAITING CARDS WITH A FOLLOW-UP CLOCK';
    head.appendChild(hintBtn);
    el.appendChild(head);

    var due = KB.Core.Ping.duePings(cards, now);
    var fresh = cards.filter(function (card) {
      return KB.Core.Ping.pingStatus(card, now).state === 'fresh';
    });

    if (due.length > 0) {
      var band = h('div', { class: 'ping-band' });
      var bandLabel = h('span', { class: 'ping-band-label' });
      bandLabel.textContent = 'DUE PINGS';
      band.appendChild(bandLabel);
      due.forEach(function (card) {
        band.appendChild(pingRow(card, now));
      });
      el.appendChild(band);
    }

    var groups = KB.Core.Ping.byContact(cards, now);
    if (groups.length > 0) {
      var groupBand = h('div', { class: 'ping-group-band' });
      var groupLabel = h('span', { class: 'ping-band-label' });
      groupLabel.textContent = 'WHOSE BALL';
      groupBand.appendChild(groupLabel);
      groups.forEach(function (group) {
        var g = h('div', { class: 'ping-group' });
        var gHead = h('div', { class: 'ping-group-head' });
        var contact = h('span', { class: 'ping-contact' });
        contact.textContent = group.contact;
        gHead.appendChild(contact);
        var meta = h('span', { class: 'ping-group-meta' });
        meta.textContent = group.items.length + ' CARD' + (group.items.length === 1 ? '' : 'S') +
          (group.worstDaysOverdue !== null ? ' \u00B7 RADIO SILENCE ' + group.worstDaysOverdue + 'D' : '');
        gHead.appendChild(meta);
        g.appendChild(gHead);
        group.items.forEach(function (item) {
          var row = h('div', { class: 'ping-row quiet' });
          var t = h('span', { class: 'ping-row-title' });
          t.textContent = item.title;
          row.appendChild(t);
          var st = h('span', { class: 'chip chip-static ping-status' });
          st.textContent = item.status.state.toUpperCase() + (item.status.daysOverdue !== null ? ' ' + item.status.daysOverdue + 'D' : '');
          row.appendChild(st);
          row.appendChild(h('span', { class: 'spacer' }));
          var pokeBtn = h('button', { type: 'button', class: 'btn sm primary ping-poke', 'data-ping-id': item.cardId });
          pokeBtn.textContent = 'POKE';
          row.appendChild(pokeBtn);
          g.appendChild(row);
        });
        groupBand.appendChild(g);
      });
      el.appendChild(groupBand);
    }

    if (fresh.length > 0) {
      var freshBand = h('div', { class: 'ping-band' });
      var freshLabel = h('span', { class: 'ping-band-label' });
      freshLabel.textContent = 'ARMED \u00B7 FRESH';
      freshBand.appendChild(freshLabel);
      fresh.forEach(function (card) {
        freshBand.appendChild(pingRow(card, now));
      });
      el.appendChild(freshBand);
    }

    if (due.length === 0 && groups.length === 0 && fresh.length === 0) {
      el.appendChild(emptyNote('No waiting cards with a follow-up. Set a card to Waiting, then arm it with PING from the card editor.'));
    }

    // One delegated POKE handler.
    el.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-ping-id]');
      if (!btn) return;
      var cardId = btn.dataset.pingId;
      var result = KB.State.pokeCard(cardId, '');
      if (result) {
        KB.UI.toast('Poked \u2014 next follow-up scheduled', 'success', 'Undo', KB.UI.undoAction);
        KB.App.refresh();
      }
    });
  }

  function pingRow(card, now) {
    var status = KB.Core.Ping.pingStatus(card, now);
    var row = h('div', { class: 'ping-row' + (status.state === 'overdue' ? ' overdue' : '') });
    var t = h('span', { class: 'ping-row-title' });
    t.textContent = card.title || '';
    row.appendChild(t);
    if (card.ping.contact) {
      var c = h('span', { class: 'chip chip-static ping-contact-chip' });
      c.textContent = card.ping.contact;
      row.appendChild(c);
    }
    var st = h('span', { class: 'chip chip-static ping-status' });
    if (status.state === 'overdue') {
      st.textContent = 'OVERDUE ' + status.daysOverdue + 'D';
    } else if (status.state === 'due') {
      st.textContent = 'DUE ' + status.daysUntil + 'D';
    } else {
      st.textContent = '+' + status.daysUntil + 'D';
    }
    row.appendChild(st);
    if (card.ping.pokedCount > 0) {
      var p = h('span', { class: 'chip chip-static ping-pokes' });
      p.textContent = card.ping.pokedCount + ' POKE' + (card.ping.pokedCount === 1 ? '' : 'S');
      row.appendChild(p);
    }
    row.appendChild(h('span', { class: 'spacer' }));
    var pokeBtn = h('button', { type: 'button', class: 'btn sm primary ping-poke', 'data-ping-id': card.id });
    pokeBtn.textContent = 'POKE';
    pokeBtn.title = 'Record a follow-up and roll the next date';
    row.appendChild(pokeBtn);
    return row;
  }

  // ---------------- POWER METER (state-aware picking) ----------------

  function powerCards() {
    var state = KB.State.data();
    var out = [];
    (state.boards || []).forEach(function (board) {
      (board.columns || []).forEach(function (column) {
        (column.cards || []).forEach(function (card) {
          out.push(Object.assign({}, card, { _boardId: board.id, _columnId: column.id }));
        });
      });
    });
    return out;
  }

  function powerCalibration() {
    var cards = powerCards();
    return KB.Core.Calibrate.calibrate(cards, Date.now());
  }

  function powerContext() {
    var power = KB.State.powerState();
    var cal = powerCalibration();
    var cards = powerCards();
    var tolerance = KB.Core.Power.BAND_TOLERANCE[power.band] !== undefined ? KB.Core.Power.BAND_TOLERANCE[power.band] : 0.75;
    var curve = KB.Core.Power.powerCurve(cards, KB.State.data().focusDays, Date.now(), {
      demandFor: function (card) { return KB.Core.Power.energyFor(card, { estimateDays: KB.Core.Calibrate.estimateDays, calibration: cal }); }
    });
    return {
      band: power.band,
      timeBudgetMin: power.timeBudgetMin,
      tolerance: tolerance,
      cal: cal,
      curve: curve,
      cards: cards,
      levelAtHour: curve.levelAtHour,
      estimateDays: function (card) { return KB.Core.Calibrate.estimateDays(card.size, cal); },
      demandFor: function (card) { return KB.Core.Power.energyFor(card, { estimateDays: KB.Core.Calibrate.estimateDays, calibration: cal }); }
    };
  }

  function powerPickEl() {
    var ctx = powerContext();
    var result = KB.Core.Power.pickBest(ctx.cards, ctx);
    var wrap = h('div', { class: 'power-pick' });
    var head = h('div', { class: 'power-pick-head' });
    var label = h('span', { class: 'power-pick-label' });
    label.textContent = 'NOW PICK';
    head.appendChild(label);
    var bandChip = h('span', { class: 'chip chip-static power-band band-' + ctx.band });
    bandChip.textContent = ctx.band.toUpperCase();
    head.appendChild(bandChip);
    if (ctx.timeBudgetMin) {
      var budgetChip = h('span', { class: 'chip chip-static power-budget' });
      budgetChip.textContent = ctx.timeBudgetMin + ' MIN';
      head.appendChild(budgetChip);
    }
    wrap.appendChild(head);

    if (!result.top) {
      var none = h('p', { class: 'power-none' });
      none.textContent = 'Nothing fits your current state. Switch bands or lower the bar.';
      wrap.appendChild(none);
      return wrap;
    }
    var top = h('div', { class: 'power-top' });
    var t = h('span', { class: 'power-top-title' });
    t.textContent = result.top.title || '';
    top.appendChild(t);
    var size = h('span', { class: 'chip chip-static power-size' });
    size.textContent = String(result.top.size || 'none').toUpperCase();
    top.appendChild(size);
    var reason = h('span', { class: 'power-reason' });
    var demand = ctx.demandFor(result.top);
    reason.textContent = ctx.band === 'low' || ctx.band === 'drained'
      ? 'low power \u2014 quick win fits the band'
      : (demand >= 0.75 ? 'deep-work hour \u2014 this is your heavy lift' : 'balanced \u2014 fits your current state');
    top.appendChild(reason);
    wrap.appendChild(top);

    if (result.alternates.length > 0) {
      var alts = h('div', { class: 'power-alts' });
      var altsLabel = h('span', { class: 'power-alts-label' });
      altsLabel.textContent = 'ALTERNATES';
      alts.appendChild(altsLabel);
      result.alternates.forEach(function (card) {
        var row = h('div', { class: 'power-alt-row' });
        var t2 = h('span', { class: 'power-alt-title' });
        t2.textContent = card.title || '';
        row.appendChild(t2);
        alts.appendChild(row);
      });
      wrap.appendChild(alts);
    }
    return wrap;
  }

  function renderPower() {
    var el = KB.el('ws-power');
    el.innerHTML = '';
    var ctx = powerContext();

    var head = h('div', { class: 'ws-head' });
    var title = h('h2', { class: 'desk-section-title' });
    title.textContent = 'POWER METER \u00B7 WHAT CAN I DO NOW?';
    head.appendChild(title);
    head.appendChild(h('span', { class: 'spacer' }));
    var curveLabel = h('span', { class: 'tune-asof' });
    curveLabel.textContent = ctx.curve.learned
      ? 'PEAK ' + String(ctx.curve.peakHour).padStart(2, '0') + ':00' + (ctx.curve.troughHour !== -1 ? ' \u00B7 TROUGH ' + String(ctx.curve.troughHour).padStart(2, '0') + ':00' : '')
      : 'LEARNING YOUR CURVE\u2026';
    head.appendChild(curveLabel);
    el.appendChild(head);

    var hint = h('p', { class: 'form-hint' });
    hint.textContent = 'Declare your power band and the board picks the card that fits — from your own completion and focus history, not a quiz.';
    el.appendChild(hint);

    var bands = h('div', { class: 'power-bands' });
    KB.Core.Power.BANDS.forEach(function (band) {
      var btn = h('button', { type: 'button', class: 'power-band-btn' + (ctx.band === band ? ' active' : ''), 'data-band': band });
      btn.textContent = band.toUpperCase();
      btn.title = 'Demand tolerance: ' + (KB.Core.Power.BAND_TOLERANCE[band] * 100) + '%';
      bands.appendChild(btn);
    });
    var budgetBtn = h('button', { type: 'button', class: 'power-budget-btn' + (ctx.timeBudgetMin ? ' active' : ''), 'data-budget': 'toggle' });
    budgetBtn.textContent = ctx.timeBudgetMin ? ctx.timeBudgetMin + ' MIN WINDOW' : '5-MIN WINDOW';
    bands.appendChild(budgetBtn);
    el.appendChild(bands);

    bands.addEventListener('click', function (e) {
      var b = e.target.closest('[data-band]');
      if (b) {
        KB.State.setPowerBand(b.dataset.band);
        KB.App.refresh();
        return;
      }
      var bg = e.target.closest('[data-budget]');
      if (bg) {
        KB.State.setPowerTimeBudget(ctx.timeBudgetMin ? null : 5);
        KB.App.refresh();
      }
    });

    el.appendChild(powerPickEl());

    var curveRow = h('div', { class: 'power-curve' });
    var curveLabel2 = h('span', { class: 'power-curve-label' });
    curveLabel2.textContent = 'YOUR POWER CURVE (24H)';
    curveRow.appendChild(curveLabel2);
    var bars = h('div', { class: 'power-bars' });
    for (var hi = 0; hi < 24; hi++) {
      var bar = h('i', { class: 'power-bar' });
      var level = ctx.levelAtHour(hi);
      bar.style.height = Math.round(level * 100) + '%';
      bar.title = String(hi).padStart(2, '0') + ':00 \u00B7 ' + Math.round(level * 100) + '%';
      if (ctx.curve.peakHour === hi) bar.classList.add('peak');
      bars.appendChild(bar);
    }
    curveRow.appendChild(bars);
    el.appendChild(curveRow);

    var line = h('p', { class: 'tune-hint' });
    var focusDays = KB.State.data().focusDays;
    line.textContent = ctx.curve.learned
      ? 'Curve learned from your ' + (focusDays ? Object.keys(focusDays).length : 0) + ' focus day(s) and completed cards.'
      : 'Complete sized cards and run focus sessions \u2014 the curve learns your best hours.';
    el.appendChild(line);
  }

  function openBoard() {
    KB.Workspaces.set('board');
  }

  // Workspace-scoped shortcuts get first refusal, before the global command
  // dispatcher. Returns true when the key was consumed.
  function handleKey(key) {
    if (current() === 'log' && logKeyHandler) return logKeyHandler(key);
    return false;
  }

  KB.Workspaces = {
    loadPrefs: loadPrefs,
    current: current,
    set: set,
    render: render,
    handleKey: handleKey,
    openCard: openCard,
    openBoard: openBoard,
    inboxBadge: inboxBadge
  };
})(window.KB = window.KB || {});
