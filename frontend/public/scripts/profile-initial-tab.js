// Profile tab from ?list= / #hash before first paint. Loaded as a file, not inline: Tauri's CSP allows an inline script only on the page whose hash it carries, and ClientRouter keeps the first page's CSP (see astro.config.mjs).
(function() {
  const params = new URLSearchParams(window.location.search);
  const hash = params.get('list') ? 'lists' : window.location.hash.replace('#', '');
  const tabs = ['overview', 'library', 'favorites', 'stats', 'achievements', 'reviews', 'lists', 'friends'];
  if (hash && tabs.indexOf(hash) !== -1) {
    const buttons = document.querySelectorAll('.profile-tab');
    buttons.forEach(function(btn) {
      btn.classList.toggle('active', btn.dataset.tab === hash);
    });
  }
})();
