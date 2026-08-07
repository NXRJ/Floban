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
    board: pixelIcon([[1, 3, 4, 10], [6, 3, 4, 8], [11, 3, 3, 6]])
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

  function inkOn(hex) {
    var h = (hex || '').replace('#', '');
    if (h.length !== 6) return '#111113';
    var r = parseInt(h.slice(0, 2), 16) / 255;
    var g = parseInt(h.slice(2, 4), 16) / 255;
    var b = parseInt(h.slice(4, 6), 16) / 255;
    var lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return lum > 0.52 ? '#111113' : '#f5f5f2';
  }

  KB.el = function (selector) {
    var first = selector.charAt(0);
    var normalized = first === '#' || first === '.' ? selector : '#' + selector;
    return document.querySelector(normalized);
  };

  KB.Dom = { h: h, icon: icon, fmtDate: fmtDate, inkOn: inkOn };
})(window.KB = window.KB || {});
