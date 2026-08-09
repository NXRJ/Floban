(function (KB) {
  function pixelIcon(rects, colorRects) {
    var parts = [];
    rects.forEach(function (r) {
      parts.push('<rect x="' + r[0] + '" y="' + r[1] + '" width="' + r[2] + '" height="' + r[3] + '"/>');
    });
    (colorRects || []).forEach(function (r) {
      parts.push('<rect x="' + r[0] + '" y="' + r[1] + '" width="' + r[2] + '" height="' + r[3] + '" fill="' + r[4] + '"/>');
    });
    return '<svg viewBox="0 0 16 16" aria-hidden="true"><g shape-rendering="crispEdges" fill="currentColor">' + parts.join('') + '</g></svg>';
  }

  var ICONS = {
    plus: pixelIcon([[7, 2, 2, 12], [2, 7, 12, 2]]),
    check: pixelIcon([[2, 7, 2, 2], [4, 8, 2, 2], [6, 9, 2, 2], [8, 10, 2, 2], [10, 11, 2, 2], [12, 12, 2, 2]]),
    x: pixelIcon([
      [2, 2, 2, 2], [4, 4, 2, 2], [6, 6, 2, 2], [8, 8, 2, 2], [10, 10, 2, 2], [12, 12, 2, 2], [14, 14, 2, 2],
      [14, 2, 2, 2], [12, 4, 2, 2], [10, 6, 2, 2], [8, 8, 2, 2], [6, 10, 2, 2], [4, 12, 2, 2], [2, 14, 2, 2]
    ]),
    archive: pixelIcon([[6, 2, 4, 2], [3, 4, 10, 2], [4, 6, 8, 8], [6, 7, 2, 5], [9, 7, 2, 5]]),
    edit: pixelIcon([
      [2, 12, 2, 2], [3, 11, 2, 2], [4, 10, 2, 2], [5, 9, 2, 2], [6, 8, 2, 2], [7, 7, 2, 2], [8, 6, 2, 2],
      [9, 5, 2, 2], [10, 4, 2, 2], [11, 3, 2, 2], [12, 2, 2, 2], [4, 13, 2, 1], [5, 14, 2, 1], [6, 15, 2, 1]
    ]),
    box: pixelIcon([[5, 1, 6, 2], [1, 3, 14, 3], [3, 6, 10, 8], [5, 7, 2, 6], [9, 7, 2, 6]]),
    palette: pixelIcon([[4, 4, 8, 8]], [
      [6, 6, 2, 2, '#ff4136'], [9, 6, 2, 2, '#ffd60a'], [6, 9, 2, 2, '#3fd7e0'], [9, 9, 2, 2, '#8b5cf6']
    ]),
    moon: pixelIcon([[9, 2, 6, 6], [7, 4, 6, 6], [10, 7, 4, 4], [12, 11, 2, 2]]),
    sun: pixelIcon([
      [6, 6, 4, 4], [7, 3, 2, 2], [7, 11, 2, 2], [3, 7, 2, 2], [11, 7, 2, 2],
      [4, 4, 2, 2], [10, 4, 2, 2], [4, 10, 2, 2], [10, 10, 2, 2]
    ]),
    search: pixelIcon([
      [4, 4, 8, 2], [4, 10, 8, 2], [4, 4, 2, 8], [10, 4, 2, 8],
      [12, 12, 2, 1], [13, 13, 2, 1], [14, 14, 2, 1]
    ]),
    grip: pixelIcon([
      [3, 3, 2, 2], [7, 3, 2, 2], [11, 3, 2, 2],
      [3, 7, 2, 2], [7, 7, 2, 2], [11, 7, 2, 2],
      [3, 11, 2, 2], [7, 11, 2, 2], [11, 11, 2, 2]
    ]),
    more: pixelIcon([[2, 7, 2, 2], [7, 7, 2, 2], [12, 7, 2, 2]]),
    person: pixelIcon([[6, 3, 4, 4], [4, 9, 8, 4]]),
    board: pixelIcon([[1, 3, 4, 10], [6, 3, 4, 8], [11, 3, 3, 6]]),
    calendar: pixelIcon([
      [4, 1, 2, 2], [10, 1, 2, 2],
      [2, 3, 12, 2],
      [2, 5, 12, 9],
      [4, 8, 2, 2], [8, 8, 2, 2], [12, 8, 2, 2],
      [4, 11, 2, 2], [8, 11, 2, 2]
    ]),
    checklist: pixelIcon([
      [2, 1, 12, 2], [1, 3, 2, 10], [13, 3, 2, 10], [2, 12, 12, 2],
      [4, 7, 2, 2], [6, 8, 2, 2], [8, 9, 2, 2], [10, 10, 2, 2]
    ]),
    copy: pixelIcon([
      [1, 6, 8, 2], [1, 6, 2, 8], [1, 12, 8, 2], [7, 6, 2, 8],
      [6, 2, 10, 2], [6, 2, 2, 8], [6, 8, 10, 2], [14, 2, 2, 8]
    ]),
    undo: pixelIcon([
      [2, 5, 2, 6], [2, 5, 3, 2], [2, 9, 3, 2],
      [5, 7, 7, 2],
      [12, 7, 2, 4], [12, 9, 4, 2]
    ]),
    download: pixelIcon([
      [3, 1, 10, 2], [7, 4, 2, 4], [5, 8, 6, 2], [6, 10, 4, 2], [2, 12, 12, 2]
    ]),
    upload: pixelIcon([
      [2, 2, 12, 2], [7, 5, 2, 4], [5, 5, 6, 2], [6, 2, 4, 2], [2, 12, 12, 2]
    ]),
    clock: pixelIcon([
      [4, 1, 8, 2], [2, 3, 2, 4], [2, 9, 2, 4], [4, 13, 8, 2], [12, 3, 2, 4], [12, 9, 2, 4],
      [7, 5, 2, 4], [9, 6, 3, 2]
    ]),
    chevronDown: pixelIcon([[3, 6, 2, 2], [5, 8, 2, 2], [7, 10, 2, 2], [9, 8, 2, 2], [11, 6, 2, 2]]),
    chevronUp: pixelIcon([[3, 10, 2, 2], [5, 8, 2, 2], [7, 6, 2, 2], [9, 8, 2, 2], [11, 10, 2, 2]]),
    chevronLeft: pixelIcon([[6, 3, 2, 2], [8, 5, 2, 2], [10, 7, 2, 2], [8, 9, 2, 2], [6, 11, 2, 2]]),
    chevronRight: pixelIcon([[10, 3, 2, 2], [8, 5, 2, 2], [6, 7, 2, 2], [8, 9, 2, 2], [10, 11, 2, 2]]),
    doc: pixelIcon([
      [4, 1, 8, 2], [3, 3, 10, 2], [2, 5, 12, 10],
      [5, 8, 2, 2], [9, 8, 2, 2], [5, 11, 2, 2], [9, 11, 2, 2]
    ]),
    menu: pixelIcon([
      [2, 3, 12, 2], [2, 7, 12, 2], [2, 11, 12, 2]
    ]),
    command: pixelIcon([
      [2, 2, 2, 2], [6, 2, 2, 2], [10, 2, 2, 2], [14, 2, 2, 2],
      [2, 6, 2, 2], [6, 6, 2, 2], [10, 6, 2, 2], [14, 6, 2, 2],
      [2, 10, 2, 2], [6, 10, 2, 2], [10, 10, 2, 2], [14, 10, 2, 2],
      [2, 14, 2, 2], [6, 14, 2, 2], [10, 14, 2, 2], [14, 14, 2, 2]
    ]),
    play: pixelIcon([
      [4, 2, 2, 12], [6, 4, 2, 8], [8, 6, 2, 4], [10, 8, 2, 2]
    ]),
    star: pixelIcon([
      [7, 2, 2, 2], [6, 4, 2, 2], [8, 4, 2, 2], [5, 6, 2, 2], [9, 6, 2, 2],
      [4, 8, 2, 2], [10, 8, 2, 2], [3, 10, 10, 2], [4, 12, 8, 2], [6, 14, 4, 2]
    ])
  };

  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    attrs = attrs || {};
    for (var key in attrs) {
      if (!Object.prototype.hasOwnProperty.call(attrs, key)) continue;
      if (key === 'class') {
        el.className = attrs[key];
      } else if (key.indexOf('data-') === 0) {
        var camel = key.slice(5).replace(/-([a-z])/g, function (m, c) {
          return c.toUpperCase();
        });
        el.dataset[camel] = attrs[key];
      } else if (key in el) {
        el[key] = attrs[key];
      } else {
        el.setAttribute(key, attrs[key]);
      }
    }
    (children || []).forEach(function (child) {
      if (child === null || child === undefined) return;
      el.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return el;
  }

  function icon(name) {
    return ICONS[name] || '';
  }

  function fmtDate(ts) {
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function fmtShortDate(iso) {
    var parts = String(iso).split('-');
    if (parts.length !== 3) return iso;
    var date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }).toUpperCase();
  }

  function isoToday() {
    return KB.Core.Date.isoDate(new Date());
  }

  function isoDaysFromNow(offset) {
    return KB.Core.Date.addDaysISO(new Date(), offset);
  }

  function plural(n, word) {
    return n + ' ' + word + (n === 1 ? '' : 's');
  }

  function inkOn(hex) {
    var h = (hex || '').replace('#', '');
    if (h.length !== 6) return '#111113';
    var r = parseInt(h.slice(0, 2), 16) / 255;
    var g = parseInt(h.slice(2, 4), 16) / 255;
    var b = parseInt(h.slice(4, 6), 16) / 255;
    var lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return lum > 0.52 ? '#111113' : '#f5f5f2';
  }

  function paintChip(chip, color) {
    chip.style.background = color;
    chip.style.color = inkOn(color);
    chip.style.borderColor = 'rgba(0, 0, 0, 0.35)';
  }

  function uid(prefix) {
    return (prefix || 'id') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  }

  KB.el = function (selector) {
    var first = selector.charAt(0);
    var normalized = first === '#' || first === '.' ? selector : '#' + selector;
    return document.querySelector(normalized);
  };

  // Keeps Tab/Shift+Tab cycling inside an overlay so keyboard users cannot
  // tab out of a modal palette or action sheet into the page behind it.
  function trapKey(e, root) {
    if (e.key !== 'Tab') return;
    var focusables = root.querySelectorAll('button, input, select, textarea, [href], [tabindex]:not([tabindex="-1"])');
    if (focusables.length === 0) {
      e.preventDefault();
      return;
    }
    var first = focusables[0];
    var last = focusables[focusables.length - 1];
    var active = document.activeElement;
    var inside = root.contains(active);
    if (e.shiftKey) {
      if (!inside || active === first) {
        e.preventDefault();
        last.focus();
      }
    } else if (!inside || active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  // While an overlay (palette/action sheet) is open, everything else on the
  // page becomes inert + aria-hidden so background content is neither
  // clickable nor announced to screen readers. Overlay roots are excluded.
  function setPageInert(inert) {
    Array.prototype.forEach.call(document.body.children, function (el) {
      if (el.id === 'palette-root' || el.id === 'sheet-root' || el.id === 'modal-root') return;
      if (inert && !el.hasAttribute('inert')) {
        el.setAttribute('inert', '');
        el.setAttribute('aria-hidden', 'true');
      } else if (!inert && el.hasAttribute('inert')) {
        el.removeAttribute('inert');
        el.removeAttribute('aria-hidden');
      }
    });
  }

  // The one mobile breakpoint, owned in one place (CSS media queries use the
  // same 640px value; keep them in sync).
  function isMobile() {
    return window.matchMedia && window.matchMedia('(max-width: 640px)').matches;
  }

  KB.Dom = {
    h: h,
    icon: icon,
    fmtDate: fmtDate,
    fmtShortDate: fmtShortDate,
    inkOn: inkOn,
    paintChip: paintChip,
    uid: uid,
    isoToday: isoToday,
    isoDaysFromNow: isoDaysFromNow,
    plural: plural,
    trapKey: trapKey,
    setPageInert: setPageInert,
    isMobile: isMobile
  };
})(window.KB = window.KB || {});
