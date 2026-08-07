(function (KB) {
  var INTERACTIVE = 'button, input, select, textarea, a';

  var boardEl = null;
  var dragType = null;
  var cardId = null;
  var fromColumnId = null;
  var columnId = null;
  var dropLine = null;

  function init(el) {
    boardEl = el;
    el.addEventListener('dragstart', onDragStart);
    el.addEventListener('dragover', onDragOver);
    el.addEventListener('drop', onDrop);
    el.addEventListener('dragend', onDragEnd);
    el.addEventListener('dragleave', onDragLeave);
  }

  function onDragStart(e) {
    if (e.target.closest(INTERACTIVE)) {
      e.preventDefault();
      return;
    }
    var card = e.target.closest('.card');
    var column = e.target.closest('.column');
    if (card) {
      if (KB.Filters.sortActive()) {
        e.preventDefault();
        return;
      }
      dragType = 'card';
      cardId = card.dataset.id;
      var list = card.closest('.card-list');
      fromColumnId = list ? list.dataset.columnId : null;
    } else if (column) {
      dragType = 'column';
      columnId = column.dataset.id;
    } else {
      return;
    }
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragType === 'card' ? cardId : columnId);
    setTimeout(function () {
      if (dragType === 'card') card.classList.add('dragging');
      else column.classList.add('dragging');
    }, 0);
  }

  function cardInsertIndex(list, clientY) {
    var cards = Array.prototype.slice.call(list.querySelectorAll('.card:not(.dragging)'));
    for (var i = 0; i < cards.length; i++) {
      var rect = cards[i].getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) return i;
    }
    return cards.length;
  }

  function columnInsertIndex(clientX) {
    var columns = Array.prototype.slice.call(boardEl.querySelectorAll('.column:not(.dragging)'));
    for (var i = 0; i < columns.length; i++) {
      var rect = columns[i].getBoundingClientRect();
      if (clientX < rect.left + rect.width / 2) return i;
    }
    return columns.length;
  }

  function showLine(list, index) {
    clearLine();
    dropLine = document.createElement('div');
    dropLine.className = 'drop-line';
    var cards = Array.prototype.slice.call(list.querySelectorAll('.card:not(.dragging)'));
    var listRect = list.getBoundingClientRect();
    var top = 6;
    if (cards.length > 0) {
      var anchor = index < cards.length ? cards[index] : cards[cards.length - 1];
      var rect = anchor.getBoundingClientRect();
      top = (index < cards.length ? rect.top - 1 : rect.bottom - 1) - listRect.top + list.scrollTop;
    }
    dropLine.style.top = Math.max(0, top) + 'px';
    list.appendChild(dropLine);
  }

  function clearLine() {
    if (dropLine) dropLine.remove();
    dropLine = null;
  }

  function clearColumnIndicators() {
    boardEl.querySelectorAll('.col-drop, .col-drop-last').forEach(function (col) {
      col.classList.remove('col-drop', 'col-drop-last');
    });
  }

  function onDragOver(e) {
    if (dragType === 'card') {
      var header = e.target.closest('.column-header');
      if (header) {
        var headerList = header.parentElement.querySelector('.card-list');
        if (!headerList) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        showLine(headerList, headerList.querySelectorAll('.card').length);
        return;
      }
      var list = e.target.closest('.card-list');
      if (!list) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      showLine(list, cardInsertIndex(list, e.clientY));
      return;
    }
    if (dragType === 'column') {
      var column = e.target.closest('.column');
      if (!column || column.classList.contains('dragging')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      clearColumnIndicators();
      var columns = Array.prototype.slice.call(boardEl.querySelectorAll('.column:not(.dragging)'));
      var index = columnInsertIndex(e.clientX);
      if (index < columns.length) columns[index].classList.add('col-drop');
      else columns[columns.length - 1].classList.add('col-drop-last');
    }
  }

  function onDrop(e) {
    if (!dragType) return;
    e.preventDefault();
    if (dragType === 'card') {
      var list = e.target.closest('.card-list');
      var header = e.target.closest('.column-header');
      if (list || header) {
        var targetList = list || header.parentElement.querySelector('.card-list');
        var toColumnId = targetList.dataset.columnId;
        var index = list
          ? cardInsertIndex(targetList, e.clientY)
          : targetList.querySelectorAll('.card').length;
        KB.State.moveCard(fromColumnId, cardId, toColumnId, index);
        KB.App.refresh();
      }
    } else if (dragType === 'column') {
      var column = e.target.closest('.column');
      if (column) {
        KB.State.moveColumn(columnId, columnInsertIndex(e.clientX));
        KB.App.refresh();
      }
    }
    reset();
  }

  function onDragLeave(e) {
    if (e.target === boardEl) resetIndicators();
  }

  function onDragEnd() {
    reset();
  }

  function resetIndicators() {
    clearLine();
    clearColumnIndicators();
  }

  function reset() {
    resetIndicators();
    boardEl.querySelectorAll('.dragging').forEach(function (el) {
      el.classList.remove('dragging');
    });
    dragType = null;
    cardId = null;
    fromColumnId = null;
    columnId = null;
  }

  KB.DnD = { init: init };
})(window.KB = window.KB || {});
