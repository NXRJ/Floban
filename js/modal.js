(function (KB) {
  var h = KB.Dom.h;
  var icon = KB.Dom.icon;

  var overlay = null;
  var trigger = null;

  function onKey(e) {
    if (e.key === 'Escape') close();
  }

  function open(content, opener) {
    if (KB.UI.clearToasts) KB.UI.clearToasts();
    close();
    trigger = opener || null;
    overlay = h('div', { class: 'modal-backdrop' });
    var panel = h('div', { class: 'modal-panel', role: 'dialog', 'aria-modal': 'true' });
    panel.appendChild(content);
    overlay.appendChild(panel);
    KB.el('modal-root').appendChild(overlay);
    overlay.addEventListener('mousedown', function (e) {
      if (e.target === overlay) close();
    });
    document.addEventListener('keydown', onKey);
    var focusable = panel.querySelector('input, textarea, select, button');
    if (focusable) focusable.focus();
  }

  function close() {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    document.removeEventListener('keydown', onKey);
    if (trigger) trigger.focus();
  }

  function fieldBlock(labelText, control, required) {
    var wrap = h('label', { class: 'field' });
    if (labelText) {
      var label = h('span');
      label.textContent = labelText;
      wrap.appendChild(label);
    }
    if (required) control.setAttribute('required', '');
    wrap.appendChild(control);
    return wrap;
  }

  function labelToggleChip(label, active) {
    var chip = h('button', {
      type: 'button',
      class: 'chip' + (active ? ' active' : ''),
      'data-id': label.id,
      title: 'Toggle label'
    });
    var dot = h('span', { class: 'dot' });
    dot.style.background = label.color;
    chip.appendChild(dot);
    chip.appendChild(document.createTextNode(label.name));
    KB.Dom.paintChip(chip, label.color);
    chip.addEventListener('click', function () {
      chip.classList.toggle('active');
    });
    return chip;
  }

  function checklistItem(item) {
    var row = h('div', { class: 'check-item', 'data-id': item.id });
    var check = h('input', { type: 'checkbox', 'aria-label': 'Checklist item done' });
    check.checked = Boolean(item.done);
    var text = h('input', { type: 'text', class: 'check-item-text', maxlength: 200, 'aria-label': 'Checklist item text' });
    text.value = item.text;
    var remove = h('button', { type: 'button', class: 'btn icon sm danger-ghost', 'data-action': 'remove-check', title: 'Remove item' });
    remove.innerHTML = icon('x');
    row.appendChild(check);
    row.appendChild(text);
    row.appendChild(remove);
    return row;
  }

  function checklistEditor(items) {
    var box = h('div', { class: 'check-editor' });
    box.appendChild(h('span', { class: 'check-editor-title', textContent: 'Checklist' }));

    var list = h('div', { class: 'check-list' });
    box.appendChild(list);

    function render(items) {
      list.innerHTML = '';
      (items || []).forEach(function (item) {
        list.appendChild(checklistItem(item));
      });
    }

    var addRow = h('div', { class: 'check-add-row' });
    var input = h('input', { type: 'text', placeholder: 'Add a checklist item…', maxlength: 200, 'aria-label': 'New checklist item' });
    var addBtn = h('button', { type: 'button', class: 'btn ghost sm' });
    addBtn.textContent = 'Add';
    addRow.appendChild(input);
    addRow.appendChild(addBtn);
    box.appendChild(addRow);

    addBtn.addEventListener('click', function () {
      var text = input.value.trim();
      if (!text) return;
      input.value = '';
      items.push({ id: KB.Dom.uid('ck'), text: text, done: false });
      render(items);
      input.focus();
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        addBtn.click();
      }
    });

    list.addEventListener('click', function (e) {
      if (e.target.closest('[data-action="remove-check"]')) {
        var row = e.target.closest('.check-item');
        if (row) row.remove();
      }
    });

    render(items);
    return box;
  }

  function readChecklist(box) {
    return Array.prototype.map.call(box.querySelectorAll('.check-item'), function (row) {
      return {
        id: row.dataset.id,
        text: row.querySelector('.check-item-text').value.trim(),
        done: row.querySelector('input[type="checkbox"]').checked
      };
    }).filter(function (item) { return item.text; });
  }

  function labelsFor(boardId) {
    var board = boardId ? KB.State.boardById(boardId) : null;
    return board ? (board.labels || []) : (KB.State.labels() || []);
  }

  function cardEditor(columnId, card, opener, boardId) {
    var isEdit = Boolean(card);
    var editorBoardId = typeof boardId === 'string' ? boardId : (KB.State.activeBoard() ? KB.State.activeBoard().id : '');
    var form = h('form', { class: 'card-form' });

    var heading = h('h2');
    heading.textContent = isEdit ? 'Edit card' : 'New card';
    form.appendChild(heading);

    var titleInput = h('input', { type: 'text', id: 'cf-title', maxlength: 120, placeholder: 'What needs doing?', 'aria-label': 'Card title' });
    titleInput.value = card ? card.title : '';
    form.appendChild(fieldBlock('Title', titleInput, true));

    var assigneeInput = h('input', { type: 'text', id: 'cf-assignee', list: 'assignee-list', placeholder: 'Who is responsible?', 'aria-label': 'Assignee' });
    assigneeInput.value = card ? (card.assignee || '') : '';
    form.appendChild(fieldBlock('Assignee', assigneeInput));

    var dueInput = h('input', { type: 'date', id: 'cf-due', 'aria-label': 'Due date' });
    dueInput.value = card ? (card.due || '') : '';
    form.appendChild(fieldBlock('Due date', dueInput));

    var priorityInput = h('select', { id: 'cf-priority', 'aria-label': 'Priority' });
    KB.Filters.PRIORITY_OPTIONS.forEach(function (pair) {
      priorityInput.appendChild(new Option(pair[1], pair[0]));
    });
    priorityInput.value = card ? (card.priority || 'none') : 'none';
    form.appendChild(fieldBlock('Priority', priorityInput));

    var sizeInput = h('select', { id: 'cf-size', 'aria-label': 'Size' });
    KB.Filters.SIZE_OPTIONS.forEach(function (pair) {
      sizeInput.appendChild(new Option(pair[1], pair[0]));
    });
    sizeInput.value = card ? (card.size || 'none') : 'none';
    form.appendChild(fieldBlock('Size', sizeInput));

    var descInput = h('textarea', { id: 'cf-desc', rows: 5, placeholder: 'Details, context, notes…  **bold**  *italic*  `code`  [link](url)', 'aria-label': 'Description' });
    descInput.value = card ? (card.description || '') : '';
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

    function relRow(ref, kind, onRemove) {
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

    var checklistState = card && card.checklist ? card.checklist.map(function (item) {
      return { id: item.id, text: item.text, done: Boolean(item.done) };
    }) : [];
    var checkBox = checklistEditor(checklistState);
    form.appendChild(fieldBlock('', checkBox));

    var labelsBox = h('div', { class: 'label-picker' });
    labelsFor(editorBoardId).forEach(function (label) {
      labelsBox.appendChild(labelToggleChip(label, isEdit && card.labels.indexOf(label.id) !== -1));
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
        var createEvaluation = KB.State.createNeedsConfirmation(columnId);
        if (createEvaluation) {
          KB.Modal.moveConfirmModal('Adding this card requires confirmation', createEvaluation, '', function (reason) {
            var created = KB.State.addCard(columnId, data, { confirmed: true, overrideReason: reason });
            close();
            if (created) KB.UI.toast('Card added', 'success', 'Undo', KB.UI.undoAction);
            else KB.UI.toast('Column policy blocks this card', 'error');
            KB.App.refresh();
          });
          return;
        }
        var created = KB.State.addCard(columnId, data);
        if (created) KB.UI.toast('Card added', 'success', 'Undo', KB.UI.undoAction);
        else KB.UI.toast('Column policy blocks this card', 'error');
      }
      close();
      KB.App.refresh();
    });

    open(form, opener);
  }

  function columnEditor(columnId, opener) {
    var column = columnId ? KB.State.findColumn(columnId) : null;
    var isEdit = Boolean(column);
    var form = h('form', { class: 'card-form' });

    var heading = h('h2');
    heading.textContent = isEdit ? 'Edit column' : 'New column';
    form.appendChild(heading);

    var titleInput = h('input', { type: 'text', maxlength: 60, placeholder: 'Column name', 'aria-label': 'Column name' });
    titleInput.value = column ? column.title : '';
    form.appendChild(fieldBlock('Name', titleInput, true));

    var wipInput = h('input', { type: 'number', id: 'ce-wip', min: 0, max: 99, placeholder: '0 = no limit', 'aria-label': 'WIP limit' });
    wipInput.value = column && column.wipLimit ? column.wipLimit : '';
    form.appendChild(fieldBlock('WIP limit — warn when more cards are here', wipInput));

    var doneCheck = h('input', { type: 'checkbox', id: 'ce-done', 'aria-label': 'Completion column' });
    doneCheck.checked = isEdit ? Boolean(column.isDone) : false;
    var doneLabel = h('label', { class: 'field check' });
    var doneText = h('span');
    doneText.textContent = 'Completion column — cards here show a checkmark';
    doneLabel.appendChild(doneCheck);
    doneLabel.appendChild(doneText);
    form.appendChild(doneLabel);

    var roleInput = h('select', { id: 'ce-role', 'aria-label': 'Column role' });
    [['queue', 'Queue — ready or awaiting pull'], ['active', 'Active — currently being worked'], ['done', 'Done — completed'], ['backlog', 'Backlog — not committed']].forEach(function (pair) {
      roleInput.appendChild(new Option(pair[1], pair[0]));
    });
    roleInput.value = isEdit ? (column.role || 'queue') : 'queue';
    form.appendChild(fieldBlock('Workflow role', roleInput));

    roleInput.addEventListener('change', function () {
      doneCheck.checked = roleInput.value === 'done';
    });
    doneCheck.addEventListener('change', function () {
      if (doneCheck.checked) roleInput.value = 'done';
      else if (roleInput.value === 'done') roleInput.value = 'queue';
    });

    var wipModeInput = h('select', { id: 'ce-wip-mode', 'aria-label': 'WIP mode' });
    [['off', 'Off — no enforcement'], ['soft', 'Soft — warn but allow'], ['hard', 'Hard — require override']].forEach(function (pair) {
      wipModeInput.appendChild(new Option(pair[1], pair[0]));
    });
    wipModeInput.value = isEdit ? (column.policy && column.policy.wipMode ? column.policy.wipMode : 'off') : 'off';
    form.appendChild(fieldBlock('WIP mode', wipModeInput));

    var reasonCheck = h('input', { type: 'checkbox', id: 'ce-reason', 'aria-label': 'Require override reason' });
    reasonCheck.checked = isEdit ? Boolean(column.policy && column.policy.overrideRequiresReason) : false;
    var reasonLabel = h('label', { class: 'field check' });
    var reasonText = h('span');
    reasonText.textContent = 'Require a reason for hard overrides';
    reasonLabel.appendChild(reasonCheck);
    reasonLabel.appendChild(reasonText);
    form.appendChild(reasonLabel);

    function criteriaEditor(labelText, values) {
      var box = h('div', { class: 'criteria-editor' });
      box.appendChild(h('span', { class: 'check-editor-title', textContent: labelText }));
      var list = h('div', { class: 'criteria-list' });
      box.appendChild(list);
      var addRow = h('div', { class: 'check-add-row' });
      var input = h('input', { type: 'text', placeholder: 'Add a criterion…', maxlength: 200 });
      var addBtn = h('button', { type: 'button', class: 'btn ghost sm' });
      addBtn.textContent = 'Add';
      addRow.appendChild(input);
      addRow.appendChild(addBtn);
      box.appendChild(addRow);
      function render() {
        list.innerHTML = '';
        values.forEach(function (text, index) {
          var row = h('div', { class: 'criteria-item' });
          var span = h('span');
          span.textContent = '\u25A2 ' + text;
          var remove = h('button', { type: 'button', class: 'btn icon sm danger-ghost', title: 'Remove criterion' });
          remove.innerHTML = icon('x');
          remove.addEventListener('click', function () {
            values.splice(index, 1);
            render();
          });
          row.appendChild(span);
          row.appendChild(remove);
          list.appendChild(row);
        });
      }
      addBtn.addEventListener('click', function () {
        var text = input.value.trim();
        if (!text) return;
        values.push(text);
        input.value = '';
        render();
      });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          addBtn.click();
        }
      });
      render();
      return box;
    }

    var entryCriteria = isEdit && Array.isArray(column.policy && column.policy.entryCriteria)
      ? column.policy.entryCriteria.slice()
      : [];
    form.appendChild(criteriaEditor('Entry criteria', entryCriteria));

    var exitCriteria = isEdit && Array.isArray(column.policy && column.policy.exitCriteria)
      ? column.policy.exitCriteria.slice()
      : [];
    form.appendChild(criteriaEditor('Exit criteria', exitCriteria));

    var defaultsBox = h('div', { class: 'label-picker' });
    KB.State.labels().forEach(function (label) {
      var active = isEdit && Array.isArray(column.policy && column.policy.defaultLabelIds) &&
        column.policy.defaultLabelIds.indexOf(label.id) !== -1;
      defaultsBox.appendChild(labelToggleChip(label, active));
    });
    form.appendChild(fieldBlock('Default labels on entry', defaultsBox));

    var defaultAssigneeInput = h('input', { type: 'text', list: 'assignee-list', maxlength: 60, placeholder: 'Assignee set on entry', 'aria-label': 'Default assignee' });
    defaultAssigneeInput.value = isEdit && column.policy ? (column.policy.defaultAssignee || '') : '';
    form.appendChild(fieldBlock('Default assignee on entry', defaultAssigneeInput));

    var actions = h('div', { class: 'modal-actions' });
    if (isEdit) {
      var deleteBtn = h('button', { type: 'button', class: 'btn danger' });
      deleteBtn.textContent = 'Delete column';
      deleteBtn.addEventListener('click', function () {
        var cardCount = column.cards.length;
        var message = cardCount > 0
          ? 'Delete "' + column.title + '"? Its ' + KB.Dom.plural(cardCount, 'card') + ' will move to the archive.'
          : 'Delete "' + column.title + '"?';
        if (!confirm(message)) return;
        KB.State.deleteColumn(columnId);
        KB.UI.toast(cardCount > 0 ? 'Column deleted — ' + KB.Dom.plural(cardCount, 'card') + ' archived' : 'Column deleted', 'info', 'Undo', KB.UI.undoAction);
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
      var title = titleInput.value.trim();
      if (!title) {
        KB.UI.toast('Column name is required', 'error');
        titleInput.focus();
        return;
      }
      var wipRaw = parseInt(wipInput.value, 10);
      var wipLimit = isFinite(wipRaw) && wipRaw > 0 ? Math.min(wipRaw, 99) : 0;
      var policy = {
        wipMode: wipModeInput.value,
        overrideRequiresReason: reasonCheck.checked,
        entryCriteria: entryCriteria,
        exitCriteria: exitCriteria,
        defaultLabelIds: Array.prototype.map.call(defaultsBox.querySelectorAll('.chip.active'), function (chip) {
          return chip.dataset.id;
        }),
        defaultAssignee: defaultAssigneeInput.value.trim()
      };
      if (isEdit) {
        KB.State.updateColumn(columnId, { title: title, isDone: doneCheck.checked, role: roleInput.value, wipLimit: wipLimit, policy: policy });
        KB.UI.toast('Column updated', 'success');
      } else {
        KB.State.addColumn(title, doneCheck.checked, false, roleInput.value);
        var fresh = KB.State.activeBoard().columns[KB.State.activeBoard().columns.length - 1];
        KB.State.updateColumn(fresh.id, { policy: policy });
        KB.UI.toast('Column added', 'success');
      }
      close();
      KB.App.refresh();
    });

    open(form, opener);
  }

  function promptModal(title, labelText, initial, onSave) {
    var form = h('form', { class: 'card-form' });
    var heading = h('h2');
    heading.textContent = title;
    form.appendChild(heading);

    var input = h('input', { type: 'text', maxlength: 60, 'aria-label': labelText });
    input.value = initial || '';
    form.appendChild(fieldBlock(labelText, input, true));

    var actions = h('div', { class: 'modal-actions' });
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
      var value = input.value.trim();
      if (!value) {
        KB.UI.toast('A name is required', 'error');
        input.focus();
        return;
      }
      close();
      onSave(value);
    });

    open(form);
  }

  function labelManager(opener) {
    var panel = h('div', { class: 'card-form' });

    var heading = h('h2');
    heading.textContent = 'Manage labels';
    panel.appendChild(heading);

    var hint = h('p', { class: 'form-hint' });
    hint.textContent = 'Labels are shared across all cards. A label in use can only be removed from cards first.';
    panel.appendChild(hint);

    var list = h('div', { class: 'label-manager-list' });
    panel.appendChild(list);

    function renderList() {
      list.innerHTML = '';
      KB.State.labels().forEach(function (label) {
        var row = h('div', { class: 'label-row' });

        var chip = h('span', { class: 'chip chip-static' });
        var dot = h('span', { class: 'dot' });
        dot.style.background = label.color;
        chip.appendChild(dot);
        chip.appendChild(document.createTextNode(label.name));
        KB.Dom.paintChip(chip, label.color);
        row.appendChild(chip);

        row.appendChild(h('span', { class: 'spacer' }));

        var inUse = KB.State.labelInUse(label.id);
        var removeBtn = h('button', { type: 'button', class: 'btn ghost sm' });
        removeBtn.textContent = 'Remove';
        removeBtn.disabled = inUse;
        removeBtn.title = inUse ? 'In use — remove it from cards first' : 'Delete this label';
        removeBtn.addEventListener('click', function () {
          KB.State.removeLabel(label.id);
          KB.UI.toast('Label removed', 'success');
          renderList();
        });
        row.appendChild(removeBtn);

        list.appendChild(row);
      });
    }

    var newName = h('input', { type: 'text', placeholder: 'New label name', maxlength: 24, 'aria-label': 'New label name' });
    var newColor = h('input', { type: 'color', value: '#6d30d6', 'aria-label': 'Label colour' });
    var newAdd = h('button', { type: 'button', class: 'btn ghost sm' });
    newAdd.textContent = 'Add';
    var createRow = h('div', { class: 'label-create-row' });
    createRow.appendChild(newName);
    createRow.appendChild(newColor);
    createRow.appendChild(newAdd);
    panel.appendChild(fieldBlock('Create label', createRow));

    newAdd.addEventListener('click', function () {
      var name = newName.value.trim();
      if (!name) {
        KB.UI.toast('Enter a label name first', 'error');
        newName.focus();
        return;
      }
      var exists = KB.State.labels().some(function (l) {
        return l.name.toLowerCase() === name.toLowerCase();
      });
      if (exists) {
        KB.UI.toast('A label with that name already exists', 'error');
        return;
      }
      KB.State.addLabel(name, newColor.value);
      newName.value = '';
      KB.UI.toast('Label added', 'success');
      renderList();
    });

    var actions = h('div', { class: 'modal-actions' });
    actions.appendChild(h('span', { class: 'spacer' }));
    var doneBtn = h('button', { type: 'button', class: 'btn primary' });
    doneBtn.textContent = 'Done';
    doneBtn.addEventListener('click', close);
    actions.appendChild(doneBtn);
    panel.appendChild(actions);

    renderList();
    open(panel, opener);
  }

  function backupModal() {
    var panel = h('div', { class: 'card-form' });

    var heading = h('h2');
    heading.textContent = 'Backup / restore';
    panel.appendChild(heading);

    var hint = h('p', { class: 'form-hint' });
    hint.textContent = 'Your board lives only in this browser. Export a backup file to keep it safe, and import it again to restore — on this machine or another.';
    panel.appendChild(hint);

    var fileInput = h('input', { type: 'file', accept: '.json,application/json', style: 'display:none', 'aria-label': 'Backup file' });
    panel.appendChild(fileInput);

    var actions = h('div', { class: 'modal-actions column-actions' });
    var exportAllBtn = h('button', { type: 'button', class: 'btn' });
    exportAllBtn.textContent = 'Export all boards';
    exportAllBtn.addEventListener('click', function () {
      KB.UI.download('kanban-backup-' + KB.Filters.todayISO() + '.json', KB.State.exportAll());
      KB.UI.toast('Backup downloaded', 'success');
    });
    actions.appendChild(exportAllBtn);

    var exportBoardBtn = h('button', { type: 'button', class: 'btn ghost' });
    exportBoardBtn.textContent = 'Export this board';
    exportBoardBtn.addEventListener('click', function () {
      var name = KB.State.activeBoard().name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      KB.UI.download('kanban-' + name + '-' + KB.Filters.todayISO() + '.json', KB.State.exportBoard());
      KB.UI.toast('Board exported', 'success');
    });
    actions.appendChild(exportBoardBtn);

    var importBtn = h('button', { type: 'button', class: 'btn danger-ghost' });
    importBtn.textContent = 'Import backup…';
    importBtn.addEventListener('click', function () { fileInput.click(); });
    actions.appendChild(importBtn);

    actions.appendChild(h('span', { class: 'spacer' }));
    var doneBtn = h('button', { type: 'button', class: 'btn primary' });
    doneBtn.textContent = 'Done';
    doneBtn.addEventListener('click', close);
    actions.appendChild(doneBtn);
    panel.appendChild(actions);

    fileInput.addEventListener('change', function () {
      var file = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (!file) return;
      if (!confirm('Importing a full backup replaces ALL boards; a single-board export is added as a new board. Continue?')) return;
      var reader = new FileReader();
      reader.onload = function () {
        var result = KB.State.importAll(String(reader.result));
        if (result === 'all') {
          KB.UI.toast('Backup imported', 'success');
          close();
          KB.App.refresh();
        } else if (result === 'board') {
          KB.UI.toast('Board imported', 'success');
          close();
          KB.App.refresh();
        } else {
          KB.UI.toast('That file is not a valid kanban backup', 'error');
        }
      };
      reader.readAsText(file);
    });

    open(panel);
  }

  function moveConfirmModal(title, evaluation, targetColumnTitle, onConfirm) {
    var panel = h('div', { class: 'card-form' });

    var heading = h('h2');
    heading.textContent = title || 'Move requires confirmation';
    panel.appendChild(heading);

    var soft = evaluation && evaluation.allowed === true;
    var violations = evaluation.violations || [];
    var criterionChecks = [];
    violations.forEach(function (violation) {
      var p = h('p', { class: 'policy-violation' });
      p.textContent = '\u25A2 ' + violation.message;
      panel.appendChild(p);
      if (!soft && Array.isArray(violation.criteria) && violation.criteria.length > 0) {
        violation.criteria.forEach(function (criterion) {
          var wrap = h('label', { class: 'field check' });
          var box = h('input', { type: 'checkbox', class: 'mv-criterion', 'aria-label': 'Confirm criterion' });
          var text = h('span');
          text.textContent = criterion;
          wrap.appendChild(box);
          wrap.appendChild(text);
          criterionChecks.push(box);
          panel.appendChild(wrap);
        });
      }
    });

    var reasonInput = null;
    var reasonWrap = null;
    if (!soft && evaluation.needsReason) {
      reasonInput = h('input', { type: 'text', id: 'mv-reason', maxlength: 200, placeholder: 'Why is this override justified?', 'aria-label': 'Override reason' });
      reasonWrap = fieldBlock('Override reason', reasonInput);
      panel.appendChild(reasonWrap);
    }

    var actions = h('div', { class: 'modal-actions' });
    actions.appendChild(h('span', { class: 'spacer' }));
    var cancelBtn = h('button', { type: 'button', class: 'btn ghost' });
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', close);
    actions.appendChild(cancelBtn);
    var confirmBtn = h('button', { type: 'button', class: 'btn primary' });
    confirmBtn.textContent = soft ? 'Move anyway' : 'Confirm move';
    confirmBtn.addEventListener('click', function () {
      if (!soft) {
        if (criterionChecks.length > 0 && !criterionChecks.every(function (box) { return box.checked; })) {
          KB.UI.toast('Confirm every criterion to continue', 'error');
          return;
        }
        var reason = reasonInput ? reasonInput.value.trim() : '';
        if (evaluation.needsReason && !reason) {
          KB.UI.toast('An override reason is required', 'error');
          reasonInput.focus();
          return;
        }
      }
      close();
      onConfirm(soft ? '' : (reasonInput ? reasonInput.value.trim() : ''));
    });
    actions.appendChild(confirmBtn);
    panel.appendChild(actions);

    open(panel);
  }

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
              cardEditor(column.id, card, null, board.id);
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

  function captureModal() {
    var form = h('form', { class: 'card-form' });
    var heading = h('h2');
    heading.textContent = 'Capture';
    form.appendChild(heading);
    var hint = h('p', { class: 'form-hint' });
    hint.textContent = 'One line per item — paste several lines to capture many. URLs are detected automatically.';
    form.appendChild(hint);

    var textInput = h('textarea', { id: 'cap-text', rows: 4, placeholder: 'Call the dentist\nhttps://example.com/docs', 'aria-label': 'Capture text' });
    form.appendChild(fieldBlock('What is on your mind?', textInput, true));

    var noteInput = h('textarea', { id: 'cap-note', rows: 2, placeholder: 'Optional note…', 'aria-label': 'Note' });
    form.appendChild(fieldBlock('Note', noteInput));

    var actions = h('div', { class: 'modal-actions' });
    actions.appendChild(h('span', { class: 'spacer' }));
    var cancelBtn = h('button', { type: 'button', class: 'btn ghost' });
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', close);
    actions.appendChild(cancelBtn);
    var saveBtn = h('button', { type: 'submit', class: 'btn primary' });
    saveBtn.textContent = 'Capture';
    actions.appendChild(saveBtn);
    form.appendChild(actions);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var text = textInput.value;
      var note = noteInput.value.trim();
      var lines = text.split('\n').map(function (line) { return line.trim(); }).filter(Boolean);
      if (lines.length === 0) {
        KB.UI.toast('Enter something to capture', 'error');
        textInput.focus();
        return;
      }
      var added = 0;
      if (lines.length === 1 && note) {
        var result = KB.State.captureInbox({ title: lines[0], note: note });
        if (result) added = 1;
      } else {
        var multi = KB.State.captureInboxLines(text);
        if (multi) added = multi.length;
      }
      close();
      KB.UI.toast(KB.Dom.plural(added, 'item') + ' captured', 'success', 'Undo', KB.UI.undoAction);
      KB.App.refresh();
    });

    open(form);
    setTimeout(function () { textInput.focus(); }, 0);
  }

  function triageModal(item) {
    var form = h('form', { class: 'card-form' });
    var heading = h('h2');
    heading.textContent = 'Triage';
    form.appendChild(heading);
    var hint = h('p', { class: 'form-hint' });
    hint.textContent = item.title + (item.url ? ' \u2014 ' + item.url : '');
    form.appendChild(hint);

    var boardSelect = h('select', { id: 'tr-board', 'aria-label': 'Destination board' });
    KB.State.boards().forEach(function (board) {
      boardSelect.appendChild(new Option(board.name, board.id));
    });
    var active = KB.State.activeBoard();
    if (active) boardSelect.value = active.id;
    form.appendChild(fieldBlock('Board', boardSelect));

    var columnSelect = h('select', { id: 'tr-column', 'aria-label': 'Destination column' });
    form.appendChild(fieldBlock('Column', columnSelect));

    var dueInput = h('input', { type: 'date', id: 'tr-due', 'aria-label': 'Due date' });
    form.appendChild(fieldBlock('Due date', dueInput));

    var priorityInput = h('select', { id: 'tr-priority', 'aria-label': 'Priority' });
    KB.Filters.PRIORITY_OPTIONS.forEach(function (pair) { priorityInput.appendChild(new Option(pair[1], pair[0])); });
    form.appendChild(fieldBlock('Priority', priorityInput));

    var sizeInput = h('select', { id: 'tr-size', 'aria-label': 'Size' });
    KB.Filters.SIZE_OPTIONS.forEach(function (pair) { sizeInput.appendChild(new Option(pair[1], pair[0])); });
    form.appendChild(fieldBlock('Size', sizeInput));

    var assigneeInput = h('input', { type: 'text', list: 'assignee-list', maxlength: 60, 'aria-label': 'Assignee' });
    form.appendChild(fieldBlock('Assignee', assigneeInput));

    var labelsBox = h('div', { class: 'label-picker' });
    form.appendChild(fieldBlock('Labels', labelsBox));

    function refresh() {
      var board = KB.State.boardById(boardSelect.value);
      columnSelect.innerHTML = '';
      if (!board) return;
      board.columns.forEach(function (column) {
        columnSelect.appendChild(new Option(column.title, column.id));
      });
      labelsBox.innerHTML = '';
      board.labels.forEach(function (label) {
        labelsBox.appendChild(labelToggleChip(label, false));
      });
    }
    boardSelect.addEventListener('change', refresh);
    refresh();

    var actions = h('div', { class: 'modal-actions' });
    var archiveBtn = h('button', { type: 'button', class: 'btn ghost' });
    archiveBtn.textContent = 'Archive as reference';
    archiveBtn.addEventListener('click', function () {
      KB.State.updateInboxItem(item.id, { archived: true });
      KB.UI.toast('Item archived', 'info', 'Undo', KB.UI.undoAction);
      close();
      KB.App.refresh();
    });
    actions.appendChild(archiveBtn);
    var recurBtn = h('button', { type: 'button', class: 'btn ghost' });
    recurBtn.textContent = 'Convert to recurrence';
    recurBtn.addEventListener('click', function () {
      close();
      recurrenceEditor(null, {
        boardId: boardSelect.value,
        columnId: columnSelect.value,
        title: item.title,
        description: item.note || (item.url ? 'Source: ' + item.url : '')
      }, { inboxId: item.id });
    });
    actions.appendChild(recurBtn);
    var deleteBtn = h('button', { type: 'button', class: 'btn danger-ghost' });
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', function () {
      KB.State.deleteInboxItem(item.id);
      KB.UI.toast('Item deleted', 'info', 'Undo', KB.UI.undoAction);
      close();
      KB.App.refresh();
    });
    actions.appendChild(deleteBtn);
    actions.appendChild(h('span', { class: 'spacer' }));
    var cancelBtn = h('button', { type: 'button', class: 'btn ghost' });
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', close);
    actions.appendChild(cancelBtn);
    var saveBtn = h('button', { type: 'submit', class: 'btn primary' });
    saveBtn.textContent = 'Turn into card';
    actions.appendChild(saveBtn);
    form.appendChild(actions);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var target = {
        boardId: boardSelect.value,
        columnId: columnSelect.value
      };
      var patch = {
        due: dueInput.value || '',
        priority: priorityInput.value,
        size: sizeInput.value,
        assignee: assigneeInput.value.trim(),
        labels: Array.prototype.map.call(labelsBox.querySelectorAll('.chip.active'), function (chip) {
          return chip.dataset.id;
        })
      };
      var result = KB.State.triageInboxItem(item.id, target, patch);
      if (result && result.reason === 'policy') {
        KB.Modal.moveConfirmModal('Triage requires confirmation', result.evaluation, '', function (reason) {
          var confirmed = KB.State.triageInboxItem(item.id, target, patch, { confirmed: true, overrideReason: reason });
          close();
          if (confirmed && confirmed.changed) {
            KB.UI.toast('Card created', 'success', 'Undo', KB.UI.undoAction);
          } else {
            KB.UI.toast('Could not triage that item', 'error');
          }
          KB.App.refresh();
        });
        return;
      }
      close();
      if (result && result.changed) {
        KB.UI.toast('Card created', 'success', 'Undo', KB.UI.undoAction);
      } else {
        KB.UI.toast('Could not triage that item', 'error');
      }
      KB.App.refresh();
    });

    open(form);
  }

  function mergeModal(item) {
    var form = h('form', { class: 'card-form' });
    var heading = h('h2');
    heading.textContent = 'Merge into card';
    form.appendChild(heading);
    var hint = h('p', { class: 'form-hint' });
    hint.textContent = item.title;
    form.appendChild(hint);

    var boardSelect = h('select', { id: 'mg-board', 'aria-label': 'Board' });
    KB.State.boards().forEach(function (board) {
      boardSelect.appendChild(new Option(board.name, board.id));
    });
    var active = KB.State.activeBoard();
    if (active) boardSelect.value = active.id;
    form.appendChild(fieldBlock('Board', boardSelect));

    var cardSelect = h('select', { id: 'mg-card', 'aria-label': 'Card' });
    form.appendChild(fieldBlock('Card', cardSelect));

    function refresh() {
      cardSelect.innerHTML = '';
      var board = KB.State.boardById(boardSelect.value);
      if (!board) return;
      board.columns.forEach(function (column) {
        column.cards.forEach(function (card) {
          cardSelect.appendChild(new Option(column.title + ' \u00B7 ' + card.title, card.id));
        });
      });
    }
    boardSelect.addEventListener('change', refresh);
    refresh();

    var actions = h('div', { class: 'modal-actions' });
    actions.appendChild(h('span', { class: 'spacer' }));
    var cancelBtn = h('button', { type: 'button', class: 'btn ghost' });
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', close);
    actions.appendChild(cancelBtn);
    var saveBtn = h('button', { type: 'submit', class: 'btn primary' });
    saveBtn.textContent = 'Merge';
    actions.appendChild(saveBtn);
    form.appendChild(actions);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var result = KB.State.mergeInboxItem(item.id, {
        boardId: boardSelect.value,
        cardId: cardSelect.value
      });
      close();
      if (result) {
        KB.UI.toast('Merged into card', 'success', 'Undo', KB.UI.undoAction);
      } else {
        KB.UI.toast('Could not merge', 'error');
      }
      KB.App.refresh();
    });

    open(form);
  }

  function lensEditor(lens, onSaved) {
    var form = h('form', { class: 'card-form' });
    var heading = h('h2');
    heading.textContent = 'Edit lens';
    form.appendChild(heading);

    var nameInput = h('input', { type: 'text', maxlength: 60, 'aria-label': 'Lens name' });
    nameInput.value = lens.name;
    form.appendChild(fieldBlock('Name', nameInput, true));

    var scopeInput = h('select', { id: 'le-scope', 'aria-label': 'Scope' });
    [['active-board', 'Active board'], ['all-boards', 'All boards'], ['selected-boards', 'Selected boards']].forEach(function (pair) {
      scopeInput.appendChild(new Option(pair[1], pair[0]));
    });
    scopeInput.value = lens.scope;
    form.appendChild(fieldBlock('Scope', scopeInput));

    var boardPick = h('div', { class: 'label-picker' });
    KB.State.boards().forEach(function (board) {
      var chip = labelToggleChip({ id: board.id, name: board.name, color: '#2a58c4' }, lens.boardIds.indexOf(board.id) !== -1);
      boardPick.appendChild(chip);
    });
    form.appendChild(fieldBlock('Boards (selected scope)', boardPick));

    var searchInput = h('input', { type: 'text', maxlength: 120, 'aria-label': 'Search' });
    searchInput.value = lens.query.search || '';
    form.appendChild(fieldBlock('Search', searchInput));

    var dueInput = h('select', { id: 'le-due', 'aria-label': 'Due filter' });
    [['any', 'Any due date'], ['overdue', 'Overdue'], ['today', 'Due today'], ['week', 'Due this week'], ['none', 'No due date']].forEach(function (pair) {
      dueInput.appendChild(new Option(pair[1], pair[0]));
    });
    dueInput.value = lens.query.due || 'any';
    form.appendChild(fieldBlock('Due', dueInput));

    var sortInput = h('select', { id: 'le-sort', 'aria-label': 'Sort field' });
    [['manual', 'Manual'], ['priority', 'Priority'], ['due', 'Due date'], ['created', 'Created'], ['updated', 'Updated'], ['age', 'Age'], ['blocked-duration', 'Blocked duration']].forEach(function (pair) {
      sortInput.appendChild(new Option(pair[1], pair[0]));
    });
    sortInput.value = lens.sort.field;
    form.appendChild(fieldBlock('Sort by', sortInput));

    var groupInput = h('select', { id: 'le-group', 'aria-label': 'Group by' });
    [['board', 'Board'], ['column', 'Column'], ['priority', 'Priority'], ['assignee', 'Assignee'], ['none', 'None']].forEach(function (pair) {
      groupInput.appendChild(new Option(pair[1], pair[0]));
    });
    groupInput.value = lens.display.groupBy;
    form.appendChild(fieldBlock('Group by', groupInput));

    var readyCheck = h('input', { type: 'checkbox', id: 'le-ready', 'aria-label': 'Ready only' });
    readyCheck.checked = Boolean(lens.query.readyOnly);
    var readyLabel = h('label', { class: 'field check' });
    var readyText = h('span');
    readyText.textContent = 'Only ready-to-pull cards';
    readyLabel.appendChild(readyCheck);
    readyLabel.appendChild(readyText);
    form.appendChild(readyLabel);

    var doneCheck = h('input', { type: 'checkbox', id: 'le-done', 'aria-label': 'Include completed' });
    doneCheck.checked = lens.query.includeCompleted !== false;
    var doneLabel = h('label', { class: 'field check' });
    var doneText = h('span');
    doneText.textContent = 'Include completed cards';
    doneLabel.appendChild(doneCheck);
    doneLabel.appendChild(doneText);
    form.appendChild(doneLabel);

    var actions = h('div', { class: 'modal-actions' });
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
      var name = nameInput.value.trim();
      if (!name) {
        KB.UI.toast('A name is required', 'error');
        nameInput.focus();
        return;
      }
      KB.State.updateLens(lens.id, {
        name: name,
        scope: scopeInput.value,
        boardIds: Array.prototype.map.call(boardPick.querySelectorAll('.chip.active'), function (chip) { return chip.dataset.id; }),
        query: {
          search: searchInput.value.trim(),
          labelIds: lens.query.labelIds || [],
          assignees: lens.query.assignees || [],
          due: dueInput.value,
          priorities: lens.query.priorities || [],
          sizes: lens.query.sizes || [],
          flowStates: lens.query.flowStates || [],
          blockedOnly: false,
          readyOnly: readyCheck.checked,
          columnRoles: lens.query.columnRoles || [],
          includeCompleted: doneCheck.checked
        },
        sort: { field: sortInput.value, direction: 'desc' },
        display: { density: lens.display.density, groupBy: groupInput.value }
      });
      KB.UI.toast('Lens updated', 'success', 'Undo', KB.UI.undoAction);
      close();
      if (onSaved) onSaved();
      KB.App.refresh();
    });

    open(form);
  }

  function isOpen() {
    return overlay !== null;
  }

  KB.Modal = {
    open: open,
    close: close,
    fieldBlock: fieldBlock,
    labelToggleChip: labelToggleChip,
    cardEditor: cardEditor,
    columnEditor: columnEditor,
    labelManager: labelManager,
    promptModal: promptModal,
    backupModal: backupModal,
    moveConfirmModal: moveConfirmModal,
    recurrenceEditor: recurrenceEditor,
    recurrenceManager: recurrenceManager,
    captureModal: captureModal,
    triageModal: triageModal,
    mergeModal: mergeModal,
    lensEditor: lensEditor,
    isOpen: isOpen
  };
})(window.KB = window.KB || {});
