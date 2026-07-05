const THEMES = [
  {
    id: 'nebula',
    name: 'Nebulosa',
    bg: 'radial-gradient(ellipse 80% 70% at 50% -10%, rgba(120,70,210,0.75) 0%, transparent 72%), #07070e',
  },
  {
    id: 'aurora',
    name: 'Aurora',
    bg: 'radial-gradient(ellipse 90% 70% at 15% -10%, rgba(0,200,130,0.8) 0%, transparent 70%), radial-gradient(ellipse 50% 45% at 85% 100%, rgba(10,160,100,0.5) 0%, transparent 65%), #040e0a',
  },
  {
    id: 'cosmos',
    name: 'Cosmos',
    bg: 'radial-gradient(ellipse 70% 65% at 15% 20%, rgba(80,120,230,0.75) 0%, transparent 70%), radial-gradient(ellipse 50% 45% at 82% 72%, rgba(100,80,240,0.55) 0%, transparent 65%), #050711',
  },
  {
    id: 'ember',
    name: 'Ember',
    bg: 'radial-gradient(ellipse 85% 75% at 50% 120%, rgba(240,120,20,0.85) 0%, transparent 68%), radial-gradient(ellipse 45% 40% at 8% 80%, rgba(245,158,11,0.4) 0%, transparent 60%), #0c0804',
  },
  {
    id: 'ocean',
    name: 'Océano',
    bg: 'radial-gradient(ellipse 80% 70% at 0% 100%, rgba(6,182,212,0.75) 0%, transparent 68%), radial-gradient(ellipse 55% 50% at 100% 0%, rgba(2,132,199,0.55) 0%, transparent 65%), #040b0e',
  },
  {
    id: 'sakura',
    name: 'Sakura',
    bg: 'radial-gradient(ellipse 80% 70% at 92% -10%, rgba(244,114,182,0.8) 0%, transparent 68%), radial-gradient(ellipse 45% 40% at 8% 90%, rgba(232,121,249,0.45) 0%, transparent 60%), #0d060b',
  },
  {
    id: 'cyberpunk',
    name: 'Cyberpunk',
    bg: 'linear-gradient(135deg, #ff0055 0%, #00f0ff 100%)',
  },
  {
    id: 'newspaper-dark',
    name: 'Newspaper Dark',
    bg: 'linear-gradient(135deg, #151413 0%, #252422 50%, #dca364 100%)',
  },
  {
    id: 'pipboy',
    name: 'Pip-Boy',
    bg: 'radial-gradient(circle at 50% 50%, rgba(29, 255, 115, 0.45) 0%, transparent 80%), #080c09',
  },
  {
    id: 'glassmorphism',
    name: 'Glassmorphism',
    bg: 'radial-gradient(circle at 10% 20%, rgba(147, 51, 234, 0.4) 0%, transparent 50%), radial-gradient(circle at 90% 80%, rgba(59, 130, 246, 0.3) 0%, transparent 50%), #090714',
  },
  {
    id: 'synthwave',
    name: 'Synthwave',
    bg: 'radial-gradient(circle at 50% 90%, rgba(255, 110, 0, 0.7) 0%, rgba(255, 0, 127, 0.3) 50%, transparent 85%), #0d0415',
  },
  {
    id: 'forest',
    name: 'Bosque',
    bg: 'radial-gradient(ellipse 80% 70% at 50% -10%, rgba(16,185,129,0.75) 0%, transparent 72%), #020804',
  },
] as const;

const CHECK_SVG = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

export function initThemePicker(showToast: (msg?: string) => void) {
  const grid    = document.getElementById('theme-grid')!;
  const current = document.documentElement.getAttribute('data-theme') || 'nebula';

  grid.innerHTML = THEMES.map(t => `
    <button class="theme-card${t.id === current ? ' active' : ''}" data-theme-id="${t.id}">
      <div class="theme-card-preview" style="background:${t.bg}">
        <span class="theme-card-check">${CHECK_SVG}</span>
      </div>
      <span class="theme-card-name">${t.name}</span>
    </button>
  `).join('');

  grid.querySelectorAll<HTMLButtonElement>('.theme-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.dataset.themeId!;
      localStorage.setItem('app_theme', id);
      if (typeof window.__updateTheme === 'function') {
        window.__updateTheme(id);
      } else {
        document.documentElement.setAttribute('data-theme', id);
      }
      grid.querySelectorAll('.theme-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      showToast('Tema aplicado');
    });
  });
}
