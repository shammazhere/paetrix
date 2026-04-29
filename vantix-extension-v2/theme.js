// ── Theme bootstrap (runs immediately on <script> parse, before DOM ready) ──
// Apply saved theme immediately to avoid flash of unstyled content.
// Priority: chrome.storage.local → localStorage fallback → default "light"
(function initTheme() {
  // Synchronous fallback for immediate render (avoids FOUC)
  const lsFallback = localStorage.getItem("theme") || "light";
  window._vantixAppliedTheme = lsFallback;
  applyThemeClass(lsFallback);

  // Async: read from chrome.storage.local (authoritative for extensions)
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get({ theme: lsFallback }, function (res) {
      const saved = res.theme || "light";
      window._vantixAppliedTheme = saved;
      applyThemeClass(saved);
      syncToggleUI(saved);
    });
  }
})();

/** Apply theme-light / theme-dark class to <html> and record state. */
function applyThemeClass(theme) {
  const root = document.documentElement;
  root.classList.remove("theme-light", "theme-dark");
  root.classList.add("theme-" + theme);
  window._vantixAppliedTheme = theme;
}

/** Sync the visual state of the toggle thumb in the header. */
function syncToggleUI(theme) {
  const thumb = document.querySelector(".toggle-thumb");
  if (!thumb) return;
  if (theme === "dark") {
    thumb.style.transform = "translateX(22px)";
  } else {
    thumb.style.transform = "translateX(0px)";
  }
}

/** Public: toggle between light and dark, persist to chrome.storage.local. */
window.toggleTheme = function () {
  const current = window._vantixAppliedTheme || "light";
  const next = current === "light" ? "dark" : "light";

  applyThemeClass(next);
  syncToggleUI(next);

  // Persist — chrome.storage.local preferred, localStorage as fallback
  localStorage.setItem("theme", next);
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    chrome.storage.local.set({ theme: next });
  }
};
