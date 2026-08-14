(function () {
  // Runs synchronously in <head> before the first paint: the crash-mirror
  // envelope holds the most recent state; pre-upgrade builds wrote the plain
  // state under kanban.board.v1. Read both so the boot theme matches what the
  // board will load.
  function apply(theme, accentId) {
    var T = window.KB && window.KB.Themes;
    if (T) T.applyTo(document.documentElement, theme, accentId);
    else document.documentElement.dataset.theme = theme;
  }

  try {
    var raw = localStorage.getItem('kanban.mirror.v1');
    var parsed = raw ? JSON.parse(raw) : null;
    if (parsed && parsed.payload && parsed.payload.theme) {
      apply(parsed.payload.theme, parsed.payload.accent);
    } else {
      var legacyRaw = localStorage.getItem('kanban.board.v1');
      var legacyParsed = legacyRaw ? JSON.parse(legacyRaw) : null;
      if (legacyParsed && legacyParsed.theme) {
        apply(legacyParsed.theme, legacyParsed.accent);
      }
    }
  } catch (err) {
    // Corrupt envelope/legacy payload — the default theme in <html> applies.
  }
})();
