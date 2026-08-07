(function (root, factory) {
  var api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.KB = root.KB || {};
    root.KB.Core = root.KB.Core || {};
    root.KB.Core.Inbox = api;
  }
})(
  typeof globalThis !== 'undefined' ? globalThis : this,
  function () {
    var SAFE_URL_RE = /^https?:\/\//i;
    var DANGEROUS_URL_RE = /^(javascript|data|vbscript|file):/i;

    function resolveDeps(deps) {
      if (!deps || typeof deps.uid !== 'function' || typeof deps.now !== 'function') {
        throw new Error('core inbox functions require { uid, now } dependencies');
      }
      return deps;
    }

    function cloneState(state) {
      return JSON.parse(JSON.stringify(state));
    }

    function noop(state, reason) {
      return { changed: false, state: state, value: null, reason: reason };
    }

    function parseUrl(input) {
      var text = String(input || '').trim();
      if (!text) return { url: '', title: '' };
      if (SAFE_URL_RE.test(text) && !DANGEROUS_URL_RE.test(text)) {
        var title = '';
        try {
          var parsed = new URL(text);
          var host = parsed.hostname;
          if (host) {
            var readable = host.replace(/^www\./, '');
            title = readable ? 'Link: ' + readable : '';
          }
        } catch (err) {
          title = '';
        }
        return { url: text, title: title };
      }
      return { url: '', title: '' };
    }

    function buildItem(input, deps) {
      var d = resolveDeps(deps);
      var now = d.now();
      var titleText = typeof input.title === 'string' ? input.title.trim() : '';
      var noteText = typeof input.note === 'string' ? input.note.trim() : '';
      var urlInfo = parseUrl(typeof input.url === 'string' && input.url ? input.url : (titleText && !noteText ? titleText : ''));
      var title = titleText;
      if (urlInfo.url && titleText === urlInfo.url) title = urlInfo.title || '';
      if (!title && urlInfo.title) title = urlInfo.title;
      return {
        id: d.uid(),
        title: title,
        note: noteText,
        url: urlInfo.url,
        capturedAt: now,
        updatedAt: now
      };
    }

    function captureItem(state, input, deps) {
      var d = resolveDeps(deps);
      var titleText = input && typeof input.title === 'string' ? input.title.trim() : '';
      if (!titleText && !(input && (input.url || ''))) {
        return noop(state, 'empty-capture');
      }
      var next = cloneState(state);
      if (!next.inbox || !Array.isArray(next.inbox.items)) next.inbox = { items: [] };
      var item = buildItem(input, deps);
      if (!item.title && !item.url) return noop(state, 'empty-capture');
      next.inbox.items.push(item);
      return { changed: true, state: next, value: item };
    }

    function captureLines(state, text, deps) {
      var d = resolveDeps(deps);
      var lines = String(text || '').split('\n').map(function (line) { return line.trim(); }).filter(Boolean);
      if (lines.length === 0) return noop(state, 'empty-capture');
      var next = cloneState(state);
      if (!next.inbox || !Array.isArray(next.inbox.items)) next.inbox = { items: [] };
      var added = [];
      lines.forEach(function (line) {
        var urlInfo = parseUrl(line);
        var item = buildItem({ title: urlInfo.url ? '' : line, url: urlInfo.url ? line : '' }, deps);
        if (item.title || item.url) {
          next.inbox.items.push(item);
          added.push(item);
        }
      });
      if (added.length === 0) return noop(state, 'empty-capture');
      return { changed: true, state: next, value: added };
    }

    function updateInboxItem(state, id, patch, deps) {
      var d = resolveDeps(deps);
      var next = cloneState(state);
      var items = next.inbox && Array.isArray(next.inbox.items) ? next.inbox.items : [];
      var item = items.find(function (it) { return it.id === id; });
      if (!item) return noop(state, 'item-not-found');
      var changed = false;
      Object.keys(patch || {}).forEach(function (key) {
        if (key === 'id' || key === 'capturedAt') return;
        if (item[key] !== patch[key]) {
          item[key] = patch[key];
          changed = true;
        }
      });
      if (!changed) return noop(state, 'no-change');
      item.updatedAt = d.now();
      return { changed: true, state: next, value: item };
    }

    function deleteInboxItem(state, id) {
      var next = cloneState(state);
      var items = next.inbox && Array.isArray(next.inbox.items) ? next.inbox.items : [];
      var index = items.findIndex(function (it) { return it.id === id; });
      if (index === -1) return noop(state, 'item-not-found');
      items.splice(index, 1);
      return { changed: true, state: next, value: true };
    }

    function triageInboxItem(state, id, target, cardPatch, deps) {
      var d = resolveDeps(deps);
      var next = cloneState(state);
      var items = next.inbox && Array.isArray(next.inbox.items) ? next.inbox.items : [];
      var index = items.findIndex(function (it) { return it.id === id; });
      if (index === -1) return noop(state, 'item-not-found');
      var item = items[index];
      var board = next.boards.find(function (b) { return b.id === target.boardId; });
      if (!board) return noop(state, 'board-not-found');
      var column = board.columns.find(function (c) { return c.id === target.columnId; });
      if (!column) return noop(state, 'column-not-found');
      items.splice(index, 1);
      var now = d.now();
      var patch = cardPatch || {};
      var card = {
        id: d.uid(),
        columnId: column.id,
        title: typeof patch.title === 'string' && patch.title.trim() ? patch.title.trim() : item.title,
        description: typeof patch.description === 'string' ? patch.description : item.note,
        labels: Array.isArray(patch.labels) ? patch.labels.slice() : [],
        assignee: typeof patch.assignee === 'string' ? patch.assignee : '',
        due: typeof patch.due === 'string' ? patch.due : '',
        priority: patch.priority || 'none',
        size: patch.size || 'none',
        checklist: Array.isArray(patch.checklist) ? patch.checklist : [],
        createdAt: now,
        updatedAt: now,
        movedAt: now,
        startedAt: null,
        completedAt: null,
        flow: { state: 'normal', reason: '', since: null, periods: [] },
        dependencies: { blockers: [], related: [] },
        recurrenceId: null,
        transitions: []
      };
      if (item.url) {
        card.description = (card.description ? card.description + '\n\n' : '') + 'Source: ' + item.url;
      }
      column.cards.push(card);
      return { changed: true, state: next, value: { item: item, card: card } };
    }

    function mergeIntoCard(state, inboxId, target, deps) {
      var d = resolveDeps(deps);
      var next = cloneState(state);
      var items = next.inbox && Array.isArray(next.inbox.items) ? next.inbox.items : [];
      var index = items.findIndex(function (it) { return it.id === inboxId; });
      if (index === -1) return noop(state, 'item-not-found');
      var item = items[index];
      var board = next.boards.find(function (b) { return b.id === target.boardId; });
      if (!board) return noop(state, 'board-not-found');
      var card = null;
      board.columns.forEach(function (column) {
        if (card) return;
        card = column.cards.find(function (c) { return c.id === target.cardId; }) || null;
      });
      if (!card) return noop(state, 'card-not-found');
      var parts = [];
      if (item.note) parts.push(item.note);
      if (item.url) parts.push('Source: ' + item.url);
      var note = parts.join('\n');
      if (note) {
        card.description = card.description
          ? card.description + '\n\n---\n' + item.title + '\n' + note
          : item.title + '\n' + note;
      } else if (item.title && item.title !== card.title) {
        card.description = card.description
          ? card.description + '\n\n---\n' + item.title
          : item.title;
      }
      card.updatedAt = d.now();
      items.splice(index, 1);
      return { changed: true, state: next, value: card };
    }

    function inboxSummary(state, now) {
      var items = state && state.inbox && Array.isArray(state.inbox.items) ? state.inbox.items : [];
      var oldest = null;
      items.forEach(function (item) {
        if (item.capturedAt !== null && typeof item.capturedAt === 'number' && (oldest === null || item.capturedAt < oldest)) {
          oldest = item.capturedAt;
        }
      });
      var oldestDays = null;
      if (oldest !== null && typeof now === 'number') {
        oldestDays = Math.max(0, Math.floor((now - oldest) / 86400000));
      }
      return { count: items.length, oldestAt: oldest, oldestDays: oldestDays };
    }

    return {
      parseUrl: parseUrl,
      captureItem: captureItem,
      captureLines: captureLines,
      updateInboxItem: updateInboxItem,
      deleteInboxItem: deleteInboxItem,
      triageInboxItem: triageInboxItem,
      mergeIntoCard: mergeIntoCard,
      inboxSummary: inboxSummary
    };
  }
);
