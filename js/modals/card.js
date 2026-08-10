(function (KB) {
  var h = KB.Dom.h;
  var icon = KB.Dom.icon;
  var open = KB.Modal.open;
  var close = KB.Modal.close;
  var fieldBlock = KB.Modal.fieldBlock;
  var labelToggleChip = KB.Modal.labelToggleChip;
  var checklistEditor = KB.Modal.checklistEditor;
  var readChecklist = KB.Modal.readChecklist;
  var labelsFor = KB.Modal.labelsFor;
  function cardEditor(columnId, card, opener, boardId, prefill) {
    var isEdit = Boolean(card);
    var initial = isEdit ? card : (prefill || {});
    var editorBoardId = typeof boardId === 'string' ? boardId : (KB.State.activeBoard() ? KB.State.activeBoard().id : '');
    var form = h('form', { class: 'card-form' });

    var heading = h('h2');
    heading.textContent = isEdit ? 'Edit card' : 'New card';
    form.appendChild(heading);

    var titleInput = h('input', { type: 'text', id: 'cf-title', maxlength: 120, placeholder: 'What needs doing?', 'aria-label': 'Card title' });
    titleInput.value = initial.title || '';
    form.appendChild(fieldBlock('Title', titleInput, true));

    var assigneeInput = h('input', { type: 'text', id: 'cf-assignee', list: 'assignee-list', placeholder: 'Who is responsible?', 'aria-label': 'Assignee' });
    assigneeInput.value = initial.assignee || '';
    form.appendChild(fieldBlock('Assignee', assigneeInput));

    var dueInput = h('input', { type: 'date', id: 'cf-due', 'aria-label': 'Due date' });
    dueInput.value = initial.due || '';
    // Type-to-snooze: "push fri", "snooze 3d", "+1w" reschedule the due date
    // in one keystroke path, with a live preview chip before it is applied.
    // Relative offsets move the current due date; absolute references (weekday
    // names, dates) resolve from today. Nothing is applied until Enter.
    var snoozeRow = h('div', { class: 'snooze-row' });
    var snoozeInput = h('input', {
      type: 'text',
      id: 'cf-snooze',
      class: 'snooze-input',
      maxlength: 40,
      placeholder: 'push fri · snooze 3d · +1w',
      'aria-label': 'Reschedule due date by typing (try push fri, snooze 3d, +1w)'
    });
    var snoozePreview = h('span', { class: 'chip chip-static qa-preview-chip snooze-preview', hidden: true });
    snoozeRow.appendChild(snoozeInput);
    snoozeRow.appendChild(snoozePreview);
    var dueBlock = fieldBlock('Due date', dueInput);
    dueBlock.appendChild(snoozeRow);
    form.appendChild(dueBlock);

    function updateSnoozePreview() {
      var text = snoozeInput.value.trim();
      if (!text) {
        snoozePreview.hidden = true;
        snoozePreview.textContent = '';
        return;
      }
      var parsed = KB.Core.Nlparse.parseDuePhrase(text, { now: Date.now(), baseISO: dueInput.value || '', bareOffsets: true });
      if (!parsed.due) {
        snoozePreview.hidden = true;
        snoozePreview.textContent = '';
        return;
      }
      snoozePreview.textContent = '\u2192 ' + KB.Dom.fmtShortDate(parsed.due);
      snoozePreview.title = 'Enter to apply: ' + parsed.consumed + ' \u2192 ' + parsed.due;
      snoozePreview.hidden = false;
    }
    function applySnooze() {
      var text = snoozeInput.value.trim();
      if (!text) return;
      var parsed = KB.Core.Nlparse.parseDuePhrase(text, { now: Date.now(), baseISO: dueInput.value || '', bareOffsets: true });
      if (!parsed.due) return;
      dueInput.value = parsed.due;
      snoozeInput.value = '';
      snoozePreview.hidden = true;
      snoozePreview.textContent = '';
      dueInput.focus();
    }
    snoozeInput.addEventListener('input', updateSnoozePreview);
    snoozeInput.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      if (e.ctrlKey || e.metaKey) return; // let Ctrl+Enter reach the form save handler
      e.preventDefault();
      applySnooze();
    });

    var priorityInput = h('select', { id: 'cf-priority', 'aria-label': 'Priority' });
    KB.Filters.PRIORITY_OPTIONS.forEach(function (pair) {
      priorityInput.appendChild(new Option(pair[1], pair[0]));
    });
    priorityInput.value = initial.priority || 'none';
    form.appendChild(fieldBlock('Priority', priorityInput));

    var sizeInput = h('select', { id: 'cf-size', 'aria-label': 'Size' });
    KB.Filters.SIZE_OPTIONS.forEach(function (pair) {
      sizeInput.appendChild(new Option(pair[1], pair[0]));
    });
    sizeInput.value = initial.size || 'none';
    form.appendChild(fieldBlock('Size', sizeInput));

    var descInput = h('textarea', { id: 'cf-desc', rows: 5, placeholder: 'Details, context, notes…  **bold**  *italic*  `code`  [link](url)', 'aria-label': 'Description' });
    descInput.value = initial.description || '';
    form.appendChild(fieldBlock('Description', descInput));

    var flowState = card && card.flow && card.flow.state ? card.flow.state : 'normal';
    var flowReason = card && card.flow ? (card.flow.reason || '') : '';
    var flowInput = h('select', { id: 'cf-flow', 'aria-label': 'Flow state' });
    [['normal', 'Normal'], ['blocked', 'Blocked'], ['waiting', 'Waiting'], ['paused', 'Paused']].forEach(function (pair) {
      flowInput.appendChild(new Option(pair[1], pair[0]));
    });
    flowInput.value = flowState;
    form.appendChild(fieldBlock('Flow state', flowInput));

    var flowReasonInput = h('input', {
      type: 'text',
      id: 'cf-flow-reason',
      maxlength: 200,
      placeholder: 'Why? e.g. Waiting for API credentials',
      'aria-label': 'Flow state reason'
    });
    flowReasonInput.value = flowReason;
    var flowReasonWrap = fieldBlock('Reason', flowReasonInput);
    flowReasonWrap.classList.toggle('hidden', flowState === 'normal');
    form.appendChild(flowReasonWrap);

    flowInput.addEventListener('change', function () {
      flowReasonWrap.classList.toggle('hidden', flowInput.value === 'normal');
    });

    var relOps = [];
    var selfRef = isEdit && card ? { boardId: editorBoardId, cardId: card.id } : null;

    function allCardsForSearch() {
      var list = [];
      KB.State.boards().forEach(function (board) {
        board.columns.forEach(function (column) {
          column.cards.forEach(function (c) {
            list.push({ boardId: board.id, boardName: board.name, columnTitle: column.title, card: c });
          });
        });
      });
      return list;
    }

    function linkedKeys(list) {
      return (list || []).map(function (ref) { return ref.boardId + ':' + ref.cardId; });
    }

    function cardTitle(boardId, cardId) {
      var state = KB.State.data();
      var card = KB.Core.Relations.findCard(state, boardId, cardId);
      return card ? card.title : '(missing card)';
    }

    function relRow(ref, kind) {
      var row = h('div', { class: 'rel-row' });
      var board = KB.State.data().boards.find(function (b) { return b.id === ref.boardId; });
      var label = h('span', { class: 'rel-label' });
      label.textContent = cardTitle(ref.boardId, ref.cardId);
      var boardTag = h('span', { class: 'rel-board' });
      boardTag.textContent = board ? board.name : '?';
      var remove = h('button', { type: 'button', class: 'btn icon sm danger-ghost', title: 'Remove link' });
      remove.innerHTML = icon('x');
      remove.addEventListener('click', function () {
        row.remove();
        relOps.push({ kind: kind, remove: true, ref: ref });
      });
      row.appendChild(label);
      row.appendChild(boardTag);
      row.appendChild(h('span', { class: 'spacer' }));
      row.appendChild(remove);
      return row;
    }

    function relSearch(kind, excludeKeys) {
      var wrap = h('div', { class: 'rel-search' });
      var input = h('input', { type: 'text', placeholder: 'Search cards across boards…', maxlength: 100, 'aria-label': 'Search cards to link' });
      var results = h('div', { class: 'rel-results' });
      wrap.appendChild(input);
      wrap.appendChild(results);

      function render(query) {
        results.innerHTML = '';
        var q = (query || '').trim().toLowerCase();
        if (!q) return;
        var excluded = new Set(excludeKeys());
        var matches = allCardsForSearch().filter(function (entry) {
          var key = entry.boardId + ':' + entry.card.id;
          if (excluded.has(key)) return false;
          if (selfRef && key === selfRef.boardId + ':' + selfRef.cardId) return false;
          return String(entry.card.title).toLowerCase().indexOf(q) !== -1;
        }).slice(0, 8);
        matches.forEach(function (entry) {
          var item = h('button', { type: 'button', class: 'rel-result' });
          item.textContent = entry.boardName + ' · ' + entry.columnTitle + ' · ' + entry.card.title;
          item.addEventListener('click', function () {
            relOps.push({ kind: kind, remove: false, ref: { boardId: entry.boardId, cardId: entry.card.id } });
            input.value = '';
            results.innerHTML = '';
            refreshRelations();
          });
          results.appendChild(item);
        });
        if (q && matches.length === 0) {
          var none = h('div', { class: 'rel-none' });
          none.textContent = 'No matches';
          results.appendChild(none);
        }
      }

      input.addEventListener('input', function () { render(input.value); });
      return wrap;
    }

    var blockerBox = h('div', { class: 'rel-list' });
    var relatedBox = h('div', { class: 'rel-list' });
    var blocksBox = h('div', { class: 'rel-list' });

    function refreshRelations() {
      var state = KB.State.data();
      blockerBox.innerHTML = '';
      relatedBox.innerHTML = '';
      blocksBox.innerHTML = '';
      if (!selfRef) return;
      var card = KB.Core.Relations.findCard(state, selfRef.boardId, selfRef.cardId);
      if (!card) return;
      card.dependencies.blockers.forEach(function (ref) {
        blockerBox.appendChild(relRow(ref, 'blocker', null));
      });
      card.dependencies.related.forEach(function (ref) {
        relatedBox.appendChild(relRow(ref, 'related', null));
      });
      KB.Core.Relations.getCardsBlockedBy(state, selfRef).forEach(function (entry) {
        var row = h('div', { class: 'rel-row rel-blocked-by' });
        var label = h('span', { class: 'rel-label' });
        label.textContent = cardTitle(entry.boardId, entry.cardId);
        var boardTag = h('span', { class: 'rel-board' });
        boardTag.textContent = entry.boardId === selfRef.boardId ? '' : (KB.State.data().boards.find(function (b) { return b.id === entry.boardId; }) || {}).name || '';
        row.appendChild(label);
        row.appendChild(boardTag);
        blocksBox.appendChild(row);
      });
      if (blocksBox.children.length === 0) {
        var none = h('span', { class: 'form-hint' });
        none.textContent = 'Nothing is blocked by this card yet.';
        blocksBox.appendChild(none);
      }
    }

    var relSection = h('div', { class: 'rel-section' });
    var relTitle = h('span', { class: 'check-editor-title', textContent: 'Relationships' });
    relSection.appendChild(relTitle);
    if (isEdit) {
      var blockedByTitle = h('p', { class: 'rel-side-title', textContent: 'Blocked by' });
      relSection.appendChild(blockedByTitle);
      relSection.appendChild(blockerBox);
      relSection.appendChild(relSearch('blocker', function () {
        return linkedKeys(card && card.dependencies && card.dependencies.blockers);
      }));
      var blocksTitle = h('p', { class: 'rel-side-title', textContent: 'Blocks' });
      relSection.appendChild(blocksTitle);
      relSection.appendChild(blocksBox);
      var relatedTitle = h('p', { class: 'rel-side-title', textContent: 'Related' });
      relSection.appendChild(relatedTitle);
      relSection.appendChild(relatedBox);
      relSection.appendChild(relSearch('related', function () {
        return linkedKeys(card && card.dependencies && card.dependencies.related);
      }));
    } else {
      var hint = h('p', { class: 'form-hint' });
      hint.textContent = 'Save the card first, then reopen it to link dependencies.';
      relSection.appendChild(hint);
    }
    form.appendChild(fieldBlock('', relSection));

    var checklistState = initial.checklist ? initial.checklist.map(function (item) {
      return { id: item.id, text: item.text, done: Boolean(item.done) };
    }) : [];
    var checkBox = checklistEditor(checklistState);
    form.appendChild(fieldBlock('', checkBox));

    var labelsBox = h('div', { class: 'label-picker' });
    labelsFor(editorBoardId).forEach(function (label) {
      labelsBox.appendChild(labelToggleChip(label, (initial.labels || []).indexOf(label.id) !== -1));
    });
    form.appendChild(fieldBlock('Labels', labelsBox));

    var newName = h('input', { type: 'text', placeholder: 'New label name', maxlength: 24, 'aria-label': 'New label name' });
    var newColor = h('input', { type: 'color', value: '#6d30d6', 'aria-label': 'Label colour' });
    var newAdd = h('button', { type: 'button', class: 'btn ghost sm' });
    newAdd.textContent = 'Add';
    var createRow = h('div', { class: 'label-create-row' });
    createRow.appendChild(newName);
    createRow.appendChild(newColor);
    createRow.appendChild(newAdd);
    form.appendChild(fieldBlock('Create label', createRow));

    newAdd.addEventListener('click', function () {
      var name = newName.value.trim();
      if (!name) {
        KB.UI.toast('Enter a label name first', 'error');
        newName.focus();
        return;
      }
      var boardLabels = labelsFor(editorBoardId);
      var exists = boardLabels.some(function (l) {
        return l.name.toLowerCase() === name.toLowerCase();
      });
      if (exists) {
        KB.UI.toast('A label with that name already exists', 'error');
        return;
      }
      var label = KB.State.addLabel(name, newColor.value, editorBoardId);
      if (!label) return;
      labelsBox.appendChild(labelToggleChip(label, true));
      newName.value = '';
      KB.UI.toast('Label added', 'success');
    });

    refreshRelations();

    if (isEdit) {
      var activityBox = h('div', { class: 'activity-box' });
      activityBox.appendChild(h('span', { class: 'check-editor-title', textContent: 'Activity' }));
      var list = h('div', { class: 'activity-list' });
      activityBox.appendChild(list);

      function fmtDateTime(ts) {
        return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      }

      function row(text, at) {
        var item = h('div', { class: 'activity-row' });
        var label = h('span', { class: 'activity-label' });
        label.textContent = text;
        var time = h('span', { class: 'activity-time' });
        time.textContent = at !== null && at !== undefined ? fmtDateTime(at) : '';
        item.appendChild(label);
        item.appendChild(h('span', { class: 'spacer' }));
        item.appendChild(time);
        return item;
      }

      var events = [];
      events.push({ text: 'Created', at: card.createdAt });
      (card.flow && card.flow.periods || []).forEach(function (period) {
        var label = String(period.state).charAt(0).toUpperCase() + String(period.state).slice(1);
        events.push({ text: label, at: period.startedAt });
        events.push({ text: label + ' ended', at: period.endedAt });
      });
      (card.transitions || []).forEach(function (transition) {
        events.push({ text: 'Moved to ' + transition.toRole, at: transition.at });
      });
      if (card.startedAt) events.push({ text: 'Started', at: card.startedAt });
      if (card.completedAt) events.push({ text: 'Completed', at: card.completedAt });
      if (card.recurrenceId) events.push({ text: 'Recurrence-created', at: card.createdAt });
      events.sort(function (a, b) { return (a.at || 0) - (b.at || 0); });
      events.slice(-30).forEach(function (event) {
        list.appendChild(row(event.text, event.at));
      });
      if (events.length === 0) {
        var none = h('p', { class: 'form-hint' });
        none.textContent = 'No activity recorded yet.';
        list.appendChild(none);
      }
      form.appendChild(fieldBlock('', activityBox));
    }

    var recSection = h('div', { class: 'rel-section' });
    recSection.appendChild(h('span', { class: 'check-editor-title', textContent: 'Recurrence' }));
    if (isEdit && card.recurrenceId) {
      var rec = KB.State.recurrences().find(function (r) { return r.id === card.recurrenceId; });
      if (rec) {
        var recRow = h('div', { class: 'rel-row' });
        var recLabel = h('span', { class: 'rel-label' });
        recLabel.textContent = rec.template.title + (rec.enabled ? '' : ' (paused)');
        var recBtn = h('button', { type: 'button', class: 'btn ghost sm' });
        recBtn.textContent = 'Manage';
        recBtn.addEventListener('click', function () {
          close();
          KB.Modal.recurrenceEditor(rec);
        });
        recRow.appendChild(recLabel);
        recRow.appendChild(h('span', { class: 'spacer' }));
        recRow.appendChild(recBtn);
        recSection.appendChild(recRow);
      }
    } else {
      var recCreate = h('button', { type: 'button', class: 'btn ghost sm' });
      recCreate.textContent = 'Create recurring work from this card…';
      recCreate.addEventListener('click', function () {
        close();
        KB.Modal.recurrenceEditor(null, {
          boardId: editorBoardId,
          columnId: columnId,
          title: titleInput.value.trim(),
          description: descInput.value.trim(),
          assignee: assigneeInput.value.trim(),
          priority: priorityInput.value,
          size: sizeInput.value
        });
      });
      recSection.appendChild(recCreate);
    }
    form.appendChild(fieldBlock('', recSection));

    function collect() {
      return {
        title: titleInput.value.trim(),
        assignee: assigneeInput.value.trim(),
        due: dueInput.value || '',
        priority: priorityInput.value,
        size: sizeInput.value,
        description: descInput.value.trim(),
        checklist: readChecklist(checkBox),
        labels: Array.prototype.map.call(labelsBox.querySelectorAll('.chip.active'), function (chip) {
          return chip.dataset.id;
        })
      };
    }

    var actions = h('div', { class: 'modal-actions' });
    if (isEdit) {
      var archiveBtn = h('button', { type: 'button', class: 'btn danger-ghost' });
      archiveBtn.textContent = 'Archive';
      archiveBtn.addEventListener('click', function () {
        KB.State.archiveCard(columnId, card.id, editorBoardId);
        KB.UI.toast('Card archived', 'info', 'Undo', KB.UI.undoAction);
        close();
        KB.App.refresh();
      });
      actions.appendChild(archiveBtn);

      var duplicateBtn = h('button', { type: 'button', class: 'btn ghost' });
      duplicateBtn.textContent = 'Duplicate';
      duplicateBtn.title = 'Create a copy of this card';
      duplicateBtn.addEventListener('click', function () {
        var copy = KB.State.duplicateCard(columnId, card.id, editorBoardId);
        if (copy) {
          KB.UI.toast('Card duplicated', 'success', 'Undo', KB.UI.undoAction);
          close();
          KB.App.refresh();
        }
      });
      actions.appendChild(duplicateBtn);

      var templateBtn = h('button', { type: 'button', class: 'btn ghost' });
      templateBtn.textContent = 'Save as template';
      templateBtn.title = 'Reuse this card later from a column quick-add';
      templateBtn.addEventListener('click', function () {
        var data = collect();
        if (!data.title) {
          KB.UI.toast('Give the card a title first', 'error');
          return;
        }
        KB.State.addTemplate({
          title: data.title,
          description: data.description,
          labels: data.labels,
          assignee: data.assignee,
          priority: data.priority,
          size: data.size,
          checklist: data.checklist
        });
        KB.UI.toast('Template saved', 'success');
      });
      actions.appendChild(templateBtn);

      var focusBtn = h('button', { type: 'button', class: 'btn ghost', id: 'cf-focus' });
      var session = KB.State.focusSession();
      var focusingThis = session && session.cardId === card.id;
      focusBtn.textContent = focusingThis ? 'STOP FOCUS' : 'START FOCUS';
      focusBtn.title = focusingThis
        ? 'End the focus session and log the effort on this card'
        : 'Run a 25-minute focus session on this card (F to stop)';
      focusBtn.addEventListener('click', function () {
        var active = KB.State.focusSession();
        if (active && active.cardId === card.id) {
          KB.State.endFocus();
          KB.UI.toast('Focus logged', 'success', 'Undo', KB.UI.undoAction);
        } else if (active) {
          KB.UI.toast('A focus session is already running', 'info');
          return;
        } else {
          KB.State.startFocus(card.id, 'pomodoro');
          KB.UI.toast('Focus started \u2014 press F to stop', 'success');
        }
        KB.App.refresh();
        close();
      });
      actions.appendChild(focusBtn);
    }
    var spacer = h('span', { class: 'spacer' });
    actions.appendChild(spacer);
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
      var data = collect();
      if (!data.title) {
        KB.UI.toast('Title is required', 'error');
        titleInput.focus();
        return;
      }
      if (isEdit) {
        relOps.forEach(function (op) {
          if (op.kind === 'blocker') {
            if (op.remove) KB.State.removeBlocker(editorBoardId, card.id, op.ref.boardId, op.ref.cardId);
            else KB.State.addBlocker(editorBoardId, card.id, op.ref.boardId, op.ref.cardId);
          } else if (op.kind === 'related') {
            if (op.remove) KB.State.removeRelated(editorBoardId, card.id, op.ref.boardId, op.ref.cardId);
            else KB.State.addRelated(editorBoardId, card.id, op.ref.boardId, op.ref.cardId);
          }
        });
        KB.State.updateCardWithFlow(columnId, card.id, data, flowInput.value, flowReasonInput.value.trim(), editorBoardId);
        KB.UI.toast('Changes saved', 'success');
      } else {
        var finishCreate = function (created) {
          if (created) KB.UI.toast('Card added', 'success', 'Undo', KB.UI.undoAction);
          else KB.UI.toast('Column policy blocks this card', 'error');
        };
        var createEvaluation = KB.State.createNeedsConfirmation(columnId);
        if (createEvaluation) {
          KB.Modal.moveConfirmModal('Adding this card requires confirmation', createEvaluation, '', function (reason) {
            var created = KB.State.addCard(columnId, data, { confirmed: true, overrideReason: reason });
            close();
            if (created) {
              finishCreate(created);
              KB.App.refresh();
              return;
            }
            cardEditor(columnId, null, null, editorBoardId, data);
            KB.UI.toast('Column policy blocks this card', 'error');
          }, function () {
            cardEditor(columnId, null, null, editorBoardId, data);
          });
          return;
        }
        var created = KB.State.addCard(columnId, data);
        finishCreate(created);
      }
      close();
      KB.App.refresh();
    });

    // Ctrl/Cmd+Enter anywhere in the editor saves the card (the same submit
    // handler — dispatch keeps validation, policies and undo intact).
    form.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });

    open(form, opener);
  }

  KB.Modal.cardEditor = cardEditor;
})(window.KB = window.KB || {});
