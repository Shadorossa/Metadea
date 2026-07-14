function activateTab(tab: string) {
  const btn = document.querySelector<HTMLButtonElement>(`.settings-tab[data-tab="${tab}"]`);
  if (!btn) return;
  document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.settings-panel').forEach(p => p.classList.add('hidden'));
  btn.classList.add('active');
  document.getElementById(`panel-${tab}`)?.classList.remove('hidden');
}

export function initSettingsTabs() {
  document.querySelectorAll<HTMLButtonElement>('.settings-tab').forEach(btn => {
    btn.addEventListener('click', () => activateTab(btn.dataset.tab!));
  });

  // Deep-link support (e.g. "/settings?tab=environment&platform=tmdb"), used
  // by other pages to send the user straight to a specific settings section
  // instead of always landing on the default "profile" tab.
  const params   = new URLSearchParams(window.location.search);
  const tab      = params.get('tab');
  const platform = params.get('platform');
  if (tab) activateTab(tab);
  if (platform) {
    document.querySelector<HTMLButtonElement>(`.api-platform-tab-btn[data-platform="${platform}"]`)?.click();
    // Coming here (e.g. from the search page's "missing API key" prompt)
    // means the user doesn't have this configured yet — open its guide
    // straight away instead of making them hunt for the (?) button.
    const modal = document.getElementById(`${platform}-help-modal`) as HTMLElement | null;
    if (modal) modal.style.display = 'flex';
  }
}
