(function () {
  var root = document.documentElement;
  var systemTheme = window.matchMedia('(prefers-color-scheme: light)');
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var storageKey = 'landing-theme';
  var preference;
  try { preference = localStorage.getItem(storageKey); } catch (_) {}
  if (preference !== 'light' && preference !== 'dark') preference = null;

  function currentTheme() {
    return preference || (systemTheme.matches ? 'light' : 'dark');
  }

  function applyTheme() {
    var theme = currentTheme();
    root.setAttribute('data-theme', theme);
    document.querySelectorAll('[data-theme-choice]').forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.dataset.themeChoice === theme));
    });
    document.querySelectorAll('.phone picture source').forEach(function (source) {
      source.media = theme === 'light' ? 'all' : 'not all';
    });
    // The logo's darker purple tile, for the dark page.
    document.querySelectorAll('.brand picture source').forEach(function (source) {
      source.media = theme === 'dark' ? 'all' : 'not all';
    });
  }

  // The phone screenshots for the theme not showing, so a switch doesn't wait on the network.
  // Only fetched once someone reaches for the switch, not for every visitor.
  var warmed = false;
  function warmOtherScreens() {
    if (warmed) return;
    warmed = true;
    var other = currentTheme() === 'light' ? 'dark' : 'light';
    document.querySelectorAll('.phone picture').forEach(function (picture) {
      var source = picture.querySelector('source');
      var img = picture.querySelector('img');
      var src = other === 'light' ? source && source.getAttribute('srcset') : img && img.getAttribute('src');
      if (src) new Image().src = src;
    });
  }

  // Resolves once the swapped screenshots have loaded, so the crossfade lands on the new
  // screens rather than popping them in after it. Never holds the switch longer than the cap.
  function screensReady() {
    return new Promise(function (resolve) {
      // A changed <source> re-picks the image a moment later, not straight away.
      setTimeout(function () {
        var pending = Array.prototype.filter.call(document.querySelectorAll('.phone img'), function (img) {
          return !img.complete;
        });
        if (!pending.length) return resolve();
        var left = pending.length;
        var done = function () { if (--left <= 0) resolve(); };
        pending.forEach(function (img) {
          img.addEventListener('load', done, { once: true });
          img.addEventListener('error', done, { once: true });
        });
        setTimeout(resolve, 600);
      }, 0);
    });
  }

  // Crossfade the whole page, screenshots included, instead of snapping. Browsers without view
  // transitions, a hidden tab, and anyone who asked for less motion get the instant switch.
  function switchTheme() {
    if (!document.startViewTransition || reduceMotion.matches || document.visibilityState !== 'visible') {
      applyTheme();
      return;
    }
    document.startViewTransition(function () {
      applyTheme();
      return screensReady();
    });
  }

  // Apply the saved preference before the stylesheet loads to avoid a theme flash.
  applyTheme();
  document.addEventListener('DOMContentLoaded', function () {
    applyTheme();
    document.querySelectorAll('[data-theme-choice]').forEach(function (button) {
      button.addEventListener('pointerenter', warmOtherScreens);
      button.addEventListener('focus', warmOtherScreens);
      button.addEventListener('click', function () {
        var next = button.dataset.themeChoice;
        var changed = next !== currentTheme();
        preference = next;
        try { localStorage.setItem(storageKey, preference); } catch (_) {}
        if (changed) switchTheme(); else applyTheme();
      });
    });
  });
  systemTheme.addEventListener('change', function () {
    if (!preference) switchTheme();
  });
})();
