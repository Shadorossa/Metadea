import { STORAGE_KEYS } from '../shared/storage-keys';

const THEMES = [
  {
    id: 'nebula',
    name: 'Nebulosa',
    bg: 'radial-gradient(ellipse 80% 70% at 50% -10%, rgba(120,70,210,0.75) 0%, transparent 72%), #07070e',
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
    id: 'steampunk',
    name: 'Steampunk',
    bg: 'linear-gradient(135deg, #120d0a 0%, #3a2b1f 50%, #8c6239 100%)',
  },
  {
    id: 'cyberneon',
    name: 'Cyber Neon',
    bg: 'linear-gradient(135deg, #030308 0%, #0e0e22 50%, #ff0055 100%)',
  },
  {
    id: 'scifi',
    name: 'Astro (Sci-Fi)',
    bg: 'radial-gradient(circle at 50% 50%, rgba(0, 229, 255, 0.4) 0%, transparent 80%), #03080e',
  },
  {
    id: 'gothic',
    name: 'Catedral (Gótico)',
    bg: 'radial-gradient(circle at 50% 90%, rgba(83, 18, 18, 0.7) 0%, transparent 80%), #0a0808',
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
      localStorage.setItem(STORAGE_KEYS.appTheme, id);
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
