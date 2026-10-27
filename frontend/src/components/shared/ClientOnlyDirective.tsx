// Renders nothing. BaseLayout mounts it `client:only` so that every page
// carries Astro's inline `client:only` hydration script: Astro emits a
// directive's script only on pages that use it, Tauri's CSP allows an inline
// script only on the page whose hash it carries, and ClientRouter keeps the
// first page's CSP for the whole session — without this, Home's client:only
// islands never hydrated after navigating to it from another page.
export function ClientOnlyDirective() {
  return null;
}
