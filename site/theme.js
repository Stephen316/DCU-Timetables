(function () {
  var root = document.documentElement;
  var systemTheme = window.matchMedia('(prefers-color-scheme: light)');
  var storageKey = 'landing-theme';
  var preference;
  try { preference = localStorage.getItem(storageKey); } catch (_) {}
  if (preference !== 'light' && preference !== 'dark') preference = null;

  function applyTheme() {
    var theme = preference || (systemTheme.matches ? 'light' : 'dark');
    root.setAttribute('data-theme', theme);
    document.querySelectorAll('[data-theme-choice]').forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.dataset.themeChoice === theme));
    });
    document.querySelectorAll('.phone picture source').forEach(function (source) {
      source.media = theme === 'light' ? 'all' : 'not all';
    });
  }

  // Apply the saved preference before the stylesheet loads to avoid a theme flash.
  applyTheme();
  document.addEventListener('DOMContentLoaded', function () {
    applyTheme();
    document.querySelectorAll('[data-theme-choice]').forEach(function (button) {
      button.addEventListener('click', function () {
        preference = button.dataset.themeChoice;
        applyTheme();
        try { localStorage.setItem(storageKey, preference); } catch (_) {}
      });
    });
  });
  systemTheme.addEventListener('change', function () {
    if (!preference) applyTheme();
  });
})();
