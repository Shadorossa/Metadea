export function initSettingsTabs() {
  document.querySelectorAll<HTMLButtonElement>('.settings-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.settings-panel').forEach(p => p.classList.add('hidden'));
      btn.classList.add('active');
      document.getElementById(`panel-${btn.dataset.tab}`)?.classList.remove('hidden');
    });
  });
}
