(function () {
  var root = document.documentElement;
  var SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  var MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';

  function current() { return root.getAttribute("data-theme") === "light" ? "light" : "dark"; }

  function apply(theme, btn) {
    root.setAttribute("data-theme", theme);
    try { localStorage.setItem("theme", theme); } catch (e) {}
    if (btn) {
      btn.innerHTML = theme === "dark" ? SUN : MOON;
      btn.setAttribute("aria-label", theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
    }
  }

  var nav = document.querySelector(".nav-links");
  if (!nav) return;
  var btn = document.createElement("button");
  btn.className = "theme-toggle";
  btn.type = "button";
  nav.appendChild(btn);
  apply(current(), btn);
  btn.addEventListener("click", function () { apply(current() === "dark" ? "light" : "dark", btn); });
})();
