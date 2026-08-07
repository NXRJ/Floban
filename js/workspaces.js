(function (KB) {
  var h = KB.Dom.h;
  var icon = KB.Dom.icon;

  var UI_KEY = 'kanban.ui.v1';
  var workspace = 'board';

  function loadPrefs() {
    try {
      var raw = localStorage.getItem(UI_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed.workspace === 'string' && isValidWorkspace(parsed.workspace)) {
          workspace = parsed.workspace;
        }
      }
    } catch (err) {}
  }

  function savePrefs() {
    try {
      localStorage.setItem(UI_KEY, JSON.stringify({ workspace: workspace }));
    } catch (err) {}
  }

  function isValidWorkspace(name) {
    return ['board', 'mydesk', 'inbox', 'review'].indexOf(name) !== -1;
  }

  function current() {
    return workspace;
  }

  function set(name) {
    if (!isValidWorkspace(name) || name === workspace) {
      if (name === workspace) {
        KB.App.refresh();
      }
      return;
    }
    workspace = name;
    savePrefs();
    KB.App.refresh();
  }

  function openCard(boardId, columnId, card) {
    KB.Modal.cardEditor(columnId, card, null, boardId);
  }

  function fmtShortDate(iso) {
    var parts = String(iso).split('-');
    if (parts.length !== 3) return iso;
    var date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }).toUpperCase();
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
      due.textContent = fmtShortDate(card.due);
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
          if (card.flow && card.flow.state === 'waiting') {
            sections.ready.push({ boardId: board.id, column: column, card: card });
          }
          if (column.role === 'active') {
            sections.active.push({ boardId: board.id, column: column, card: card });
          }
          if (card.due && card.due >= todayISO && card.due <= weekEndISO) {
            sections.dueWeek.push({ boardId: board.id, column: column, card: card });
          }
          if (unresolved.length === 0 && card.flow && card.flow.state !== 'blocked' && card.flow.state !== 'paused' && column.role !== 'backlog') {
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
    metric('SLE', summary.sle.sleDays === null
      ? (summary.sle.sampleCount === null ? '—' : 'Not enough completed work yet (' + summary.sle.sampleCount + ' samples)')
      : Math.round(summary.sle.sleDays) + 'd');
    metric('Currently blocked', String(summary.blockedTotal));
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
    if (items.length > 0) {
      badge.hidden = false;
      badge.textContent = items.length;
    } else {
      badge.hidden = true;
    }
  }

  function render() {
    var isBoard = workspace === 'board';
    KB.el('board-area').hidden = !isBoard;
    KB.el('ws-mydesk').hidden = workspace !== 'mydesk';
    KB.el('ws-inbox').hidden = workspace !== 'inbox';
    KB.el('ws-review').hidden = workspace !== 'review';
    document.querySelectorAll('.ws-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.workspace === workspace);
    });
    var globalWs = workspace !== 'board';
    KB.el('board-switch').style.display = globalWs ? 'none' : '';
    KB.el('add-column').style.display = globalWs ? 'none' : '';
    KB.el('manage-labels').style.display = globalWs ? 'none' : '';
    KB.el('toggle-archive').style.display = globalWs ? 'none' : '';
    if (workspace === 'review') renderReview();
    else if (workspace === 'mydesk') renderMyDesk();
    else if (workspace === 'inbox') renderInbox();
  }

  function openBoard() {
    KB.Workspaces.set('board');
  }

  KB.Workspaces = {
    loadPrefs: loadPrefs,
    current: current,
    set: set,
    render: render,
    openCard: openCard,
    openBoard: openBoard,
    inboxBadge: inboxBadge
  };
})(window.KB = window.KB || {});
