import { SITE_CONFIG } from "./config.js";

const icons = {
  sun: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.41M17.66 6.34l1.41-1.41"/></svg>`,
  moon: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 15.4A8.7 8.7 0 0 1 8.6 3.5 8.7 8.7 0 1 0 20.5 15.4Z"/></svg>`,
  system: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>`,
  menu: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>`,
  close: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>`,
  arrow: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`
};

const navItems = [
  ["Services", "/services.html"],
  ["Work", "/portfolio.html"],
  ["About", "/about.html"]
];

function currentFile() {
  const pathname = window.__THREEDP_TEST_PATH || location.pathname;
  const value = pathname.split("/").pop();
  return value || "index.html";
}

function navMarkup(className = "nav-links") {
  const current = currentFile();
  return `<nav class="${className}" aria-label="Primary">${navItems.map(([label, href]) => {
    const active = href.endsWith(current) ? ` aria-current="page"` : "";
    return `<a class="nav-link" href="${href}"${active}>${label}</a>`;
  }).join("")}</nav>`;
}

function headerMarkup() {
  return `<a class="skip-link" href="#main">Skip to content</a>
  <header class="site-header">
    <div class="container nav-shell">
      <a class="brand" href="/" aria-label="3dprint4.me home">
        <img class="brand-mark" src="/assets/icons/mark.svg" alt="" width="42" height="42">
        <span class="brand-word">3dprint4<span>.me</span></span>
      </a>
      ${navMarkup()}
      <div class="nav-actions">
        <button class="icon-button" id="theme-toggle" type="button" aria-label="Theme: system" title="Change theme">${icons.system}</button>
        <a class="button primary small-button" href="/order.html">Start a project</a>
        <button class="icon-button menu-button" id="menu-toggle" type="button" aria-expanded="false" aria-controls="mobile-panel" aria-label="Open menu">${icons.menu}</button>
      </div>
    </div>
    <nav class="mobile-panel" id="mobile-panel" aria-label="Mobile navigation">
      ${navItems.map(([label, href]) => `<a class="nav-link" href="${href}">${label}</a>`).join("")}
      <a class="button primary block" href="/order.html">Start a project ${icons.arrow}</a>
    </nav>
  </header>`;
}

function footerMarkup() {
  return `<footer class="site-footer">
    <div class="container footer-grid">
      <div class="footer-brand">
        <a class="brand" href="/" aria-label="3dprint4.me home">
          <img class="brand-mark" src="/assets/icons/mark.svg" alt="" width="42" height="42">
          <span class="brand-word">3dprint4<span>.me</span></span>
        </a>
        <p>Useful things, thoughtfully designed and made in Tulsa.</p>
        <a href="mailto:${SITE_CONFIG.email}">${SITE_CONFIG.email}</a>
      </div>
      <div><h2>Services</h2><a href="/order.html?service=design">3D modeling</a><a href="/order.html?service=print">3D printing</a><a href="/order.html?service=repair">Repair & tuning</a><a href="/order.html?service=consult">Consulting</a></div>
      <div><h2>Explore</h2><a href="/portfolio.html">Selected work</a><a href="/services.html">Pricing approach</a><a href="/about.html">About Jerrett</a><a href="/order.html">Start a project</a></div>
      <div><h2>Elsewhere</h2><a href="${SITE_CONFIG.profiles.printables}" target="_blank" rel="noopener">Printables</a><a href="${SITE_CONFIG.profiles.cults}" target="_blank" rel="noopener">Cults3D</a><a href="${SITE_CONFIG.profiles.thingiverse}" target="_blank" rel="noopener">Thingiverse</a></div>
    </div>
    <div class="container footer-base"><span>© <span id="year"></span> ${SITE_CONFIG.owner}</span><span><a href="/privacy.html">Privacy</a><a href="/terms.html">Terms</a></span></div>
  </footer>
  <div class="toast-region" id="toast-region" role="status" aria-live="polite" aria-atomic="false"></div>`;
}

const themeIcons = { system: "system", light: "sun", dark: "moon" };

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.dataset.theme = theme;
  const toggle = document.querySelector("#theme-toggle");
  if (toggle) {
    toggle.innerHTML = icons[themeIcons[theme]];
    toggle.setAttribute("aria-label", `Theme: ${theme}`);
    toggle.title = `Theme: ${theme}. Click to change.`;
  }
}

function initTheme() {
  const modes = ["system", "light", "dark"];
  let saved = null;
  try { saved = localStorage.getItem("3dp-theme"); } catch { /* Use the system theme when storage is unavailable. */ }
  let theme = modes.includes(saved) ? saved : "system";
  applyTheme(theme);
  document.querySelector("#theme-toggle")?.addEventListener("click", () => {
    theme = modes[(modes.indexOf(theme) + 1) % modes.length];
    try { localStorage.setItem("3dp-theme", theme); } catch { /* Keep the choice for this visit. */ }
    applyTheme(theme);
    toast(`Theme set to ${theme}.`);
  });
}

function initMenu() {
  const button = document.querySelector("#menu-toggle");
  const panel = document.querySelector("#mobile-panel");
  if (!button || !panel) return;
  const close = (restoreFocus = false) => {
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-label", "Open menu");
    button.innerHTML = icons.menu;
    panel.classList.remove("open");
    if (restoreFocus) button.focus();
  };
  button.addEventListener("click", () => {
    const open = button.getAttribute("aria-expanded") === "true";
    if (open) close();
    else {
      button.setAttribute("aria-expanded", "true");
      button.setAttribute("aria-label", "Close menu");
      button.innerHTML = icons.close;
      panel.classList.add("open");
      panel.querySelector("a")?.focus();
    }
  });
  panel.addEventListener("click", event => { if (event.target.closest("a")) close(); });
  document.addEventListener("keydown", event => { if (event.key === "Escape" && panel.classList.contains("open")) close(true); });
  addEventListener("resize", () => { if (innerWidth > 760) close(); });
}

function initDisclosure() {
  document.querySelectorAll("details").forEach(item => {
    item.addEventListener("toggle", () => {
      if (!item.open || !item.parentElement?.classList.contains("accordion")) return;
      [...item.parentElement.children].forEach(sibling => { if (sibling !== item && sibling.tagName === "DETAILS") sibling.open = false; });
    });
  });
}

export function toast(message, duration = 4200) {
  const region = document.querySelector("#toast-region");
  if (!region) return;
  const item = document.createElement("div");
  item.className = "toast";
  item.textContent = message;
  region.append(item);
  setTimeout(() => item.remove(), duration);
}

function bootstrap() {
  document.querySelector("#site-header")?.replaceChildren(document.createRange().createContextualFragment(headerMarkup()));
  document.querySelector("#site-footer")?.replaceChildren(document.createRange().createContextualFragment(footerMarkup()));
  const year = document.querySelector("#year");
  if (year) year.textContent = String(new Date().getFullYear());
  initTheme();
  initMenu();
  initDisclosure();
  document.querySelectorAll("a[target='_blank']").forEach(link => {
    if (!link.rel.split(/\s+/).includes("noopener")) link.rel = `${link.rel} noopener`.trim();
  });
}

bootstrap();
window.threeDpToast = toast;
