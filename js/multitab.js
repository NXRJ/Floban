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
  // The write boundary is AUTHORITATIVE, not a cached flag: canWrite()
  // re-checks the live claim synchronously before any persistence, so a
  // suspended former owner that has not yet run its demotion check cannot
  // write stale state or overwrite the new owner's claim. localStorage
  // 'storage' events, BroadcastChannel messages, visibility changes and the
  // closing tab's pagehide all push demotion/promotion immediately; the
  // stale-claim timer (STALE_MS) remains only as the crash fallback.
  // Everything degrades to a harmless no-op when storage or the channel is
  // unavailable (file://).

  var OWNER_KEY = 'kanban.owner.v1';
  // Long enough that a briefly hidden owner is not evicted (browsers throttle
  // hidden-tab timers), short enough that a dead owner's lock is retaken
  // promptly. The claim is also refreshed the moment the tab hides, so the
  // window measures real idle time, not throttled timer drift. Graceful
  // handovers (pagehide, owner-left broadcast) release the lease instantly,
  // so this window only matters for crashes.
  var STALE_MS = 15000;
  var BEAT_MS = 1200;
  var CHECK_MS = 1000;

  var tabId = null;
  var readOnly = false;
  var banner = null;
  var channel = null;
  // A takeover reload must NOT release the lease on pagehide: this tab
  // claims the lock and reloads to re-claim it on boot, and releasing in
  // between lets a bystander tab win the freed lease and boot this one
  // read-only (an infinite handoff churn on slow machines).
  var relocating = false;

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

  // The lease belongs to THIS tab, right now.
  function ownsLease() {
    var claim = readClaim();
    return claimIsFresh(claim) && claim.id === tabId;
  }

  // Authoritative write gate. Every persistence path must call this: a
  // cached readOnly flag can be stale for up to a beat after a handover.
  function canWrite() {
    if (readOnly || !ownsLease()) {
      setReadOnly(true);
      return false;
    }
    return true;
  }

  function broadcastTakeover() {
    if (channel) {
      // A channel closed by a torn-down page throws on postMessage; the
      // claim in localStorage is the authoritative takeover either way.
      try { channel.postMessage({ type: 'takeover', id: tabId }); } catch (err) {}
    }
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
        // state here starts from the owner's latest writes. The short settle
        // delay lets the owner process the demotion message BEFORE we reload:
        // a queued owner heartbeat re-asserting its claim in between could
        // otherwise make this tab boot read-only too (both tabs waiting out
        // the lease). The stale window covers the residual race either way.
        writeClaim();
        broadcastTakeover();
        relocating = true;
        setTimeout(function () { location.reload(); }, 250);
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

  // Take the lease and reload fresh state (never save the stale in-memory
  // state over the owner's last writes).
  function takeOver() {
    relocating = true;
    writeClaim();
    broadcastTakeover();
    setReadOnly(false);
    location.reload();
  }

  function onMessage(e) {
    var data = e.data || {};
    if (!data || data.id === tabId) return;
    if (data.type === 'takeover') {
      // Another tab is taking over: demote without touching the claim.
      setReadOnly(true);
    } else if (data.type === 'owner-left' && readOnly) {
      // The owner closed cleanly — take over immediately instead of waiting
      // out the stale window.
      takeOver();
    }
  }

  function check() {
    if (readOnly) {
      var claim = readClaim();
      if (!claimIsFresh(claim)) {
        // The owner left or crashed (no owner-left message arrived). Take
        // the lock and reload so the in-memory state is never stale relative
        // to the owner's last writes.
        takeOver();
      }
      return;
    }
    // Not read-only: verify the lease still belongs to us. A handover that
    // bypassed the storage/broadcast listeners (rare) demotes here.
    if (!ownsLease()) setReadOnly(true);
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
      // Renew only while the lease is genuinely ours; a suspended former
      // owner must never overwrite the new owner's claim.
      if (ownsLease()) writeClaim();
      else if (!readOnly) setReadOnly(true);
    }, BEAT_MS);
    setInterval(check, CHECK_MS);
    // Storage events fire in every OTHER tab when the claim changes — the
    // instant handover signal when a tab takes over, releases, or dies.
    window.addEventListener('storage', function (e) {
      if (e.key !== OWNER_KEY || e.storageArea !== localStorage) return;
      var latest = readClaim();
      if (readOnly && !claimIsFresh(latest)) {
        // Owner released or crashed — take over now.
        takeOver();
      } else if (!readOnly && claimIsFresh(latest) && latest.id !== tabId) {
        // The lease moved to another tab — demote immediately.
        setReadOnly(true);
      }
    });
    // Visibility: becoming visible re-checks ownership BEFORE the app's
    // visibility handler processes recurrences (which can save state), and
    // becoming hidden refreshes the claim once so throttled timers do not
    // expire a live owner's lease.
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') {
        if (ownsLease()) writeClaim();
        else setReadOnly(true);
      } else if (ownsLease()) {
        writeClaim();
      }
    });
    // Graceful close: release the lease (unless the page enters the
    // back-forward cache and may resume) and tell surviving tabs instantly.
    // A takeover reload keeps the claim: it re-claims on boot, and releasing
    // mid-flight would let another read-only tab take over instead.
    window.addEventListener('pagehide', function (e) {
      if (e && e.persisted) return;
      if (relocating) return;
      if (ownsLease()) {
        try { localStorage.removeItem(OWNER_KEY); } catch (err) {}
        if (channel) {
          try { channel.postMessage({ type: 'owner-left', id: tabId }); } catch (err) {}
        }
      }
    });
  }

  KB.MultiTab = {
    init: init,
    readOnly: function () { return readOnly; },
    ownsLease: ownsLease,
    canWrite: canWrite
  };
})(window.KB = window.KB || {});
