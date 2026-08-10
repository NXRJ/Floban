(function (KB) {
  var h = KB.Dom.h;

  // CHECKPOINT: a guided weekly-review ritual. One keypress (W) opens a
  // 5-step session on the user's own board data — WINS -> STUCK -> OVERDUE
  // -> LOOKAHEAD -> FOCUS. Actions route through the existing ops (one undo
  // entry per step batch), and the FOCUS picks seed next week's Day Sheet.

  var STEP_IDS = ['wins', 'stuck', 'overdue', 'lookahead', 'focus'];

  function cardProjection() {
    var state = KB.State.data();
    var out = [];
    (state.boards || []).forEach(function (board) {
      var labelNames = {};
      (board.labels || []).forEach(function (l) { labelNames[l.id] = l.name; });
      (board.columns || []).forEach(function (column) {
        (column.cards || []).forEach(function (card) {
          out.push({
            boardId: board.id,
            boardName: board.name,
            columnId: column.id,
            cardId: card.id,
            title: card.title || '',
            due: card.due || '',
            priority: card.priority || 'none',
            size: card.size || 'none',
            labels: (card.labels || []).map(function (id) { return labelNames[id]; }).filter(Boolean),
            completedAt: typeof card.completedAt === 'number' ? card.completedAt : null,
            startedAt: typeof card.startedAt === 'number' ? card.startedAt : null,
            columnRole: column.role || 'queue',
            flowState: card.flow ? card.flow.state : 'normal',
            flowSince: card.flow ? card.flow.since : null,
            movedAt: typeof card.movedAt === 'number' ? card.movedAt : null,
            archived: false
          });
        });
      });
      (board.archive && board.archive.columns || []).forEach(function (ac) {
        (ac.cards || []).forEach(function (card) {
          out.push({
            boardId: board.id, boardName: board.name, columnId: ac.id,
            cardId: card.id, title: card.title || '', due: card.due || '',
            priority: card.priority || 'none', size: card.size || 'none',
            labels: (card.labels || []).map(function (id) { return labelNames[id]; }).filter(Boolean),
            completedAt: typeof card.completedAt === 'number' ? card.completedAt : null,
            startedAt: typeof card.startedAt === 'number' ? card.startedAt : null,
            columnRole: 'done', flowState: card.flow ? card.flow.state : 'normal',
            flowSince: card.flow ? card.flow.since : null,
            movedAt: typeof card.movedAt === 'number' ? card.movedAt : null,
            archived: true
          });
        });
      });
    });
    return out;
  }

  // ---- CHECKPOINT overlay ----

  var overlay = null;
  var review = null;
  var currentStep = 0;
  var focusPicks = {}; // dayISO -> [cardId]

  function close() {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    KB.Dom.setPageInert(false);
    document.removeEventListener('keydown', onKey);
    review = null;
    currentStep = 0;
    focusPicks = {};
  }

  function nextStep() {
    if (currentStep < STEP_IDS.length - 1) {
      currentStep += 1;
      render();
    } else {
      close();
      KB.UI.toast('CHECKPOINT complete \u2014 next week is staged', 'success');
    }
  }

  function stepAction(action, card, extra) {
    var done = function () {
      KB.UI.toast('Applied', 'success', 'Undo', KB.UI.undoAction);
      render();
    };
    if (action === 'clear') {
      // Move to the board's done column through the pipeline (lifecycle +
      // WIP + recurrence all fire; one undo entry).
      var board = KB.State.boardById(card.boardId);
      if (!board) return;
      var doneCol = board.columns.find(function (c) { return c.role === 'done'; });
      if (!doneCol) {
        KB.UI.toast('This board has no Done column', 'error');
        return;
      }
      var moved = KB.State.moveCardChecked(card.columnId, card.cardId, doneCol.id);
      if (moved && moved.ok) done();
      else KB.UI.toast('Column policy blocks this move', 'error');
    } else if (action === 'defer') {
      var nextMonday = nextWeekMonday();
      var patched = KB.State.updateCard(card.columnId, card.cardId, { due: nextMonday });
      if (patched) done();
    } else if (action === 'delete') {
      var archived = KB.State.archiveCard(card.columnId, card.cardId);
      if (archived) done();
    } else if (action === 'stamp') {
      // A card already sitting in a done-role column (the WINS band source).
      var stamped = KB.State.updateCard(card.columnId, card.cardId, { completedAt: Date.now() });
      if (stamped) done();
    } else if (action === 'focus') {
      var day = extra || nextWeekMonday();
      if (!focusPicks[day]) focusPicks[day] = [];
      if (focusPicks[day].indexOf(card.cardId) === -1) {
        focusPicks[day].push(card.cardId);
      }
      render();
    }
  }

  function nextWeekMonday() {
    var d = new Date();
    var back = (d.getDay() + 6) % 7;
    var monday = new Date(d);
    monday.setDate(d.getDate() - back + 7);
    return KB.Core.Date.isoDate(monday);
  }

  function render() {
    if (!overlay) return;
    overlay.innerHTML = '';
    var steps = KB.Core.Weekly.steps(review);
    var step = steps[currentStep];
    var content = h('div', { class: 'cp-content' });

    var head = h('div', { class: 'cp-head' });
    var title = h('span', { class: 'cp-title' });
    title.textContent = 'CHECKPOINT';
    head.appendChild(title);
    var stage = h('span', { class: 'cp-stage' });
    stage.textContent = 'STAGE ' + (currentStep + 1) + '/5 \u00B7 ' + step.title;
    head.appendChild(stage);
    content.appendChild(head);

    var progress = h('div', { class: 'cp-progress' });
    steps.forEach(function (s, i) {
      var dot = h('i', { class: 'cp-progress-dot' + (i <= currentStep ? ' on' : '') });
      dot.title = s.title;
      progress.appendChild(dot);
    });
    content.appendChild(progress);

    var sub = h('p', { class: 'cp-sub' });
    sub.textContent = stepSub(step.id);
    content.appendChild(sub);

    var list = h('div', { class: 'cp-list' });
    var rows = rowsFor(step.id);
    if (rows.length === 0) {
      var none = h('p', { class: 'cp-none' });
      none.textContent = 'Nothing here \u2014 this stage is clear.';
      list.appendChild(none);
    } else {
      rows.forEach(function (row) {
        list.appendChild(row);
      });
    }
    content.appendChild(list);

    var actions = h('div', { class: 'cp-actions' });
    var abortBtn = h('button', { type: 'button', class: 'btn ghost', 'data-cp': 'abort' });
    abortBtn.textContent = 'QUIT (ESC)';
    actions.appendChild(abortBtn);
    actions.appendChild(h('span', { class: 'spacer' }));
    if (step.id === 'focus') {
      var commit = h('button', { type: 'button', class: 'btn primary', 'data-cp': 'commit' });
      commit.textContent = 'COMMIT NEXT WEEK';
      actions.appendChild(commit);
    } else {
      var next = h('button', { type: 'button', class: 'btn primary', 'data-cp': 'next' });
      next.textContent = 'NEXT STAGE \u203A';
      actions.appendChild(next);
    }
    content.appendChild(actions);

    overlay.appendChild(content);
    var focusable = overlay.querySelector('button');
    if (focusable) focusable.focus();
  }

  function stepSub(id) {
    switch (id) {
      case 'wins': return 'LAST WEEK \u00B7 ' + review.lastWeek.completed.length + ' CARD' + (review.lastWeek.completed.length === 1 ? '' : 'S') + ' COMPLETED.';
      case 'stuck': return 'CARDS SITTING IN BLOCKED / WAITING / AGING \u2014 UNBLOCK OR CLEAR THEM.';
      case 'overdue': return 'DUE BEFORE THIS WEEK AND STILL OPEN. CLEAR, DEFER TO NEXT MONDAY, OR DELETE.';
      case 'lookahead': return 'DUE THIS WEEK \u2014 KNOW WHAT IS COMING.';
      default: return 'PICK 1\u20135 CARDS FOR NEXT WEEK AND ASSIGN THEM TO DAYS.';
    }
  }

  function rowsFor(stepId) {
    var rows = [];
    function row(title, extra, actions, key) {      var el = h('div', { class: 'cp-row' });
      var t = h('span', { class: 'cp-row-title' });
      t.textContent = title;
      el.appendChild(t);
      if (extra) {
        var chip = h('span', { class: 'chip chip-static cp-chip' });
        chip.textContent = extra;
        el.appendChild(chip);
      }
      el.appendChild(h('span', { class: 'spacer' }));
      actions.forEach(function (a) {
        var btn = h('button', { type: 'button', class: 'btn sm ' + (a.primary ? 'primary' : 'ghost'), 'data-cp': 'act' });
        btn.textContent = a.label;
        btn.addEventListener('click', function () { a.run(); });
        el.appendChild(btn);
      });
      el.dataset.cpKey = key || '';
      rows.push(el);
    }
    if (stepId === 'wins') {
      review.lastWeek.completed.slice(0, 20).forEach(function (card) {
        row(card.title, card.boardName, [
          { label: 'STAMP', primary: true, run: function () { stepAction('stamp', card); } }
        ], card.cardId);
      });
    } else if (stepId === 'stuck') {
      review.stuck.forEach(function (entry) {
        row(entry.card.title, entry.reason, [
          { label: 'CLEAR', primary: true, run: function () { stepAction('clear', entry.card); } },
          { label: 'DEFER', run: function () { stepAction('defer', entry.card); } }
        ], entry.card.cardId);
      });
    } else if (stepId === 'overdue') {
      review.overdue.forEach(function (card) {
        row(card.title, 'DUE ' + card.due, [
          { label: 'CLEAR', primary: true, run: function () { stepAction('clear', card); } },
          { label: 'DEFER', run: function () { stepAction('defer', card); } },
          { label: 'DELETE', run: function () { stepAction('delete', card); } }
        ], card.cardId);
      });
    } else if (stepId === 'lookahead') {
      review.upcoming.forEach(function (card) {
        row(card.title, 'DUE ' + card.due, [], card.cardId);
      });
    } else {
      // focus: pick cards and assign to a day of next week
      var monday = nextWeekMonday();
      var dayLabels = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
      review.focusRank.slice(0, 12).forEach(function (card) {
        var picks = h('div', { class: 'cp-focus-picks' });
        dayLabels.forEach(function (label, i) {
          var dayISO = isoOffset(monday, i);
          var btn = h('button', { type: 'button', class: 'cp-focus-day' + (focusPicks[dayISO] && focusPicks[dayISO].indexOf(card.cardId) !== -1 ? ' on' : '') });
          btn.textContent = label;
          btn.title = 'Assign to ' + dayISO;
          btn.addEventListener('click', function () { stepAction('focus', card, dayISO); });
          picks.appendChild(btn);
        });
        var el = h('div', { class: 'cp-row focus' });
        var t = h('span', { class: 'cp-row-title' });
        t.textContent = card.title;
        el.appendChild(t);
        el.appendChild(h('span', { class: 'spacer' }));
        el.appendChild(picks);
        rows.push(el);
      });
    }
    return rows;
  }

  function isoOffset(fromISO, offset) {
    var parts = fromISO.split('-').map(Number);
    var d = new Date(parts[0], parts[1] - 1, parts[2] + offset);
    return KB.Core.Date.isoDate(d);
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Enter') {
      var commit = overlay.querySelector('[data-cp="commit"]');
      var next = overlay.querySelector('[data-cp="next"]');
      if (commit) commit.click();
      else if (next) next.click();
    }
  }

  function start() {
    review = KB.Core.Weekly.prepare(cardProjection(), Date.now(), {});
    currentStep = 0;
    focusPicks = {};
    if (overlay) overlay.remove();
    overlay = h('div', { class: 'cp-overlay' });
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Weekly Checkpoint');
    KB.el('modal-root').appendChild(overlay);
    KB.Dom.setPageInert(true);
    render();
    overlay.addEventListener('click', function (e) {
      var t = e.target.closest('[data-cp]');
      if (!t) return;
      if (t.dataset.cp === 'abort') close();
      else if (t.dataset.cp === 'next') nextStep();
      else if (t.dataset.cp === 'commit') commitFocus();
    });
    document.addEventListener('keydown', onKey);
  }

  function commitFocus() {
    var count = 0;
    Object.keys(focusPicks).forEach(function (day) {
      var cardIds = focusPicks[day];
      if (!cardIds || cardIds.length === 0) return;
      // Seed the Day Sheet for that day via the existing stamp op.
      KB.State.stampDay(day, cardIds);
      count += cardIds.length;
    });
    if (count === 0) {
      KB.UI.toast('No cards assigned \u2014 assign at least one', 'info');
      return;
    }
    KB.App.refresh();
    close();
    KB.UI.toast('Next week staged \u2014 ' + count + ' commitment' + (count === 1 ? '' : 's') + ' in your Day Sheets', 'success');
  }

  KB.Checkpoint = {
    start: start,
    close: close
  };
})(window.KB = window.KB || {});
