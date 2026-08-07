(function (KB) {
  var h = KB.Dom.h;

  var moveMode = null;

  function announce(text) {
    var region = KB.el('live-region');
    if (!region) return;
    region.textContent = '';
    setTimeout(function () {
      region.textContent = text;
    }, 30);
  }

  function cardPosition(cardEl) {
    var list = cardEl.closest('.card-list');
    if (!list) return null;
    var cards = Array.prototype.slice.call(list.querySelectorAll('.card:not(.dragging)'));
    return { list: list, index: cards.indexOf(cardEl), cards: cards };
  }

  function visibleColumns() {
    return Array.prototype.slice.call(KB.el('board').querySelectorAll('.column'));
  }

  function moveTargetDescription(columnEl, position) {
    var columnTitle = columnEl.querySelector('.col-title').textContent;
    var cards = columnEl.querySelectorAll('.card').length;
    return ', position ' + (position + 1) + ' of ' + Math.max(cards, 1) + ', ' + columnTitle + '.';
  }

  function startMoveMode(cardEl) {
    moveMode = { cardEl: cardEl, columnIndex: null, position: null };
    syncTarget();
    cardEl.classList.add('move-target');
    announce(cardEl.querySelector('.card-title').textContent + moveTargetDescription(moveMode.columnEl, moveMode.position));
  }

  function syncTarget() {
    var columns = visibleColumns();
    var current = cardPosition(moveMode.cardEl);
    var currentColumnEl = current ? current.list.closest('.column') : null;
    moveMode.columnIndex = currentColumnEl ? columns.indexOf(currentColumnEl) : 0;
    moveMode.columnEl = columns[moveMode.columnIndex];
    moveMode.position = current ? current.index : 0;
    updateHighlight();
  }

  function updateHighlight() {
    var columns = visibleColumns();
    columns.forEach(function (column, index) {
      column.classList.toggle('move-col-target', index === moveMode.columnIndex);
      var cards = Array.prototype.slice.call(column.querySelectorAll('.card:not(.dragging)'));
      cards.forEach(function (card, i) {
        card.classList.toggle('move-pos-target', index === moveMode.columnIndex && i === moveMode.position);
      });
    });
  }

  function moveLeft() {
    var columns = visibleColumns();
    if (moveMode.columnIndex > 0) {
      moveMode.columnIndex -= 1;
      moveMode.columnEl = columns[moveMode.columnIndex];
      moveMode.position = Math.min(moveMode.position, Math.max(0, moveMode.columnEl.querySelectorAll('.card').length - 1));
    }
    updateHighlight();
    announce(moveTargetDescription(moveMode.columnEl, moveMode.position));
  }

  function moveRight() {
    var columns = visibleColumns();
    if (moveMode.columnIndex < columns.length - 1) {
      moveMode.columnIndex += 1;
      moveMode.columnEl = columns[moveMode.columnIndex];
      moveMode.position = Math.min(moveMode.position, Math.max(0, moveMode.columnEl.querySelectorAll('.card').length - 1));
    }
    updateHighlight();
    announce(moveTargetDescription(moveMode.columnEl, moveMode.position));
  }

  function moveUp() {
    moveMode.position = Math.max(0, moveMode.position - 1);
    updateHighlight();
    announce(moveTargetDescription(moveMode.columnEl, moveMode.position));
  }

  function moveDown() {
    var maxPosition = Math.max(0, moveMode.columnEl.querySelectorAll('.card').length - 1);
    moveMode.position = Math.min(maxPosition, moveMode.position + 1);
    updateHighlight();
    announce(moveTargetDescription(moveMode.columnEl, moveMode.position));
  }

  function cancelMoveMode() {
    clearHighlight();
    if (moveMode) {
      moveMode.cardEl.focus();
      announce('Move cancelled.');
    }
    moveMode = null;
  }

  function clearHighlight() {
    KB.el('board').querySelectorAll('.move-col-target, .move-pos-target').forEach(function (el) {
      el.classList.remove('move-col-target', 'move-pos-target');
    });
  }

  function commitMove() {
    var target = moveMode;
    if (!target) return;
    var columns = visibleColumns();
    var columnEl = columns[target.columnIndex];
    var cardEl = target.cardEl;
    var fromList = cardEl.closest('.card-list');
    var fromColumnId = fromList ? fromList.dataset.columnId : null;
    var cardId = cardEl.dataset.id;
    var toColumnId = columnEl.dataset.id;
    var toIndex = target.position;
    var title = cardEl.querySelector('.card-title').textContent;

    clearHighlight();
    var evaluation = KB.State.evaluateMove(fromColumnId, cardId, toColumnId);
    if (!evaluation) {
      cancelMoveMode();
      return;
    }
    var finish = function (moved) {
      moveMode = null;
      KB.App.refresh();
      if (moved && moved.ok) {
        announce(title + ', Moved to' + moveTargetDescription(columnEl, toIndex));
        var fresh = KB.el('board').querySelector('.card[data-id="' + cardId + '"]');
        if (fresh) fresh.focus();
      } else {
        announce('Move cancelled.');
        cardEl.focus();
      }
    };
    if (evaluation.allowed && !evaluation.requiresConfirmation) {
      var moved = KB.State.moveCardChecked(fromColumnId, cardId, toColumnId, toIndex);
      KB.App.afterCardMove(moved);
      finish(moved);
    } else {
      KB.Modal.moveConfirmModal('Move requires confirmation', evaluation, '', function (reason) {
        var moved = KB.State.moveCardChecked(fromColumnId, cardId, toColumnId, toIndex, { confirmed: true, overrideReason: reason });
        KB.App.afterCardMove(moved);
        finish(moved);
      });
    }
  }

  function onKeyDown(e) {
    if (!moveMode) return;
    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        moveLeft();
        break;
      case 'ArrowRight':
        e.preventDefault();
        moveRight();
        break;
      case 'ArrowUp':
        e.preventDefault();
        moveUp();
        break;
      case 'ArrowDown':
        e.preventDefault();
        moveDown();
        break;
      case 'Home':
        e.preventDefault();
        moveMode.position = 0;
        updateHighlight();
        announce(moveTargetDescription(moveMode.columnEl, 0));
        break;
      case 'End':
        e.preventDefault();
        moveMode.position = Math.max(0, moveMode.columnEl.querySelectorAll('.card').length - 1);
        updateHighlight();
        announce(moveTargetDescription(moveMode.columnEl, moveMode.position));
        break;
      case 'Enter':
        e.preventDefault();
        commitMove();
        break;
      case 'Escape':
        e.preventDefault();
        cancelMoveMode();
        break;
    }
  }

  function maybeStartMoveMode(cardEl) {
    if (moveMode || KB.Modal.isOpen()) return;
    if (KB.Filters.sortActive()) {
      KB.UI.toast('Sorting is active — switch to Manual order to move cards', 'info');
      return;
    }
    startMoveMode(cardEl);
  }

  function wireKeyboardMove() {
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keydown', function (e) {
      var tag = document.activeElement && document.activeElement.tagName;
      var typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      var mod = e.ctrlKey || e.metaKey || e.altKey;
      if (typing || mod || KB.Modal.isOpen() || KB.Workspaces.current() !== 'board') return;
      if (e.key === 'm' || e.key === 'M') {
        var cardEl = document.activeElement && document.activeElement.closest ? document.activeElement.closest('.card') : null;
        if (!cardEl) {
          var first = KB.el('board').querySelector('.card');
          if (first) first.focus();
          return;
        }
        e.preventDefault();
        maybeStartMoveMode(cardEl);
      }
    });
  }

  function mapLabelsAcrossBoards(sourceBoardId, card, targetBoard) {
    return KB.State.mapLabelsAcrossBoards(sourceBoardId, card, targetBoard);
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
    form.appendChild(KB.Modal.fieldBlock('Board', boardSelect));

    var columnSelect = h('select', { id: 'mt-column', 'aria-label': 'Destination column' });
    var positionSelect = h('select', { id: 'mt-position', 'aria-label': 'Position' });
    [['top', 'Top'], ['bottom', 'Bottom'], ['before', 'Before card…'], ['after', 'After card…']].forEach(function (pair) {
      positionSelect.appendChild(new Option(pair[1], pair[0]));
    });
    var cardSelect = h('select', { id: 'mt-card', 'aria-label': 'Reference card' });
    form.appendChild(KB.Modal.fieldBlock('Column', columnSelect));
    form.appendChild(KB.Modal.fieldBlock('Position', positionSelect));
    form.appendChild(KB.Modal.fieldBlock('Card', cardSelect));

    var warn = h('div', { class: 'form-hint mt-warn' });
    form.appendChild(warn);

    function fillColumns() {
      columnSelect.innerHTML = '';
      var board = KB.State.boardById(boardSelect.value);
      (board.columns || []).forEach(function (column) {
        columnSelect.appendChild(new Option(column.title, column.id));
      });
      if (options.columnId && board.id === boardId) columnSelect.value = options.columnId;
      fillCards();
      updateWarning();
    }

    function fillCards() {
      cardSelect.innerHTML = '';
      var board = KB.State.boardById(boardSelect.value);
      var column = board.columns.find(function (c) { return c.id === columnSelect.value; });
      (column ? column.cards : []).forEach(function (c) {
        if (c.id === cardId) return;
        cardSelect.appendChild(new Option(c.title, c.id));
      });
      cardSelect.classList.toggle('hidden', positionSelect.value === 'top' || positionSelect.value === 'bottom');
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
    columnSelect.addEventListener('change', function () {
      fillCards();
      updateWarning();
    });
    positionSelect.addEventListener('change', fillCards);
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
      var toIndex = position === 'top' ? 0 : null;
      if (position === 'bottom' || position === 'before' || position === 'after') {
        var positionBoard = KB.State.boardById(targetBoardId);
        var positionColumn = positionBoard.columns.find(function (c) { return c.id === targetColumnId; });
        if (position === 'bottom') {
          toIndex = positionColumn.cards.length;
        } else {
          var refIndex = positionColumn.cards.findIndex(function (c) { return c.id === cardSelect.value; });
          if (refIndex === -1) {
            KB.UI.toast('Choose a card to position against', 'error');
            return;
          }
          toIndex = position === 'before' ? refIndex : refIndex + 1;
        }
      }
      var sameBoard = targetBoardId === boardId;
      var labelMapping = null;
      if (!sameBoard) {
        labelMapping = mapLabelsAcrossBoards(boardId, card, KB.State.boardById(targetBoardId));
      }
      var evaluation = sameBoard
        ? KB.State.evaluateMove(columnId, cardId, targetColumnId)
        : KB.State.evaluateMoveTo(boardId, cardId, targetBoardId, targetColumnId);
      if (!evaluation) {
        KB.Modal.close();
        KB.UI.toast('Move not available', 'error');
        KB.App.refresh();
        if (options.onDone) options.onDone(null);
        return;
      }
      var finish = function (moved) {
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
      };
      var doMove = function (reason) {
        var opts = { confirmed: true, overrideReason: reason };
        if (!sameBoard && labelMapping) opts.labelMapping = labelMapping.kept;
        var moved = sameBoard
          ? KB.State.moveCardChecked(columnId, cardId, targetColumnId, toIndex, opts)
          : KB.State.moveCardTo(boardId, cardId, targetBoardId, targetColumnId, toIndex, opts);
        finish(moved);
      };
      if (evaluation.allowed && !evaluation.requiresConfirmation) {
        doMove();
      } else {
        KB.Modal.moveConfirmModal('Move requires confirmation', evaluation, '', function (reason) {
          doMove(reason);
        });
      }
    });

    KB.Modal.open(form);
  }

  KB.MoveTo = { moveToMenu: moveToMenu, wireKeyboardMove: wireKeyboardMove, announce: announce };
})(window.KB = window.KB || {});

