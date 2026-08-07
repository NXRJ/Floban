(function (root, factory) {
  var api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.KB = root.KB || {};
    root.KB.Core = root.KB.Core || {};
    root.KB.Core.Date = api;
  }
})(
  typeof globalThis !== 'undefined' ? globalThis : this,
  function () {
    var MS_PER_DAY = 86400000;

    function isoDate(date) {
      var y = date.getFullYear();
      var m = String(date.getMonth() + 1).padStart(2, '0');
      var d = String(date.getDate()).padStart(2, '0');
      return y + '-' + m + '-' + d;
    }

    function addDaysISO(date, offset) {
      var copy = new Date(date.getTime());
      copy.setDate(copy.getDate() + offset);
      return isoDate(copy);
    }

    function classifyDueDate(dueISO, todayISO, tomorrowISO) {
      if (!dueISO) return '';
      if (dueISO < todayISO) return 'overdue';
      if (dueISO <= tomorrowISO) return 'soon';
      return '';
    }

    function isDueMatch(dueISO, dueFilter, todayISO, weekEndISO) {
      switch (dueFilter) {
        case 'overdue':
          return Boolean(dueISO) && dueISO < todayISO;
        case 'today':
          return dueISO === todayISO;
        case 'week':
          return Boolean(dueISO) && dueISO >= todayISO && dueISO <= weekEndISO;
        case 'none':
          return !dueISO;
        default:
          return true;
      }
    }

    function ageInDays(movedAt, now) {
      var days = Math.floor((now - movedAt) / MS_PER_DAY);
      return days < 0 ? 0 : days;
    }

    return {
      isoDate: isoDate,
      addDaysISO: addDaysISO,
      classifyDueDate: classifyDueDate,
      isDueMatch: isDueMatch,
      ageInDays: ageInDays
    };
  }
);
