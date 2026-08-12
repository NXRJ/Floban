/* The motion layer.
 *
 * One baseline choreography for the whole board; each world supplies its
 * character through --dur-* / --ease-* / --enter-shift, so the same
 * interaction steps in the Atelier and eases in the Quarry.
 *
 * The board is re-rendered wholesale (render.js empties .board and rebuilds
 * it), so "a card appeared in the DOM" is NOT the same as "a card is new".
 * Animating on insertion would fire on every keystroke in the search box.
 * This module tracks card ids across renders and animates only genuine
 * arrivals, and only after the first paint.
 *
 * Nothing here loops, and nothing runs on idle.
 */
(function () {
  var KB = window.KB;
  var seen = null; // null until the first render establishes a baseline
  var seenCounts = {};

  function reduced() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function once(el, cls) {
    el.classList.add(cls);
    el.addEventListener('animationend', function handler() {
      el.classList.remove(cls);
      el.removeEventListener('animationend', handler);
    });
  }

  /* --- arrivals: only cards whose id was not on the board last render ---
   *
   * A single interaction can render more than once, and each render rebuilds
   * the subtree — so marking the element is not enough: the next render
   * throws that element away and the id has already been recorded as seen.
   * Arrivals are therefore held as PENDING IDS and re-applied on every sweep
   * until the animation actually runs, which survives any number of rebuilds.
   */
  var pendingIn = Object.create(null);

  function sweepCards() {
    var cards = document.querySelectorAll('.board .card[data-id]');
    var now = Object.create(null);
    var i, id;
    for (i = 0; i < cards.length; i++) now[cards[i].getAttribute('data-id')] = true;

    // Baseline. This module starts at DOMContentLoaded, before the app has
    // rendered, so the board is still empty here — adopting THAT as the
    // baseline would make the first real render look like a board's worth of
    // arrivals and animate everything at once. Wait for the first render that
    // actually has cards, and treat that as the resting state.
    if (seen === null) {
      if (cards.length === 0) return;
      seen = now;
      return;
    }
    if (reduced()) { seen = now; return; }

    for (i = 0; i < cards.length; i++) {
      id = cards[i].getAttribute('data-id');
      if (!seen[id]) pendingIn[id] = true;
    }
    seen = now;

    for (i = 0; i < cards.length; i++) {
      id = cards[i].getAttribute('data-id');
      if (pendingIn[id] && !cards[i].classList.contains('card-in')) {
        markArrival(cards[i], id);
      }
    }
  }

  function markArrival(el, id) {
    el.classList.add('card-in');
    var released = false;
    function release() {
      if (released) return;
      released = true;
      el.classList.remove('card-in');
      el.removeEventListener('animationend', release);
      delete pendingIn[id];
    }
    el.addEventListener('animationend', release);
    // animationend is not guaranteed: a backgrounded tab never composites, and
    // a world may resolve the entrance to `animation: none`. Without this the
    // id would stay pending forever and re-animate on every later render.
    setTimeout(release, 1000);
  }

  /* --- the count badge ticks when its column's count actually changes --- */
  function sweepCounts() {
    if (reduced()) return;
    var badges = document.querySelectorAll('.column .col-count');
    for (var i = 0; i < badges.length; i++) {
      var col = badges[i].closest('.column');
      var key = col ? col.getAttribute('data-id') : String(i);
      var value = badges[i].textContent;
      if (seenCounts[key] !== undefined && seenCounts[key] !== value) {
        once(badges[i], 'count-tick');
      }
      seenCounts[key] = value;
    }
  }

  function sweep() {
    sweepCards();
    sweepCounts();
  }

  /* --- the theme switch: the one moment where all six worlds meet --- */
  function switchWorld(apply) {
    if (reduced() || !document.startViewTransition) { apply(); return; }
    document.startViewTransition(apply);
  }

  function start() {
    // The board element does not exist at DOMContentLoaded and render.js may
    // replace it, so observe a node that outlives every render rather than
    // the board itself. The sweep is debounced to one run per frame and only
    // queries, so watching a larger subtree costs nothing measurable.
    var pending = false;
    var obs = new MutationObserver(function () {
      if (pending) return;
      pending = true;
      requestAnimationFrame(function () { pending = false; sweep(); });
    });
    obs.observe(document.body, { childList: true, subtree: true });
    sweep();
  }

  KB.Motion = { start: start, switchWorld: switchWorld, sweep: sweep };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
