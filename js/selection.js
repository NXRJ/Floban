(function (KB) {
  var h = KB.Dom.h;
  var selected = new Set();

  function refs() {
    var out = [];
    selected.forEach(function (key) {
      var parts = key.split('|');
      out.push({ boardId: parts[0], cardId: parts[1] });
    });
    return out;
  }

  function keyFor(boardId, cardId) {
    return boardId + '|' + cardId;
  }

  function has(boardId, cardId) {
    return selected.has(keyFor(boardId, cardId));
  }

  function count() {
    return selected.size;
  }

  function toggle(boardId, cardId) {
    var key = keyFor(boardId, cardId);
    if (selected.has(key)) selected.delete(key);
    else selected.add(key);
    syncCardClasses(boardId, cardId);
    renderToolbar();
  }

  function clear() {
    KB.el('board').querySelectorAll('.card.selected').forEach(function (el) {
      el.classList.remove('selected');
    });
    selected.clear();
    renderToolbar();
  }

  function clearAndRender() {
    clear();
  }

  function syncCardClasses(boardId, cardId) {
    var el = KB.el('board').querySelector('.card[data-id="' + cardId + '"]');
    if (el) el.classList.toggle('selected', selected.has(keyFor(boardId, cardId)));
  }

  function selectRange(boardId, fromCardId, toCardId) {
    var board = KB.State.boardById(boardId);
    if (!board) return;
    var all = [];
    board.columns.forEach(function (column) {
      column.cards.forEach(function (card) {
        all.push({ columnId: column.id, cardId: card.id });
      });
    });
    var fromIndex = all.findIndex(function (entry) { return entry.cardId === fromCardId; });
    var toIndex = all.findIndex(function (entry) { return entry.cardId === toCardId; });
    if (fromIndex === -1 || toIndex === -1) return;
    var start = Math.min(fromIndex, toIndex);
    var end = Math.max(fromIndex, toIndex);
    for (var i = start; i <= end; i++) {
      selected.add(keyFor(boardId, all[i].cardId));
    }
    syncAll();
  }

  function syncAll() {
    KB.el('board').querySelectorAll('.card').forEach(function (el) {
      var board = KB.State.activeBoard();
      if (board) el.classList.toggle('selected', selected.has(keyFor(board.id, el.dataset.id)));
    });
    renderToolbar();
  }

  function renderToolbar() {
    var el = KB.el('bulk-toolbar');
    if (!el) return;
    el.innerHTML = '';
    if (selected.size === 0) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    var label = h('span', { class: 'bulk-count' });
    label.textContent = selected.size + ' selected';
    el.appendChild(label);

    function menuButton(text, items) {
      var btn = h('button', { type: 'button', class: 'btn sm' });
      btn.textContent = text;
      btn.addEventListener('click', function () {
        var pop = h('div', { class: 'pop' });
        items.forEach(function (item) {
          var button = h('button', { type: 'button', class: 'pop-item' });
          button.textContent = item.label;
          button.addEventListener('click', function () {
            pop.remove();
            item.onClick();
          });
          pop.appendChild(button);
        });
        document.body.appendChild(pop);
        var rect = btn.getBoundingClientRect();
        pop.style.top = (rect.bottom + 6) + 'px';
        pop.style.left = Math.max(4, Math.min(rect.left, window.innerWidth - pop.offsetWidth - 8)) + 'px';
        function onDown(e) {
          if (!pop.contains(e.target) && e.target !== btn) {
            pop.remove();
            document.removeEventListener('mousedown', onDown);
          }
        }
        document.addEventListener('mousedown', onDown);
      });
      return btn;
    }

    var moveBtn = h('button', { type: 'button', class: 'btn sm primary' });
    moveBtn.textContent = 'Move…';
    moveBtn.addEventListener('click', function () {
      openBulkMove();
    });
    el.appendChild(moveBtn);

    el.appendChild(menuButton('Labels', [
      { label: 'Add…', onClick: function () { openBulkLabels(true); } },
      { label: 'Remove…', onClick: function () { openBulkLabels(false); } }
    ]));
    el.appendChild(menuButton('Assignee', [
      { label: 'Assign…', onClick: function () { KB.Modal.promptModal('Assign', 'Assignee', '', function (name) { applyBulkPatch({ assignee: name }); }); } },
      { label: 'Clear assignee', onClick: function () { applyBulkPatch({ assignee: '' }); } }
    ]));
    el.appendChild(menuButton('Due date', [
      { label: 'Set…', onClick: function () { openBulkDue(); } },
      { label: 'Clear due date', onClick: function () { applyBulkPatch({ due: '' }); } }
    ]));
    el.appendChild(menuButton('Priority', [
      { label: 'Urgent', onClick: function () { applyBulkPatch({ priority: 'urgent' }); } },
      { label: 'High', onClick: function () { applyBulkPatch({ priority: 'high' }); } },
      { label: 'Medium', onClick: function () { applyBulkPatch({ priority: 'medium' }); } },
      { label: 'Low', onClick: function () { applyBulkPatch({ priority: 'low' }); } },
      { label: 'None', onClick: function () { applyBulkPatch({ priority: 'none' }); } }
    ]));
    el.appendChild(menuButton('Size', [
      { label: 'XL', onClick: function () { applyBulkPatch({ size: 'xl' }); } },
      { label: 'L', onClick: function () { applyBulkPatch({ size: 'l' }); } },
      { label: 'M', onClick: function () { applyBulkPatch({ size: 'm' }); } },
      { label: 'S', onClick: function () { applyBulkPatch({ size: 's' }); } },
      { label: 'XS', onClick: function () { applyBulkPatch({ size: 'xs' }); } },
      { label: 'None', onClick: function () { applyBulkPatch({ size: 'none' }); } }
    ]));
    el.appendChild(menuButton('Flow state', [
      { label: 'Blocked…', onClick: function () { openBulkFlow('blocked'); } },
      { label: 'Waiting…', onClick: function () { openBulkFlow('waiting'); } },
      { label: 'Paused…', onClick: function () { openBulkFlow('paused'); } },
      { label: 'Clear state', onClick: function () { applyBulkPatch({ flowPatch: 'normal' }); } }
    ]));

    var archiveBtn = h('button', { type: 'button', class: 'btn sm danger-ghost' });
    archiveBtn.textContent = 'Archive';
    archiveBtn.addEventListener('click', function () {
      KB.State.bulkArchive(refs());
      KB.UI.toast(KB.Dom.plural(selected.size, 'card') + ' archived', 'info', 'Undo', KB.UI.undoAction);
      clear();
      KB.App.refresh();
    });
    el.appendChild(archiveBtn);

    var clearBtn = h('button', { type: 'button', class: 'btn sm ghost' });
    clearBtn.textContent = 'Clear';
    clearBtn.addEventListener('click', clear);
    el.appendChild(clearBtn);
  }

  function openBulkMove() {
    var board = KB.State.activeBoard();
    var form = h('form', { class: 'card-form' });
    var heading = h('h2');
    heading.textContent = 'Move ' + selected.size + ' cards';
    form.appendChild(heading);

    var columnSelect = h('select', { id: 'bm-column', 'aria-label': 'Destination column' });
    board.columns.forEach(function (column) {
      columnSelect.appendChild(new Option(column.title, column.id));
    });
    form.appendChild(KB.Modal.fieldBlock('Column', columnSelect));

    var actions = h('div', { class: 'modal-actions' });
    actions.appendChild(h('span', { class: 'spacer' }));
    var cancelBtn = h('button', { type: 'button', class: 'btn ghost' });
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', KB.Modal.close);
    actions.appendChild(cancelBtn);
    var moveBtn = h('button', { type: 'submit', class: 'btn primary' });
    moveBtn.textContent = 'Move';
    actions.appendChild(moveBtn);
    form.appendChild(actions);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var target = { boardId: board.id, columnId: columnSelect.value };
      var result = KB.State.bulkMove(refs(), target, {});
      if (result && result.reason === 'policy-violations') {
        var message = result.violations.length + ' card(s) would violate a column policy.';
        KB.Modal.moveConfirmModal('Bulk move requires confirmation', { violations: [{ code: 'policy', message: message }] }, '', function () {
          KB.State.bulkMove(refs(), target, { confirmed: true });
          KB.Modal.close();
          finishBulk('Card(s) moved');
        });
        return;
      }
      KB.Modal.close();
      if (result && result.changed) finishBulk(KB.Dom.plural(result.value.length, 'card') + ' moved');
      else KB.UI.toast('Move not allowed', 'error');
    });

    KB.Modal.open(form);
  }

  function finishBulk(message) {
    KB.UI.toast(message, 'success', 'Undo', KB.UI.undoAction);
    clear();
    KB.App.refresh();
  }

  function openBulkLabels(add) {
    var board = KB.State.activeBoard();
    var form = h('form', { class: 'card-form' });
    var heading = h('h2');
    heading.textContent = add ? 'Add labels' : 'Remove labels';
    form.appendChild(heading);
    var labelsBox = h('div', { class: 'label-picker' });
    var picked = new Set();
    board.labels.forEach(function (label) {
      var chip = KB.Modal.labelToggleChip ? makeChip(label) : null;
      labelsBox.appendChild(chip);
      chip.addEventListener('click', function () {
        if (picked.has(label.id)) picked.delete(label.id);
        else picked.add(label.id);
      });
    });
    form.appendChild(KB.Modal.fieldBlock('Labels', labelsBox));
    var actions = h('div', { class: 'modal-actions' });
    actions.appendChild(h('span', { class: 'spacer' }));
    var cancelBtn = h('button', { type: 'button', class: 'btn ghost' });
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', KB.Modal.close);
    actions.appendChild(cancelBtn);
    var saveBtn = h('button', { type: 'submit', class: 'btn primary' });
    saveBtn.textContent = 'Apply';
    actions.appendChild(saveBtn);
    form.appendChild(actions);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var current = KB.State.data();
      var newLabels = [];
      refs().forEach(function (ref) {
        var board = KB.State.boardById(ref.boardId);
        var card = KB.Core.Relations.findCard(current, ref.boardId, ref.cardId);
        if (!board || !card) return;
        var set = new Set(card.labels || []);
        picked.forEach(function (id) {
          if (add) set.add(id);
          else set.delete(id);
        });
        newLabels.push({ ref: ref, labels: Array.from(set) });
      });
      newLabels.forEach(function (entry) {
        KB.State.bulkUpdate([entry.ref], { labels: entry.labels });
      });
      KB.Modal.close();
      finishBulk('Labels updated');
    });

    KB.Modal.open(form);
  }

  function makeChip(label) {
    var chip = h('button', { type: 'button', class: 'chip', 'data-id': label.id, title: 'Toggle label' });
    var dot = h('span', { class: 'dot' });
    dot.style.background = label.color;
    chip.appendChild(dot);
    chip.appendChild(document.createTextNode(label.name));
    KB.Dom.paintChip(chip, label.color);
    return chip;
  }

  function openBulkDue() {
    var form = h('form', { class: 'card-form' });
    var heading = h('h2');
    heading.textContent = 'Set due date';
    form.appendChild(heading);
    var input = h('input', { type: 'date', id: 'bm-due', 'aria-label': 'Due date' });
    form.appendChild(KB.Modal.fieldBlock('Due date', input));
    var actions = h('div', { class: 'modal-actions' });
    actions.appendChild(h('span', { class: 'spacer' }));
    var cancelBtn = h('button', { type: 'button', class: 'btn ghost' });
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', KB.Modal.close);
    actions.appendChild(cancelBtn);
    var saveBtn = h('button', { type: 'submit', class: 'btn primary' });
    saveBtn.textContent = 'Apply';
    actions.appendChild(saveBtn);
    form.appendChild(actions);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      KB.Modal.close();
      applyBulkPatch({ due: input.value || '' });
    });
    KB.Modal.open(form);
  }

  function openBulkFlow(stateName) {
    KB.Modal.promptModal('Reason', 'Why?', '', function (reason) {
      applyBulkPatch({ flowPatch: stateName, flowReason: reason });
    });
  }

  function applyBulkPatch(patch) {
    var flowPatch = patch.flowPatch;
    var flowReason = patch.flowReason || '';
    var rest = {};
    Object.keys(patch).forEach(function (key) {
      if (key !== 'flowPatch' && key !== 'flowReason') rest[key] = patch[key];
    });
    if (Object.keys(rest).length > 0) {
      KB.State.bulkUpdate(refs(), rest);
    }
    if (flowPatch) {
      var activeBoard = KB.State.activeBoard();
      refs().forEach(function (ref) {
        if (ref.boardId !== activeBoard.id) return;
        var board = KB.State.boardById(ref.boardId);
        if (!board) return;
        var column = null;
        for (var i = 0; i < board.columns.length; i++) {
          if (board.columns[i].cards.some(function (c) { return c.id === ref.cardId; })) {
            column = board.columns[i];
            break;
          }
        }
        if (column) KB.State.setFlowState(column.id, ref.cardId, flowPatch, flowReason);
      });
    }
    finishBulk('Updated ' + selected.size + ' card(s)');
  }

  function wireSelection() {
    KB.el('board-area').addEventListener('click', function (e) {
      var cardEl = e.target.closest('.card');
      if (!cardEl) return;
      if (e.target.closest('button, input, select, textarea, a')) return;
      var board = KB.State.activeBoard();
      if (!board) return;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        toggle(board.id, cardEl.dataset.id);
        return;
      }
      if (e.shiftKey) {
        e.preventDefault();
        selectRange(board.id, lastClickedCardId || cardEl.dataset.id, cardEl.dataset.id);
        lastClickedCardId = cardEl.dataset.id;
        return;
      }
      if (selected.size > 0) {
        e.preventDefault();
        lastClickedCardId = cardEl.dataset.id;
        selectRange(board.id, lastClickedCardId, cardEl.dataset.id);
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && selected.size > 0) {
        clear();
        KB.App.refresh();
      }
    });
  }

  var lastClickedCardId = null;

  KB.Select = {
    refs: refs,
    has: has,
    count: count,
    toggle: toggle,
    clear: clear,
    syncAll: syncAll,
    renderToolbar: renderToolbar,
    wire: wireSelection,
    clearAndRender: clearAndRender
  };
})(window.KB = window.KB || {});
