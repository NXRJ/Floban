(function (root, factory) {
  var dateCore = (typeof module === 'object' && module.exports)
    ? require('./date.js')
    : root.KB.Core.Date;
  var api = factory(dateCore);

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.KB = root.KB || {};
    root.KB.Core = root.KB.Core || {};
    root.KB.Core.Focus = api;
  }
})(
  typeof globalThis !== 'undefined' ? globalThis : this,
  function (DateCore) {
    // Focus sessions: a task-tied timer (pomodoro or stopwatch) with per-card
    // and per-day effort accounting. Pure, deterministic — elapsed time is
    // always (now - startedAt) computed from timestamps, never tick counting,
    // so the browser renderer can redraw as often as it likes without drift.
    //
    // Session shape: { cardId, startedAt (ms), kind: 'pomodoro'|'stopwatch' }.
    // Card effort: card.effort = { pomodoros, minutes }.
    // Per-day totals: state.focusDays = { 'YYYY-MM-DD': { minutes, pomodoros } }.

    var DEFAULT_POMODORO_MS = 25 * 60 * 1000;
    var MIN_LOG_MINUTES = 1;

    function elapsedMs(startedAt, now) {
      return Math.max(0, now - startedAt);
    }

    function elapsedMinutes(startedAt, now) {
      return Math.round(elapsedMs(startedAt, now) / 60000);
    }

    // The pure core of ending a session: what to log, given the session and
    // the clock. A pomodoro only counts when it ran its full length; sessions
    // under a minute log nothing (no effort noise from accidental starts).
    function computeEnd(session, now, pomodoroLengthMs) {
      if (!session || typeof session.cardId !== 'string') {
        return { changed: false, reason: 'no-session' };
      }
      var length = typeof pomodoroLengthMs === 'number' ? pomodoroLengthMs : DEFAULT_POMODORO_MS;
      var ms = elapsedMs(session.startedAt, now);
      var minutes = Math.round(ms / 60000);
      var pomodoros = 0;
      if (session.kind === 'pomodoro' && ms >= length) pomodoros = 1;
      // Sub-minute sessions log nothing (round(0.5) = 1 would otherwise leak
      // a phantom minute from an accidental 30s start).
      var logged = ms >= 60000 || pomodoros > 0;
      return {
        changed: true,
        logged: logged,
        cardId: session.cardId,
        minutes: logged ? minutes : 0,
        pomodoros: pomodoros,
        dayISO: DateCore.isoDate(new Date(now))
      };
    }

    function startable(state) {
      return !state.focusSession;
    }

    // Total effort for days on or after sinceISO ('' = all days).
    function focusTotals(focusDays, sinceISO) {
      var days = focusDays && typeof focusDays === 'object' ? focusDays : {};
      var total = { minutes: 0, pomodoros: 0 };
      Object.keys(days).forEach(function (key) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return;
        if (sinceISO && key < sinceISO) return;
        var entry = days[key];
        if (!entry || typeof entry !== 'object') return;
        total.minutes += typeof entry.minutes === 'number' ? entry.minutes : 0;
        total.pomodoros += typeof entry.pomodoros === 'number' ? entry.pomodoros : 0;
      });
      return total;
    }

    function formatEffort(minutes) {
      var m = Math.max(0, Math.round(minutes || 0));
      if (m < 60) return m + 'm';
      var h = Math.floor(m / 60);
      var rest = m % 60;
      return rest === 0 ? h + 'h' : h + 'h' + String(rest).padStart(2, '0') + 'm';
    }

    return {
      DEFAULT_POMODORO_MS: DEFAULT_POMODORO_MS,
      MIN_LOG_MINUTES: MIN_LOG_MINUTES,
      elapsedMs: elapsedMs,
      elapsedMinutes: elapsedMinutes,
      computeEnd: computeEnd,
      startable: startable,
      focusTotals: focusTotals,
      formatEffort: formatEffort
    };
  }
);
