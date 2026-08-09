(function () {
  // Runs synchronously in <head> before the first paint: the crash-mirror
  // envelope holds the most recent state; pre-upgrade builds wrote the plain
  // state under kanban.board.v1. Read both so the boot theme matches what the
  // board will load.
  try {
    var raw = localStorage.getItem('kanban.mirror.v1');
    var parsed = raw ? JSON.parse(raw) : null;
    if (parsed && parsed.payload && parsed.payload.theme) {
      document.documentElement.dataset.theme = parsed.payload.theme;
    } else {
      var legacyRaw = localStorage.getItem('kanban.board.v1');
      var legacyParsed = legacyRaw ? JSON.parse(legacyRaw) : null;
      if (legacyParsed && legacyParsed.theme) {
        document.documentElement.dataset.theme = legacyParsed.theme;
      }
    }
  } catch (err) {
    // Corrupt envelope/legacy payload — the default theme in <html> applies.
  }
})();
