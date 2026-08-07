(function (root, factory) {
  var api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.KB = root.KB || {};
    root.KB.Core = root.KB.Core || {};
    root.KB.Core.History = api;
  }
})(
  typeof globalThis !== 'undefined' ? globalThis : this,
  function () {
    var DEFAULT_LIMIT = 50;

    function createHistory(limit) {
      var max = typeof limit === 'number' && limit > 0 ? limit : DEFAULT_LIMIT;
      var undoStack = [];
      var redoStack = [];

      function record(snapshot) {
        redoStack.length = 0;
        undoStack.push(JSON.stringify(snapshot));
        if (undoStack.length > max) undoStack.shift();
      }

      function undo(currentSnapshot) {
        if (undoStack.length === 0) return null;
        redoStack.push(JSON.stringify(currentSnapshot));
        return JSON.parse(undoStack.pop());
      }

      function redo(currentSnapshot) {
        if (redoStack.length === 0) return null;
        undoStack.push(JSON.stringify(currentSnapshot));
        return JSON.parse(redoStack.pop());
      }

      function clear() {
        undoStack.length = 0;
        redoStack.length = 0;
      }

      function canUndo() {
        return undoStack.length > 0;
      }

      function canRedo() {
        return redoStack.length > 0;
      }

      return {
        record: record,
        undo: undo,
        redo: redo,
        clear: clear,
        canUndo: canUndo,
        canRedo: canRedo
      };
    }

    return {
      createHistory: createHistory
    };
  }
);
