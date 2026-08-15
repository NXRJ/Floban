/* Kanban service worker — offline app shell.
 *
 * Strategy:
 *  - PRECACHE every local asset on install (the app has no CDN dependencies;
 *    fonts and icons are local files).
 *  - App shell (navigation) requests: network-first with cache fallback, so
 *    deployed updates reach the next load while offline still works.
 *  - Static assets: cache-first.
 *  - Update flow: a new service worker installs and WAITS. It only takes
 *    over after the page posts SKIP_WAITING (the update toast's Reload
 *    button), then the page reloads on controllerchange. The first install
 *    activates immediately because no older worker controls the page yet.
 *
 * Bump CACHE when the asset list changes.
 */
'use strict';

// The cache key keeps its original prefix on purpose: the activate handler
// prunes by `kanban-`, so renaming it to match the Floban branding would
// strand every previously installed cache on existing devices. It is an
// internal key and never shown to anyone.
var CACHE = 'kanban-v9';

var PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './css/worlds.css',
  './js/themes.js',
  './js/motion.js',
  './js/worlds-picker.js',
  './fonts/fonts.css',
  './fonts/press-start-2p-27.woff2',
  './fonts/press-start-2p-28.woff2',
  './fonts/press-start-2p-29.woff2',
  './fonts/press-start-2p-30.woff2',
  './fonts/press-start-2p-31.woff2',
  './fonts/vt323-51.woff2',
  './fonts/vt323-52.woff2',
  './fonts/vt323-53.woff2',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './js/boot-theme.js',
  './js/core/date.js',
  './js/core/when.js',
  './js/core/nlparse.js',
  './js/core/calendar.js',
  './js/core/dayplan.js',
  './js/core/focus.js',
  './js/core/worklog.js',
  './js/core/streak.js',
  './js/core/model.js',
  './js/core/statediff.js',
  './js/core/ydoc.js',
  './js/core/migration.js',
  './js/core/lifecycle.js',
  './js/core/relations.js',
  './js/core/policies.js',
  './js/core/metrics.js',
  './js/core/calibrate.js',
  './js/core/weekly.js',
  './js/core/template.js',
  './js/core/ping.js',
  './js/core/pipeline.js',
  './js/core/importer.js',
  './js/core/exporter.js',
  './js/core/recurrence.js',
  './js/core/inbox.js',
  './js/core/filtering.js',
  './js/core/lenses.js',
  './js/core/bulk.js',
  './js/core/history.js',
  './js/core/operations.js',
  './js/core/markdown.js',
  './js/core/store.js',
  './js/core/commands.js',
  './js/dom.js',
  './js/sync.js',
  // vendor/yjs.js is deliberately NOT precached: it is fetched on demand when
  // sync is switched on, and the cache-first handler below keeps it from then
  // on — so an offline board with sync off never downloads 93KB it cannot use.
  './js/sync-provider.js',
  './js/sync-docs.js',
  './js/sync-session.js',
  './js/multitab.js',
  './js/state.js',
  './js/storage.js',
  './js/state-cards.js',
  './js/state-features.js',
  './js/filters.js',
  './js/dragdrop.js',
  './js/modals/core.js',
  './js/modals/card.js',
  './js/modals/column.js',
  './js/modals/recurrence.js',
  './js/modals/dialogs.js',
  './js/modals/triage.js',
  './js/modals/day.js',
  './js/modals/arrival.js',
  './js/modals/templates.js',
  './js/moveto.js',
  './js/selection.js',
  './js/workspaces.js',
  './js/render.js',
  './js/commands.js',
  './js/actionsheet.js',
  './js/palette.js',
  './js/scoreboard.js',
  './js/checkpoint.js',
  './js/pwa.js',
  './js/app.js'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(PRECACHE);
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (key) {
          // Only this app's caches: a shared origin may host other
          // applications whose caches must never be deleted.
          return key !== CACHE && key.indexOf('kanban-') === 0;
        }).map(function (key) { return caches.delete(key); })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;

  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // App shell: network-first so new deploys win; cache fallback offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then(function (response) {
        var copy = response.clone();
        caches.open(CACHE).then(function (cache) { cache.put(request, copy); });
        return response;
      }).catch(function () {
        return caches.match(request).then(function (cached) {
          return cached || caches.match('./index.html');
        });
      })
    );
    return;
  }

  // Static assets: cache-first, refresh the cache in the background.
  event.respondWith(
    caches.match(request).then(function (cached) {
      var network = fetch(request).then(function (response) {
        if (response && response.ok) {
          var copy = response.clone();
          caches.open(CACHE).then(function (cache) { cache.put(request, copy); });
        }
        return response;
      }).catch(function () {
        return cached;
      });
      return cached || network;
    })
  );
});
