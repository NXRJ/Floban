(function (KB) {
  var h = KB.Dom.h;
  var open = KB.Modal.open;
  var close = KB.Modal.close;
  var fieldBlock = KB.Modal.fieldBlock;
  var labelToggleChip = KB.Modal.labelToggleChip;

  function recurrenceEditor(existing, prefill, convertFromInbox) {
    var form = h('form', { class: 'card-form' });
    var heading = h('h2');
    heading.textContent = existing ? 'Edit recurrence' : 'New recurrence';
    form.appendChild(heading);

    var nameInput = h('input', { type: 'text', maxlength: 120, placeholder: 'What recurs?', 'aria-label': 'Recurrence name' });
    nameInput.value = existing ? (existing.template.title || '') : (prefill && prefill.title ? prefill.title : '');
    form.appendChild(fieldBlock('Template title', nameInput, true));

    var modeInput = h('select', { id: 'rc-mode', 'aria-label': 'Recurrence mode' });
    [['scheduled', 'Scheduled — on a schedule'], ['after-completion', 'After completion — X days after each completion']].forEach(function (pair) {
      modeInput.appendChild(new Option(pair[1], pair[0]));
    });
    modeInput.value = existing ? existing.mode : 'scheduled';
    form.appendChild(fieldBlock('Mode', modeInput));

    var freqInput = h('select', { id: 'rc-freq', 'aria-label': 'Frequency' });
    [['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['custom', 'Every N days']].forEach(function (pair) {
      freqInput.appendChild(new Option(pair[1], pair[0]));
    });
    freqInput.value = existing ? (existing.schedule.frequency || 'daily') : 'daily';
    form.appendChild(fieldBlock('Frequency', freqInput));

    var intervalInput = h('input', { type: 'number', min: 1, max: 999, id: 'rc-interval', 'aria-label': 'Interval' });
    intervalInput.value = existing && existing.schedule.interval ? existing.schedule.interval : 1;
    form.appendChild(fieldBlock('Every N units', intervalInput));

    var weekdaysRow = h('div', { class: 'weekday-row' });
    ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach(function (name, index) {
      var label = h('label', { class: 'wd-label' });
      var box = h('input', { type: 'checkbox', value: index, 'aria-label': name });
      box.checked = existing && Array.isArray(existing.schedule.weekdays) && existing.schedule.weekdays.indexOf(index) !== -1;
      label.appendChild(box);
      label.appendChild(document.createTextNode(name));
      weekdaysRow.appendChild(label);
    });
    form.appendChild(fieldBlock('Weekdays (weekly)', weekdaysRow));

    var domInput = h('input', { type: 'number', min: 1, max: 31, id: 'rc-dom', 'aria-label': 'Day of month' });
    domInput.value = existing && existing.schedule.dayOfMonth ? existing.schedule.dayOfMonth : '';
    form.appendChild(fieldBlock('Day of month (monthly)', domInput));

    var delayInput = h('input', { type: 'number', min: 0, max: 365, id: 'rc-delay', 'aria-label': 'Delay after completion days' });
    delayInput.value = existing && existing.schedule.delayAfterCompletionDays ? existing.schedule.delayAfterCompletionDays : '';
    form.appendChild(fieldBlock('Days after completion (after-completion mode)', delayInput));

    var dueOffsetInput = h('input', { type: 'number', min: -365, max: 365, id: 'rc-due', 'aria-label': 'Due date offset days' });
    dueOffsetInput.value = existing && existing.dueOffsetDays !== null && existing.dueOffsetDays !== undefined ? existing.dueOffsetDays : '';
    form.appendChild(fieldBlock('Due date offset days', dueOffsetInput));

    var overlapInput = h('select', { id: 'rc-overlap', 'aria-label': 'Overlap policy' });
    [['single-active', 'Single active — one instance at a time'], ['allow-overlap', 'Allow overlap']].forEach(function (pair) {
      overlapInput.appendChild(new Option(pair[1], pair[0]));
    });
    overlapInput.value = existing ? existing.overlapPolicy : 'single-active';
    form.appendChild(fieldBlock('Overlap policy', overlapInput));

    var missedInput = h('select', { id: 'rc-missed', 'aria-label': 'Missed policy' });
    [['skip', 'Skip missed'], ['create-one', 'Create one current occurrence'], ['catch-up-all', 'Catch up all missed']].forEach(function (pair) {
      missedInput.appendChild(new Option(pair[1], pair[0]));
    });
    missedInput.value = existing ? existing.missedPolicy : 'create-one';
    form.appendChild(fieldBlock('Missed runs', missedInput));

    var boardSelect = h('select', { id: 'rc-board', 'aria-label': 'Target board' });
    KB.State.boards().forEach(function (board) {
      boardSelect.appendChild(new Option(board.name, board.id));
    });
    form.appendChild(fieldBlock('Target board', boardSelect));

    var columnSelect = h('select', { id: 'rc-column', 'aria-label': 'Target column' });
    form.appendChild(fieldBlock('Target column', columnSelect));

    var descInput = h('textarea', { id: 'rc-desc', rows: 3, placeholder: 'Description for new cards', 'aria-label': 'Description' });
    descInput.value = existing ? (existing.template.description || '') : (prefill && prefill.description ? prefill.description : '');
    form.appendChild(fieldBlock('Description', descInput));

    var priorityInput = h('select', { id: 'rc-priority', 'aria-label': 'Priority' });
    KB.Filters.PRIORITY_OPTIONS.forEach(function (pair) { priorityInput.appendChild(new Option(pair[1], pair[0])); });
    priorityInput.value = existing ? (existing.template.priority || 'none') : (prefill && prefill.priority ? prefill.priority : 'none');
    form.appendChild(fieldBlock('Priority', priorityInput));

    var sizeInput = h('select', { id: 'rc-size', 'aria-label': 'Size' });
    KB.Filters.SIZE_OPTIONS.forEach(function (pair) { sizeInput.appendChild(new Option(pair[1], pair[0])); });
    sizeInput.value = existing ? (existing.template.size || 'none') : (prefill && prefill.size ? prefill.size : 'none');
    form.appendChild(fieldBlock('Size', sizeInput));

    var labelsBox = h('div', { class: 'label-picker' });
    var targetLabels = KB.State.activeBoard().labels;
    if (existing) {
      var targetBoard = KB.State.boardById(existing.target.boardId);
      if (targetBoard) targetLabels = targetBoard.labels;
    }
    targetLabels.forEach(function (label) {
      var active = existing && existing.template.labelIds.indexOf(label.id) !== -1;
      labelsBox.appendChild(labelToggleChip(label, active));
    });
    form.appendChild(fieldBlock('Labels', labelsBox));

    var assigneeInput = h('input', { type: 'text', list: 'assignee-list', maxlength: 60, 'aria-label': 'Assignee' });
    assigneeInput.value = existing ? (existing.template.assignee || '') : (prefill && prefill.assignee ? prefill.assignee : '');
    form.appendChild(fieldBlock('Assignee', assigneeInput));

    function fillColumns() {
      columnSelect.innerHTML = '';
      var board = KB.State.boardById(boardSelect.value);
      if (!board) return;
      board.columns.forEach(function (column) {
        columnSelect.appendChild(new Option(column.title, column.id));
      });
    }
    boardSelect.addEventListener('change', fillColumns);
    if (existing) {
      var targetBoard = KB.State.boardById(existing.target.boardId);
      if (targetBoard) boardSelect.value = targetBoard.id;
    } else if (prefill && prefill.columnId) {
      var pb = KB.State.boardById(prefill.boardId) || KB.State.activeBoard();
      if (pb) boardSelect.value = pb.id;
    }
    fillColumns();
    if (existing && existing.target.columnId) columnSelect.value = existing.target.columnId;
    else if (prefill && prefill.columnId) columnSelect.value = prefill.columnId;

    var actions = h('div', { class: 'modal-actions' });
    if (existing) {
      var deleteBtn = h('button', { type: 'button', class: 'btn danger' });
      deleteBtn.textContent = 'Delete';
      deleteBtn.addEventListener('click', function () {
        KB.State.deleteRecurrence(existing.id);
        KB.UI.toast('Recurrence deleted', 'info', 'Undo', KB.UI.undoAction);
        close();
        KB.App.refresh();
      });
      actions.appendChild(deleteBtn);
    }
    actions.appendChild(h('span', { class: 'spacer' }));
    var cancelBtn = h('button', { type: 'button', class: 'btn ghost' });
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', close);
    actions.appendChild(cancelBtn);
    var saveBtn = h('button', { type: 'submit', class: 'btn primary' });
    saveBtn.textContent = 'Save';
    actions.appendChild(saveBtn);
    form.appendChild(actions);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var title = nameInput.value.trim();
      if (!title) {
        KB.UI.toast('A template title is required', 'error');
        nameInput.focus();
        return;
      }
      var weekdays = Array.prototype.map.call(weekdaysRow.querySelectorAll('input:checked'), function (box) {
        return Number(box.value);
      });
      var domRaw = parseInt(domInput.value, 10);
      var delayRaw = parseInt(delayInput.value, 10);
      var dueRaw = parseInt(dueOffsetInput.value, 10);
      var definition = {
        mode: modeInput.value,
        schedule: {
          frequency: freqInput.value,
          interval: Math.max(1, parseInt(intervalInput.value, 10) || 1),
          weekdays: weekdays,
          dayOfMonth: isFinite(domRaw) && domRaw >= 1 ? domRaw : null,
          delayAfterCompletionDays: modeInput.value === 'after-completion' && isFinite(delayRaw) && delayRaw >= 0 ? delayRaw : null
        },
        target: { boardId: boardSelect.value, columnId: columnSelect.value },
        template: {
          title: title,
          description: descInput.value.trim(),
          labelIds: Array.prototype.map.call(labelsBox.querySelectorAll('.chip.active'), function (chip) {
            return chip.dataset.id;
          }),
          assignee: assigneeInput.value.trim(),
          priority: priorityInput.value,
          size: sizeInput.value,
          checklist: []
        },
        dueOffsetDays: isFinite(dueRaw) ? dueRaw : null,
        overlapPolicy: overlapInput.value,
        missedPolicy: missedInput.value
      };
      if (existing) {
        KB.State.updateRecurrence(existing.id, definition);
        KB.UI.toast('Recurrence updated', 'success');
      } else if (convertFromInbox && convertFromInbox.inboxId) {
        var converted = KB.State.convertInboxToRecurrence(convertFromInbox.inboxId, definition);
        if (converted) KB.UI.toast('Inbox item converted to recurrence', 'success');
        else KB.UI.toast('Could not convert that item', 'error');
      } else {
        KB.State.addRecurrence(definition);
        KB.UI.toast('Recurrence created', 'success');
      }
      close();
      KB.App.refresh();
    });

    open(form);
  }

  function recurrenceManager() {
    var panel = h('div', { class: 'card-form' });
    var heading = h('h2');
    heading.textContent = 'Recurring work';
    panel.appendChild(heading);
    var hint = h('p', { class: 'form-hint' });
    hint.textContent = 'Scheduled work is created when this local app is open or next opened.';
    panel.appendChild(hint);

    var list = h('div', { class: 'rec-manager-list' });
    panel.appendChild(list);

    function renderList() {
      list.innerHTML = '';
      var recs = KB.State.recurrences();
      if (recs.length === 0) {
        var none = h('p', { class: 'desk-empty' });
        none.textContent = 'No recurring work yet — open a card and pick "Create recurring work from this card…".';
        list.appendChild(none);
        return;
      }
      recs.forEach(function (rec) {
        var row = h('div', { class: 'rec-row' });
        var main = h('div', { class: 'rec-main' });
        var title = h('p', { class: 'rec-title' });
        title.textContent = rec.template.title;
        main.appendChild(title);
        var meta = h('div', { class: 'rec-meta' });
        var bits = [];
        bits.push(rec.mode === 'scheduled' ? 'Scheduled' : 'After completion');
        bits.push(rec.enabled ? 'active' : 'paused');
        var target = KB.State.boardById(rec.target.boardId);
        bits.push(target ? target.name : 'missing board');
        if (rec.nextRunAt) bits.push('next: ' + KB.Dom.fmtDate(rec.nextRunAt));
        if (rec.endAt) bits.push('ends: ' + KB.Dom.fmtDate(rec.endAt));
        if (typeof rec.remainingOccurrences === 'number') bits.push(rec.remainingOccurrences + ' left');
        if (rec.needsAttention) bits.push('needs attention: target column missing');
        if (rec.policyBlocked) bits.push('waiting: a column policy blocks new cards');
        meta.textContent = bits.join(' \u00B7 ');
        main.appendChild(meta);
        if (rec.pausedReason) {
          var reason = h('p', { class: 'rec-reason' });
          reason.textContent = rec.pausedReason;
          main.appendChild(reason);
        }
        row.appendChild(main);

        var actions = h('div', { class: 'rec-actions' });
        var editBtn = h('button', { type: 'button', class: 'btn ghost sm', 'data-rec-action': 'edit' });
        editBtn.textContent = 'Edit';
        var toggleBtn = h('button', { type: 'button', class: 'btn ghost sm', 'data-rec-action': rec.enabled ? 'pause' : 'resume' });
        toggleBtn.textContent = rec.enabled ? 'Pause' : 'Resume';
        var runBtn = h('button', { type: 'button', class: 'btn ghost sm', 'data-rec-action': 'run' });
        runBtn.textContent = 'Run now';
        var skipBtn = h('button', { type: 'button', class: 'btn ghost sm', 'data-rec-action': 'skip' });
        skipBtn.textContent = 'Skip next';
        var openBtn = h('button', { type: 'button', class: 'btn ghost sm', 'data-rec-action': 'open' });
        openBtn.textContent = 'Open card';
        var endBtn = h('button', { type: 'button', class: 'btn danger-ghost sm', 'data-rec-action': 'end' });
        endBtn.textContent = 'End';
        if (rec.endAt) endBtn.disabled = true;
        if (!rec.activeCardRef) openBtn.disabled = true;
        [editBtn, toggleBtn, runBtn, skipBtn, openBtn, endBtn].forEach(function (b) { actions.appendChild(b); });
        row.appendChild(actions);
        row.dataset.recId = rec.id;
        list.appendChild(row);
      });
    }

    list.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-rec-action]');
      if (!btn) return;
      var row = e.target.closest('.rec-row');
      if (!row) return;
      var id = row.dataset.recId;
      var rec = KB.State.recurrences().find(function (r) { return r.id === id; });
      if (!rec) return;
      switch (btn.dataset.recAction) {
        case 'edit':
          recurrenceEditor(rec);
          break;
        case 'pause':
          KB.State.pauseRecurrence(id, 'Paused by user');
          KB.UI.toast('Recurrence paused', 'success', 'Undo', KB.UI.undoAction);
          renderList();
          break;
        case 'resume':
          KB.State.resumeRecurrence(id);
          KB.UI.toast('Recurrence resumed', 'success', 'Undo', KB.UI.undoAction);
          renderList();
          break;
        case 'run': {
          var result = KB.State.runRecurrenceNow(id);
          if (result && result.changed) {
            KB.UI.toast('Occurrence created', 'success', 'Undo', KB.UI.undoAction);
          } else if (result && result.reason === 'policy') {
            KB.UI.toast('A column policy blocks creation right now', 'error');
          } else {
            KB.UI.toast('Cannot create right now', 'error');
          }
          renderList();
          break;
        }
        case 'skip':
          KB.State.skipRecurrenceNext(id);
          KB.UI.toast('Next occurrence skipped', 'success', 'Undo', KB.UI.undoAction);
          renderList();
          break;
        case 'open': {
          var ref = rec.activeCardRef;
          if (!ref) break;
          var board = KB.State.boardById(ref.boardId);
          if (!board) break;
          var column = null;
          for (var i = 0; i < board.columns.length; i++) {
            if (board.columns[i].cards.some(function (c) { return c.id === ref.cardId; })) {
              column = board.columns[i];
              break;
            }
          }
          if (column) {
            var card = column.cards.find(function (c) { return c.id === ref.cardId; });
            if (card) {
              close();
              KB.Modal.cardEditor(column.id, card, null, board.id);
            }
          }
          break;
        }
        case 'end':
          KB.State.endRecurrence(id);
          KB.UI.toast('Recurrence ended', 'info', 'Undo', KB.UI.undoAction);
          renderList();
          break;
      }
    });

    var actions = h('div', { class: 'modal-actions' });
    var newBtn = h('button', { type: 'button', class: 'btn primary' });
    newBtn.textContent = 'New recurrence';
    newBtn.addEventListener('click', function () {
      recurrenceEditor(null, null);
    });
    actions.appendChild(newBtn);
    actions.appendChild(h('span', { class: 'spacer' }));
    var doneBtn = h('button', { type: 'button', class: 'btn ghost' });
    doneBtn.textContent = 'Done';
    doneBtn.addEventListener('click', close);
    actions.appendChild(doneBtn);
    panel.appendChild(actions);

    renderList();
    open(panel);
  }

  KB.Modal.recurrenceEditor = recurrenceEditor;
  KB.Modal.recurrenceManager = recurrenceManager;
})(window.KB = window.KB || {});
