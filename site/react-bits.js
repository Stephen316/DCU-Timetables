/* kit-design: adapted from React Bits SpotlightCard.
 * Copyright (c) 2026 David Haz. MIT + Commons Clause; see vendor/react-bits/.
 * Static DOM adapters retain the existing HTML, links and deployment pipeline.
 */
(function () {
  'use strict';

  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var desktopPointer = window.matchMedia('(hover: hover) and (pointer: fine) and (min-width: 761px)');
  // SpotlightCard's soft radial falloff, with the existing accent token.
  // Only its circle fill is needed: no ambient loop, grain, flare or new surface.
  function falloff(color, softness) {
    var core = Math.pow(1 - softness, 1.5) * .85;
    function stop(alpha, at) {
      return 'color-mix(in srgb, ' + color + ' ' + (alpha * 100).toFixed(2) + '%, transparent) ' + (at * 100).toFixed(2) + '%';
    }
    var stops = [stop(1, 0)];
    for (var i = 0; i <= 14; i++) {
      var t = core + ((1 - core) * i) / 14;
      var g = (t - core) / (1 - core);
      var smooth = 1 - g * g * (3 - 2 * g);
      var glow = Math.exp(-4.6 * g * g) * (1 - Math.pow(g, 6));
      stops.push(stop(smooth + (glow - smooth) * softness, t));
    }
    return stops.join(', ');
  }

  var cards = Array.from(document.querySelectorAll('[data-spotlight-card]'));
  var clearSpotlights = function () {};
  function syncSpotlights() {
    clearSpotlights();
    if (reducedMotion.matches || !desktopPointer.matches) return;
    var cleanups = cards.map(function (card) {
      var frame = 0;
      var pointerX = 0;
      var pointerY = 0;
      card.style.setProperty('--rb-falloff', falloff('var(--accent)', .7));
      function move(event) {
        if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
        pointerX = event.clientX;
        pointerY = event.clientY;
        if (frame) return;
        frame = window.requestAnimationFrame(function () {
          frame = 0;
          var rect = card.getBoundingClientRect();
          card.style.setProperty('--rb-x', (pointerX - rect.left) + 'px');
          card.style.setProperty('--rb-y', (pointerY - rect.top) + 'px');
          card.setAttribute('data-spotlight-active', '');
        });
      }
      function leave() {
        window.cancelAnimationFrame(frame);
        frame = 0;
        card.removeAttribute('data-spotlight-active');
      }
      card.addEventListener('pointermove', move);
      card.addEventListener('pointerleave', leave);
      card.addEventListener('pointercancel', leave);
      return function () {
        leave();
        card.removeEventListener('pointermove', move);
        card.removeEventListener('pointerleave', leave);
        card.removeEventListener('pointercancel', leave);
      };
    });
    clearSpotlights = function () { cleanups.forEach(function (cleanup) { cleanup(); }); };
  }

  reducedMotion.addEventListener('change', function () {
    syncSpotlights();
  });
  desktopPointer.addEventListener('change', syncSpotlights);
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      clearSpotlights();
    } else {
      syncSpotlights();
    }
  });
  syncSpotlights();
})();
