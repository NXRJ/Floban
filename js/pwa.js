(function (KB) {
  // PWA layer: service-worker registration with a graceful update flow, the
  // install prompt surfaced as a registry command, and offline readiness.
  //
  // The service worker only registers over http(s); opening the app from
  // file:// keeps working exactly as before, just without offline caching.

  var deferredPrompt = null;
  var reloadingForUpdate = false;

  function canInstall() {
    return deferredPrompt !== null;
  }

  function install() {
    if (!deferredPrompt) return false;
    deferredPrompt.prompt();
    deferredPrompt = null;
    return true;
  }

  function requestUpdateReload() {
    reloadingForUpdate = true;
    navigator.serviceWorker.getRegistration().then(function (registration) {
      if (registration && registration.waiting) {
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      } else {
        // Nothing waiting — fall back to a plain reload.
        reloadingForUpdate = false;
        window.location.reload();
      }
    });
  }

  function injectPwaLinks() {
    // Manifest and home-screen icons only make sense over http(s); on file://
    // the browser would log CORS errors for them.
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
    var head = document.head;
    if (!head.querySelector('link[rel="manifest"]')) {
      var manifest = document.createElement('link');
      manifest.rel = 'manifest';
      manifest.href = 'manifest.webmanifest';
      head.appendChild(manifest);
    }
    if (!head.querySelector('link[rel="apple-touch-icon"]')) {
      var apple = document.createElement('link');
      apple.rel = 'apple-touch-icon';
      apple.href = 'icons/apple-touch-icon.png';
      head.appendChild(apple);
    }
  }

  function register() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
    injectPwaLinks();

    navigator.serviceWorker.register('sw.js').then(function (registration) {
      registration.addEventListener('updatefound', function () {
        var next = registration.installing;
        if (!next) return;
        next.addEventListener('statechange', function () {
          if (next.state === 'installed' && navigator.serviceWorker.controller) {
            KB.UI.toast('Update ready', 'info', 'Reload', requestUpdateReload);
          }
        });
      });
    }).catch(function (err) {
      console.warn('Service worker registration failed', err);
    });

    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (reloadingForUpdate) {
        reloadingForUpdate = false;
        window.location.reload();
      }
    });
  }

  window.addEventListener('beforeinstallprompt', function (event) {
    // Defer the prompt; the "Install app" command becomes available.
    event.preventDefault();
    deferredPrompt = event;
  });

  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    KB.UI.toast('App installed', 'success');
  });

  KB.PWA = {
    init: register,
    canInstall: canInstall,
    install: install
  };
})(window.KB = window.KB || {});
