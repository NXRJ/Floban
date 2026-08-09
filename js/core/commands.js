(function (root, factory) {
  var api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.KB = root.KB || {};
    root.KB.Core = root.KB.Core || {};
    root.KB.Core.Commands = api;
  }
})(
  typeof globalThis !== 'undefined' ? globalThis : this,
  function () {
    // Shared command registry.
    //
    // One command definition powers every surface: the Cmd/Ctrl+K palette,
    // the keyboard-shortcut dispatcher, the app menu, and the mobile action
    // sheets. UI code never hard-codes an action list twice; it asks the
    // registry for the commands that are available in a context.
    //
    // Command shape:
    //   {
    //     id: 'unique.id',
    //     title: 'Human title',
    //     keywords: ['alt', 'search terms'],
    //     category: 'Workspace' | 'Board' | 'Column' | 'Card' | 'Edit' | 'View' | 'App',
    //     shortcut: 'mod+k' | 'n' | null,
    //     icon: 'pixel icon name' | null,
    //     scope: 'global' | 'card' | 'column' | 'archive-card',
    //     available(ctx): boolean   — ctx = { boardId, columnId, cardId, archived } | null
    //     run(ctx): void            — may open modals, mutate state, and must
    //                                 refresh the UI itself (KB.App.refresh()).
    //   }
    //
    // Shortcut syntax: lowercase key, 'mod' for Ctrl/Cmd, plus optional
    // 'shift'/'alt', joined with '+' (e.g. 'mod+shift+z').

    var VALID_CATEGORIES = ['Workspace', 'Board', 'Column', 'Card', 'Edit', 'View', 'App'];
    var VALID_SCOPES = ['global', 'card', 'column', 'archive-card'];

    function normalizeShortcut(shortcut) {
      if (!shortcut) return null;
      var parts = String(shortcut).toLowerCase().split('+').map(function (part) {
        return part.trim();
      }).filter(Boolean);
      var mods = [];
      var key = '';
      parts.forEach(function (part) {
        if (part === 'mod') mods.push('mod');
        else if (part === 'ctrl' || part === 'cmd' || part === 'meta') mods.push('mod');
        else if (part === 'shift') mods.push('shift');
        else if (part === 'alt' || part === 'option') mods.push('alt');
        else key = part;
      });
      if (!key) return null;
      return mods.concat([key]).sort(function (a, b) {
        var order = { mod: 0, shift: 1, alt: 2 };
        return (order[a] !== undefined ? order[a] : 3) - (order[b] !== undefined ? order[b] : 3);
      }).join('+');
    }

    function createRegistry() {
      var commands = [];
      var byId = {};

      function register(command) {
        if (!command || typeof command.id !== 'string' || !command.id) {
          throw new Error('command registry: every command needs an id');
        }
        if (typeof command.run !== 'function') {
          throw new Error('command registry: command "' + command.id + '" needs a run() function');
        }
        if (command.category && VALID_CATEGORIES.indexOf(command.category) === -1) {
          throw new Error('command registry: unknown category "' + command.category + '"');
        }
        if (command.scope && VALID_SCOPES.indexOf(command.scope) === -1) {
          throw new Error('command registry: unknown scope "' + command.scope + '"');
        }
        var normalized = {
          id: command.id,
          title: typeof command.title === 'string' ? command.title : command.id,
          keywords: Array.isArray(command.keywords) ? command.keywords : [],
          category: command.category || 'App',
          shortcut: normalizeShortcut(command.shortcut),
          icon: command.icon || null,
          scope: command.scope || 'global',
          hidden: Boolean(command.hidden),
          available: typeof command.available === 'function' ? command.available : function () { return true; },
          run: command.run,
          order: typeof command.order === 'number' ? command.order : 0
        };
        if (byId[normalized.id]) unregister(normalized.id);
        commands.push(normalized);
        byId[normalized.id] = normalized;
        return normalized;
      }

      function unregister(id) {
        var index = -1;
        for (var i = 0; i < commands.length; i++) {
          if (commands[i].id === id) { index = i; break; }
        }
        if (index !== -1) commands.splice(index, 1);
        delete byId[id];
      }

      function get(id) {
        return byId[id] || null;
      }

      function all() {
        return commands.slice();
      }

      function list() {
        return commands.filter(function (command) { return !command.hidden; }).sort(function (a, b) {
          if (a.category !== b.category) return a.category.localeCompare(b.category);
          if (a.order !== b.order) return a.order - b.order;
          return a.title.localeCompare(b.title);
        });
      }

      function search(query) {
        var q = String(query || '').trim().toLowerCase();
        if (!q) return list();
        return list().filter(function (command) {
          if (command.title.toLowerCase().indexOf(q) !== -1) return true;
          return command.keywords.some(function (keyword) {
            return String(keyword).toLowerCase().indexOf(q) !== -1;
          });
        });
      }

      function findByShortcut(shortcut) {
        var normalized = normalizeShortcut(shortcut);
        if (!normalized) return null;
        for (var i = 0; i < commands.length; i++) {
          if (commands[i].shortcut === normalized) return commands[i];
        }
        return null;
      }

      function isAvailable(command, ctx) {
        try {
          return command.available(ctx || null) !== false;
        } catch (err) {
          return false;
        }
      }

      function availableIn(ctx) {
        return list().filter(function (command) {
          return isAvailable(command, ctx);
        });
      }

      function run(id, ctx) {
        var command = byId[id];
        if (!command) return { ok: false, reason: 'not-found' };
        if (!isAvailable(command, ctx)) return { ok: false, reason: 'unavailable' };
        try {
          command.run(ctx || null);
          return { ok: true };
        } catch (err) {
          console.warn('command failed: ' + id, err);
          return { ok: false, reason: 'error' };
        }
      }

      return {
        register: register,
        unregister: unregister,
        get: get,
        all: all,
        list: list,
        search: search,
        findByShortcut: findByShortcut,
        availableIn: availableIn,
        run: run,
        normalizeShortcut: normalizeShortcut
      };
    }

    return {
      createRegistry: createRegistry,
      normalizeShortcut: normalizeShortcut
    };
  }
);
