// Home's pre-paint layout hint (lib/home/home-snapshot.ts writes it). Loaded as a file, not inline: Tauri's CSP allows an inline script only on the page whose hash it carries, and ClientRouter keeps the first page's CSP (see astro.config.mjs).
(function () {
  const d = document.documentElement;
  d.removeAttribute("data-home-anniv");
  d.removeAttribute("data-home-currently");
  d.removeAttribute("data-home-feed");
  d.removeAttribute("data-home-feed-paged");
  d.removeAttribute("data-home-continue");
  try {
    const n = new Date();
    const pad = (x) => (x < 10 ? "0" : "") + x;
    const today = n.getFullYear() + "-" + pad(n.getMonth() + 1) + "-" + pad(n.getDate());
    const first = new Date(n.getFullYear(), n.getMonth(), 1);
    const days = new Date(n.getFullYear(), n.getMonth() + 1, 0).getDate();
    d.setAttribute("data-home-cal-rows", String(Math.ceil(((first.getDay() + 6) % 7 + days) / 7)));
    const h = JSON.parse(localStorage.getItem('metadea_home_layout') || "null");
    if (h && h.d === today && h.a > 0) d.setAttribute("data-home-anniv", "");
    if (h && h.g > 0) d.setAttribute("data-home-currently", String(Math.min(h.g, 8)));
    if (h && h.f > 0) d.setAttribute("data-home-feed", String(Math.min(h.f, 10)));
    if (h && h.fp > 0) d.setAttribute("data-home-feed-paged", "");
    if (h && h.c > 0) d.setAttribute("data-home-continue", "");
  } catch {
    // No hint: the sections simply start empty.
  }
})();
