(function (KB) {
  // Day Sheet: the "Start My Day" ritual. A bounded two-minute daily planning
  // flow: pick up to 3 candidates from a ranked band, stamp the sheet, work
  // the commitments, and roll the unfinished ones at the end of the day.
  //
  // All decisions are the user's; the sheet only bounds (max 3 slots), ranks
  // (carry-over > overdue > due today > Review) and persists. Every action is
  // a normal state op, so undo/redo, offline operation and the cross-tab lock
  // behave exactly as everywhere else.

  var h = KB.Dom.h;
  var open = KB.Modal.open;
  var close = KB.Modal.close;

  var SLOTS = 3;
  var ROLL_HINTS = [
    { kind: 'keep', key: 'K', label: 'KEEP', title: 'Carry to tomorrow (no change)' },
    { kind: 'push', key: 'P', label: 'PUSH +1D', title: 'Move due date one day later' },
    { kind: 'drop', key: 'D', label: 'DROP', title: 'Clear the due date' },
    { kind: 'archive', key: 'X', label: 'ARCHIVE', title: 'Archive the card' }
  ];

  var phase = 'pick'; // pick | sheet | roll
  var picked = [];
  var rollChoices = {};
  var candidatesList = [];
  var rollRows = [];

  function todayISO() {
    return KB.Core.Date.isoDate(new Date());
  }

  function findCardInState(state, cardId) {
    for (var i = 0; i < state.boards.length; i++) {
      var board = state.boards[i];
      for (var j = 0; j < board.columns.length; j++) {
        var column = board.columns[j];
        var card = column.cards.find(function (c) { return c.id === cardId; });
        if (card) return { board: board, column: column, card: card };
      }
    }
    return null;
  }

  function findDoneColumn(board) {
    return board.columns.find(function (c) { return c.role === 'done' || c.isDone; }) || null;
  }

  // Live cards of the active board plus its ranked Review queue (filler tail).
  function candidateInput(state) {
    var board = KB.State.activeBoard();
    if (!board) return { cards: [], review: [] };
    var cards = [];
    board.columns.forEach(function (column) {
      column.cards.forEach(function (card) {
        cards.push({
          boardId: board.id,
          columnId: column.id,
          cardId: card.id,
          title: card.title || '',
          due: card.due || '',
          priority: card.priority || 'none',
          completedAt: card.completedAt || null
        });
      });
    });
    var review = [];
    try {
      var queue = KB.Core.Metrics.reviewQueue(state, board.id, Date.now(), {});
      queue.forEach(function (item) {
        if (item && item.ref) review.push({ boardId: item.ref.boardId, cardId: item.ref.cardId });
      });
    } catch (e) { /* ranking is advisory; an empty filler tail is fine */ }
    return { cards: cards, review: review };
  }

  function buildCandidates() {
    var state = KB.State.data();
    var input = candidateInput(state);
    return KB.Core.DayPlan.buildCandidates({
      now: Date.now(),
      dayISO: todayISO(),
      slots: SLOTS,
      cards: input.cards,
      review: input.review,
      dayplans: KB.State.dayplans()
    });
  }

  // ---- Rendering helpers ----------------------------------------------------

  function reasonChip(text) {
    var chip = h('span', { class: 'chip chip-static day-reason' });    chip.textContent = text;
    return chip;
  }

  // All cards across boards (live + archived) for calibration — same source
  // as the TUNING workspace.
  function calibrationCards() {
    var state = KB.State.data();
    var out = [];
    (state.boards || []).forEach(function (board) {
      (board.columns || []).forEach(function (column) {
        (column.cards || []).forEach(function (card) { out.push(card); });
      });
      var archive = board.archive || {};
      (archive.columns || []).forEach(function (ac) {
        (ac.cards || []).forEach(function (card) { out.push(card); });
      });
      (archive.cards || []).forEach(function (card) { out.push(card); });
    });
    return out;
  }

  // Estimate-vs-actual reality check for the current picks: a chip line under
  // the slot progress. Returns null when nothing is picked yet.
  function tuningPlanCheck() {
    if (!KB.Core.Calibrate) return null;
    if (picked.length === 0) return null;
    var cards = calibrationCards();
    var cal = KB.Core.Calibrate.calibrate(cards, Date.now());
    var byId = {};
    cards.forEach(function (c) { if (c) byId[c.id] = c; });
    var check = KB.Core.Calibrate.planCheck(todayISO(), picked, byId, cal, cards, Date.now());
    var wrap = h('div', { class: 'day-tune' + (check.warn ? ' warn' : '') });
    var label = h('span', { class: 'day-tune-label' });
    label.textContent = 'TUNING';
    wrap.appendChild(label);
    var text = h('span', { class: 'day-tune-text' });
    text.textContent = picked.length + ' PICK' + (picked.length === 1 ? '' : 'S') + ' \u2248 ' +
      (Math.round(check.estimateDays * 10) / 10) + 'D \u2014 YOUR REALISTIC DAY \u2248 ' +
      (Math.round(check.capacityDays * 10) / 10) + 'D' +
      (check.warn ? '. TRIM?' : '.');
    wrap.appendChild(text);
    return wrap;
  }

  function keyBadge(label) {
    var b = h('span', { class: 'day-key' });
    b.textContent = label;
    return b;
  }

  // ---- The modal ------------------------------------------------------------

  function daySheet() {
    var day = todayISO();
    var existing = KB.State.daySheetFor(day);
    if (existing && existing.rolledAt) {
      KB.UI.toast('Day sheet already rolled', 'info');
      return;
    }

    var panel = h('div', { class: 'card-form day-sheet' });
    var content = h('div');
    panel.appendChild(content);

    phase = 'pick';
    picked = [];
    rollChoices = {};
    candidatesList = [];
    rollRows = [];

    function rerender() {
      content.innerHTML = '';
      var plan = KB.State.daySheetFor(day);
      if (!plan) phase = 'pick';
      else if (phase === 'pick') phase = 'sheet'; // already stamped: resume the sheet
      if (phase === 'pick') renderPick();
      else if (phase === 'roll') renderRoll();
      else renderSheet();
    }

    function togglePick(cardId) {
      var index = picked.indexOf(cardId);
      if (index !== -1) picked.splice(index, 1);
      else if (picked.length < SLOTS) picked.push(cardId);
      rerender();
    }

    function stamp() {
      if (picked.length === 0) return;
      KB.State.stampDay(day, picked);
      KB.UI.toast('Day stamped', 'success');
      KB.App.refresh();
      phase = 'sheet';
      rerender();
    }

    function hasOpen(plan) {
      return plan.commitments.some(function (c) { return c.status === 'open'; });
    }

    function completeEntry(located, rerenderAfter) {
      if (!located || located.card.completedAt) return;
      var doneColumn = findDoneColumn(located.board);
      if (!doneColumn) {
        KB.UI.toast('This board has no Done column', 'error');
        return;
      }
      var moved = KB.State.moveCardChecked(located.column.id, located.card.id, doneColumn.id);
      if (moved && moved.ok) {
        KB.UI.toast('Completed', 'success', 'Undo', KB.UI.undoAction);
        KB.App.refresh();
        rerenderAfter();
      } else {
        KB.UI.toast('Column policy blocks this move', 'error');
      }
    }

    function renderPick() {
      var heading = h('h2', { class: 'day-heading' });
      heading.textContent = 'Start My Day';
      content.appendChild(heading);
      var sub = h('p', { class: 'day-sub' });
      sub.textContent = 'Pick up to ' + SLOTS + ' commitments for today. Press 1-9 or click.';
      content.appendChild(sub);

      candidatesList = buildCandidates();
      if (candidatesList.length === 0) {
        var none = h('p', { class: 'form-hint' });
        none.textContent = 'Nothing to pick — the board is clear. Enjoy the day.';
        content.appendChild(none);
        var doneBtn = h('button', { type: 'button', class: 'btn primary' });
        doneBtn.textContent = 'Close';
        doneBtn.addEventListener('click', close);
        content.appendChild(doneBtn);
        return;
      }

      var list = h('div', { class: 'day-list' });
      candidatesList.forEach(function (row, index) {
        var item = h('div', { class: 'day-candidate' + (picked.indexOf(row.cardId) !== -1 ? ' picked' : '') });
        var t = h('span', { class: 'day-candidate-title' });
        t.textContent = row.title;
        item.appendChild(keyBadge(String(index + 1)));
        item.appendChild(t);
        item.appendChild(reasonChip(row.reason));
        item.appendChild(h('span', { class: 'spacer' }));
        var mark = h('span', { class: 'day-pick' });
        mark.textContent = picked.indexOf(row.cardId) !== -1 ? '\u2713' : '';
        item.appendChild(mark);
        item.addEventListener('click', function () { togglePick(row.cardId); });
        list.appendChild(item);
      });
      content.appendChild(list);

      var progress = h('div', { class: 'day-progress' });
      progress.textContent = picked.length + ' of ' + SLOTS + ' SLOTS';
      content.appendChild(progress);

      // TUNING reality check: estimated load of the current picks vs the
      // user's recorded daily capacity. Advisory only — the user decides.
      var checkEl = tuningPlanCheck();
      if (checkEl) content.appendChild(checkEl);

      var actions = h('div', { class: 'modal-actions' });
      var cancelBtn = h('button', { type: 'button', class: 'btn ghost' });
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', close);
      var stampBtn = h('button', { type: 'button', class: 'btn primary', disabled: picked.length === 0 });
      stampBtn.textContent = 'STAMP DAY';
      stampBtn.title = picked.length === 0 ? 'Pick at least one commitment first' : 'Commit to these ' + picked.length + ' cards';
      stampBtn.addEventListener('click', stamp);
      actions.appendChild(cancelBtn);
      actions.appendChild(h('span', { class: 'spacer' }));
      actions.appendChild(stampBtn);
      content.appendChild(actions);
    }

    function renderSheet() {
      var state = KB.State.data();
      var plan = KB.State.daySheetFor(day);
      var heading = h('h2', { class: 'day-heading' });
      heading.textContent = 'Day Sheet \u00B7 ' + KB.Dom.fmtShortDate(day);
      content.appendChild(heading);

      var entries = plan.commitments.slice().sort(function (a, b) { return a.order - b.order; });
      var doneCount = 0;
      var list = h('div', { class: 'day-list' });
      entries.forEach(function (entry) {
        var located = findCardInState(state, entry.cardId);
        var done = !located || Boolean(located.card.completedAt) || entry.status === 'done';
        if (done) doneCount++;
        var row = h('div', { class: 'day-row' + (done ? ' done' : '') });
        var box = h('button', {
          type: 'button',
          class: 'day-box' + (done ? ' checked' : ''),
          'aria-label': done ? 'Completed' : 'Mark completed',
          title: 'Move to the Done column'
        });
        if (done) box.textContent = '\u2713';
        box.addEventListener('click', function () {
          completeEntry(located, rerender);
        });
        row.appendChild(box);
        var t = h('span', { class: 'day-row-title' });
        t.textContent = located ? located.card.title : entry.cardId;
        row.appendChild(t);
        var b = h('span', { class: 'day-board' });
        b.textContent = located ? located.board.name : '';
        row.appendChild(b);
        row.appendChild(h('span', { class: 'spacer' }));
        var status = h('span', { class: 'chip chip-static day-status' });
        status.textContent = statusLabel(entry, located);
        row.appendChild(status);
        list.appendChild(row);
      });
      content.appendChild(list);

      var progress = h('div', { class: 'day-progress' });
      progress.textContent = doneCount + ' of ' + entries.length + ' DONE';
      content.appendChild(progress);

      var streak = KB.State.streakSnapshot();
      if (streak) {
        var cell = h('div', { class: 'day-streak' + (streak.current > 0 ? ' live' : '') });
        var label = h('span', { class: 'day-streak-label' });
        label.textContent = 'HI-SCORE';
        cell.appendChild(label);
        var val = h('span', { class: 'day-streak-value' });
        val.textContent = streak.current + (streak.best > streak.current ? ' / ' + streak.best : '');
        val.title = 'Current / best completion streak';
        cell.appendChild(val);
        var goal = h('span', { class: 'day-streak-goal' });
        goal.textContent = streak.todayDone ? 'TODAY DONE' : '0 TODAY';
        cell.appendChild(goal);
        content.appendChild(cell);
      }

      var actions = h('div', { class: 'modal-actions' });
      var closeBtn = h('button', { type: 'button', class: 'btn ghost' });
      closeBtn.textContent = 'Close';
      closeBtn.addEventListener('click', close);
      actions.appendChild(closeBtn);
      actions.appendChild(h('span', { class: 'spacer' }));
      if (hasOpen(plan)) {
        var rollBtn = h('button', { type: 'button', class: 'btn primary' });
        rollBtn.textContent = 'END DAY';
        rollBtn.title = 'Decide what happens to the unfinished commitments';
        rollBtn.addEventListener('click', function () {
          rollChoices = {};
          phase = 'roll';
          rerender();
        });
        actions.appendChild(rollBtn);
      }
      content.appendChild(actions);
    }

    function statusLabel(entry, located) {
      if (!located || located.card.completedAt) return 'DONE';
      switch (entry.status) {
        case 'done': return 'DONE';
        case 'kept': return 'KEPT';
        case 'pushed': return 'PUSHED';
        case 'dropped': return 'DROPPED';
        case 'archived': return 'ARCHIVED';
        default: return 'OPEN';
      }
    }

    function renderRoll() {
      var state = KB.State.data();
      var plan = KB.State.daySheetFor(day);
      var heading = h('h2', { class: 'day-heading' });
      heading.textContent = 'End the day \u00B7 roll';
      content.appendChild(heading);
      var sub = h('p', { class: 'day-sub' });
      sub.textContent = 'Decide each unfinished commitment: K keep \u00B7 P push +1d \u00B7 D drop \u00B7 X archive.';
      content.appendChild(sub);

      rollRows = [];
      plan.commitments.forEach(function (entry) {
        if (entry.status !== 'open') return;
        var located = findCardInState(state, entry.cardId);
        if (located && located.card.completedAt) return; // completed since the sheet was stamped
        var row = h('div', { class: 'day-row roll-row' });
        var t = h('span', { class: 'day-row-title' });
        t.textContent = located ? located.card.title : entry.cardId;
        row.appendChild(t);
        row.appendChild(h('span', { class: 'spacer' }));
        var actionsWrap = h('div', { class: 'day-roll-actions' });
        ROLL_HINTS.forEach(function (hint) {
          var btn = h('button', {
            type: 'button',
            class: 'btn ghost sm day-roll-btn' + (rollChoices[entry.cardId] === hint.kind ? ' active' : ''),
            'data-kind': hint.kind
          });
          btn.textContent = hint.key + ' ' + hint.label;
          btn.title = hint.title;
          btn.addEventListener('click', function () {
            rollChoices[entry.cardId] = hint.kind;
            renderRoll();
          });
          actionsWrap.appendChild(btn);
        });
        row.appendChild(actionsWrap);
        rollRows.push({ entry: entry, row: row });
        content.appendChild(row);
      });

      var actions = h('div', { class: 'modal-actions' });
      var backBtn = h('button', { type: 'button', class: 'btn ghost' });
      backBtn.textContent = 'Back';
      backBtn.addEventListener('click', function () {
        phase = 'sheet';
        rerender();
      });
      actions.appendChild(backBtn);
      actions.appendChild(h('span', { class: 'spacer' }));
      var endBtn = h('button', { type: 'button', class: 'btn primary' });
      endBtn.textContent = 'END DAY';
      endBtn.title = 'Apply the roll as one atomic, undoable action';
      endBtn.addEventListener('click', function () {
        var actionsList = Object.keys(rollChoices).map(function (cardId) {
          return { cardId: cardId, kind: rollChoices[cardId] };
        });
        KB.State.applyDayRoll(day, actionsList);
        KB.UI.toast('Day rolled', 'success', 'Undo', KB.UI.undoAction);
        KB.App.refresh();
        close();
      });
      actions.appendChild(endBtn);
      content.appendChild(actions);
    }

    // One keydown listener for the whole modal life, dispatched by phase —
    // rerenders never stack listeners.
    panel.addEventListener('keydown', function (e) {
      if (phase === 'pick') {
        if (/^[1-9]$/.test(e.key)) {
          var row = candidatesList[Number(e.key) - 1];
          if (row) {
            e.preventDefault();
            togglePick(row.cardId);
          }
        } else if (e.key === 'Enter' && !e.shiftKey) {
          var stampBtn = content.querySelector('.modal-actions .btn.primary');
          if (stampBtn && !stampBtn.disabled) {
            e.preventDefault();
            stamp();
          }
        }
        return;
      }
      if (phase === 'roll') {
        var key = e.key.toUpperCase();
        var hint = ROLL_HINTS.find(function (x) { return x.key === key; });
        if (hint && rollRows.length > 0) {
          var activeIndex = Math.max(0, rollRows.findIndex(function (r) {
            return r.row === document.activeElement || r.row.contains(document.activeElement);
          }));
          rollChoices[rollRows[activeIndex].entry.cardId] = hint.kind;
          e.preventDefault();
          renderRoll();
          return;
        }
        if (e.key === 'Enter' && !e.shiftKey) {
          var endBtn = content.querySelector('.modal-actions .btn.primary');
          if (endBtn) {
            e.preventDefault();
            endBtn.click();
          }
        }
      }
    });

    open(panel);
    rerender();
  }

  KB.Modal.daySheet = daySheet;
})(window.KB = window.KB || {});
