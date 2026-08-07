(function (KB) {
  var h = KB.Dom.h;
  var icon = KB.Dom.icon;

  function mapLabelsAcrossBoards(sourceBoardId, card, targetBoard) {
    var dropped = [];
    var kept = [];
    var targetLabels = targetBoard.labels || [];
    var byNameColor = {};
    targetLabels.forEach(function (label) {
      byNameColor[label.name.toLowerCase() + '|' + label.color.toLowerCase()] = label.id;
    });
    var sourceBoard = KB.State.boardById(sourceBoardId);
    var sourceLabels = sourceBoard ? sourceBoard.labels : [];
    var cardLabelIds = card.labels || [];
    cardLabelIds.forEach(function (id) {
      var source = sourceLabels.find(function (l) { return l.id === id; });
      if (!source) return;
      var match = targetLabels.find(function (l) { return l.id === id; });
      if (match) {
        kept.push(match.id);
        return;
      }
      var mapped = byNameColor[source.name.toLowerCase() + '|' + source.color.toLowerCase()];
      if (mapped) kept.push(mapped);
      else dropped.push(source.name);
    });
    return { kept: kept, dropped: dropped };
  }

  function moveToMenu(boardId, columnId, cardId, opts) {
    var options = opts || {};
    var card = KB.State.findCardInBoard(KB.State.boardById(boardId), columnId, cardId);
    if (!card) return;
    var form = h('form', { class: 'card-form' });
    var heading = h('h2');
    heading.textContent = 'Move to…';
    form.appendChild(heading);
    var hint = h('p', { class: 'form-hint' });
    hint.textContent = card.title;
    form.appendChild(hint);

    var boardSelect = h('select', { id: 'mt-board', 'aria-label': 'Destination board' });
    KB.State.boards().forEach(function (board) {
      boardSelect.appendChild(new Option(board.name, board.id));
    });
    boardSelect.value = boardId;
    form.appendChild(KB.Modal.fieldBlock ? fieldBlock('Board', boardSelect) : labelWrap('Board', boardSelect));

    var columnSelect = h('select', { id: 'mt-column', 'aria-label': 'Destination column' });
    var positionSelect = h('select', { id: 'mt-position', 'aria-label': 'Position' });
    [['top', 'Top'], ['bottom', 'Bottom']].forEach(function (pair) {
      positionSelect.appendChild(new Option(pair[1], pair[0]));
    });
    form.appendChild(fieldBlock('Column', columnSelect));
    form.appendChild(fieldBlock('Position', positionSelect));

    var warn = h('div', { class: 'form-hint mt-warn' });
    form.appendChild(warn);

    function fillColumns() {
      columnSelect.innerHTML = '';
      var board = KB.State.boardById(boardSelect.value);
      (board.columns || []).forEach(function (column) {
        columnSelect.appendChild(new Option(column.title, column.id));
      });
      if (options.columnId && board.id === boardId) columnSelect.value = options.columnId;
      updateWarning();
    }

    function updateWarning() {
      var board = KB.State.boardById(boardSelect.value);
      var target = board.columns.find(function (c) { return c.id === columnSelect.value; });
      if (!target) {
        warn.textContent = '';
        return;
      }
      var sameBoard = board.id === boardId;
      if (!sameBoard) {
        var mapping = mapLabelsAcrossBoards(boardId, card, board);
        if (mapping.dropped.length > 0) {
          warn.textContent = 'Labels dropped: ' + mapping.dropped.join(', ');
        } else {
          warn.textContent = '';
        }
      } else {
        warn.textContent = '';
      }
    }

    boardSelect.addEventListener('change', fillColumns);
    columnSelect.addEventListener('change', updateWarning);
    fillColumns();

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
      var targetBoardId = boardSelect.value;
      var targetColumnId = columnSelect.value;
      var position = positionSelect.value;
      var toIndex = position === 'top' ? 0 : undefined;
      var sameBoard = targetBoardId === boardId;
      var labelMapping = null;
      if (!sameBoard) {
        labelMapping = mapLabelsAcrossBoards(boardId, card, KB.State.boardById(targetBoardId));
      }
      var moved = null;
      if (sameBoard) {
        moved = KB.State.moveCardChecked(columnId, cardId, targetColumnId, toIndex, { confirmed: true });
      } else {
        moved = KB.State.moveCardTo(boardId, cardId, targetBoardId, targetColumnId, toIndex, {
          confirmed: true,
          labelMapping: labelMapping ? labelMapping.kept : null
        });
      }
      KB.Modal.close();
      if (moved && moved.ok) {
        var labelNote = '';
        if (labelMapping && labelMapping.dropped.length > 0) {
          labelNote = ' — dropped labels: ' + labelMapping.dropped.join(', ');
        }
        KB.UI.toast('Card moved' + labelNote, 'success', 'Undo', KB.UI.undoAction);
      } else {
        KB.UI.toast('Move not allowed', 'error');
      }
      KB.App.refresh();
      if (options.onDone) options.onDone(moved);
    });

    KB.Modal.open(form);
  }

  function fieldBlock(labelText, control) {
    var wrap = h('label', { class: 'field' });
    if (labelText) {
      var label = h('span');
      label.textContent = labelText;
      wrap.appendChild(label);
    }
    wrap.appendChild(control);
    return wrap;
  }

  function labelWrap(labelText, control) {
    return fieldBlock(labelText, control);
  }

  KB.App.moveToMenu = moveToMenu;
})(window.KB = window.KB || {});
