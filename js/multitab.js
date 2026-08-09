(function (KB) {
  // Cross-tab guard. Two tabs editing the same board would silently
  // overwrite each other (last-writer-wins on the full state — see
  // docs/SYNC.md), so only ONE tab may write at a time:
  //
  //   - The first tab to claim the localStorage lock is the editor; it
  //     refreshes the claim on a heartbeat.
  //   - Any later tab runs read-only: mutations stay in memory but nothing
  //     persists, and a banner offers "Take over".
  //   - Takeover (or the owner closing) reloads the surviving tab from
  //     storage, so it never saves a stale in-memory state over the owner's
  //     latest writes.
  //
  // The tab id lives in sessionStorage so a RELOAD keeps the same identity:
  // otherwise every page load inside the stale window would demote itself,
  // wait for the claim to expire, and reload again — a reload loop.
  //
  // BroadcastChannel makes takeover/leave instant; the stale-claim timer
  // covers the owner closing without notice. Everything degrades to a
  // harmless no-op when storage or the channel is unavailable (file://).

  var OWNER_KEY = 'kanban.owner.v1';
  var STALE_MS = 3000;
  var BEAT_MS = 1200;
  var CHECK_MS = 1000;

  var tabId = null;
  var readOnly = false;
  var banner = null;
  var channel = null;

  function generateId() {
    return 'tab-' + Math.random().toString(36).slice(2, 10);
  }

  function loadTabId() {
    try {
      var existing = sessionStorage.getItem('kanban.tabId');
      if (existing) return existing;
      var id = generateId();
      sessionStorage.setItem('kanban.tabId', id);
      return id;
    } catch (err) {
      // sessionStorage unavailable — a fresh identity per load.
      return generateId();
    }
  }

  function now() {
    return Date.now();
  }

  function readClaim() {
    try {
      var raw = localStorage.getItem(OWNER_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return { id: parsed.id, ts: Number(parsed.ts) || 0 };
    } catch (err) {
      return null;
    }
  }

  function writeClaim() {
    try {
      localStorage.setItem(OWNER_KEY, JSON.stringify({ id: tabId, ts: now() }));
      return true;
    } catch (err) {
      return false;
    }
  }

  function claimIsFresh(claim) {
    return Boolean(claim && now() - claim.ts < STALE_MS);
  }

  function renderBanner() {
    if (readOnly) {
      if (banner) return;
      banner = document.createElement('div');
      banner.className = 'multitab-banner';
      banner.setAttribute('role', 'status');
      var msg = document.createElement('span');
      msg.className = 'multitab-msg';
      msg.textContent = 'Kanban is already open in another tab — this tab is read-only.';
      var take = document.createElement('button');
      take.type = 'button';
      take.className = 'btn sm mt-takeover';
      take.textContent = 'Take over';
      take.addEventListener('click', function () {
        // Claim the lock, tell the other tab to demote, then reload so the
        // state here starts from the owner's latest writes.
        writeClaim();
        if (channel) {
          try { channel.postMessage({ type: 'takeover', id: tabId }); } catch (err) {}
        }
        location.reload();
      });
      banner.appendChild(msg);
      banner.appendChild(take);
      var header = document.querySelector('.app-header');
      if (header && header.parentNode) header.parentNode.insertBefore(banner, header.nextSibling);
      else document.body.insertBefore(banner, document.body.firstChild);
      return;
    }
    if (banner) {
      banner.remove();
      banner = null;
    }
  }

  function setReadOnly(value) {
    if (readOnly === value) return;
    readOnly = value;
    renderBanner();
  }

  function onMessage(e) {
    var data = e.data || {};
    if (!data || data.id === tabId) return;
    if (data.type === 'takeover') {
      // Another tab is taking over: demote without touching the claim.
      setReadOnly(true);
    }
  }

  function check() {
    var claim = readClaim();
    if (readOnly) {
      if (!claimIsFresh(claim)) {
        // The owner left or crashed. Take the lock and reload so the
        // in-memory state is never stale relative to the owner's last writes.
        writeClaim();
        setReadOnly(false);
        location.reload();
      }
      return;
    }
    if (claimIsFresh(claim) && claim.id !== tabId) {
      // Someone else took over while we were idle.
      setReadOnly(true);
    }
  }

  function init() {
    tabId = loadTabId();
    var claim = readClaim();
    if (claimIsFresh(claim) && claim.id !== tabId) {
      setReadOnly(true);
    } else {
      writeClaim();
    }
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        channel = new BroadcastChannel('kanban-multitab');
        channel.addEventListener('message', onMessage);
      } catch (err) {
        channel = null;
      }
    }
    setInterval(function () {
      if (!readOnly) writeClaim();
    }, BEAT_MS);
    setInterval(check, CHECK_MS);
  }

  KB.MultiTab = {
    init: init,
    readOnly: function () { return readOnly; }
  };
})(window.KB = window.KB || {});
