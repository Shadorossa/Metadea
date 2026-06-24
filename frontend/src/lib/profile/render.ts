import { getLibraryItems, getLibraryStats } from '../tauri';
import { pad, typeLabel, statusLabel } from './utils';

type Items = Awaited<ReturnType<typeof getLibraryItems>>;

export async function renderOverview(el: HTMLElement, items: Items): Promise<void> {
  const stats  = await getLibraryStats().catch(() => ({ total: 0, by_type: {} as Record<string, number> }));
  const byType = (stats as { by_type: Record<string, number> }).by_type ?? {};

  let completed = 0, inProgress = 0, planning = 0, dropped = 0;
  for (const item of items) {
    const s = item.status ?? 'planning';
    if (s === 'completed') completed++;
    else if (s === 'watching' || s === 'playing' || s === 'reading') inProgress++;
    else if (s === 'planning') planning++;
    else if (s === 'dropped') dropped++;
  }

  const statsHtml = `
    <div class="profile-stats-bar">
      ${([
        ['Total de obras', pad(items.length)],
        ['En progreso',    pad(inProgress)],
        ['Completadas',    pad(completed)],
        ['Pendientes',     pad(planning)],
        ['Abandonadas',    pad(dropped)],
      ] as [string, string][]).map(([label, value]) =>
        `<div class="profile-stat">
           <span class="profile-stat-value">${value}</span>
           <span class="profile-stat-label">${label}</span>
         </div>`
      ).join('')}
    </div>`;

  const typesHtml = Object.keys(byType).length > 0
    ? `<div>
         <p class="profile-section-label">Por tipo</p>
         <div class="type-chips">
           ${Object.entries(byType).map(([type, count]) =>
             `<span class="type-chip">
                <span class="type-chip-count">${count}</span>
                <span class="type-chip-label">${typeLabel(type)}</span>
              </span>`
           ).join('')}
         </div>
       </div>`
    : `<div class="profile-empty">
         <span class="profile-empty-icon">📚</span>
         <p>Tu biblioteca está vacía. ¡Empieza a buscar obras!</p>
         <a href="/search">Ir al buscador →</a>
       </div>`;

  el.innerHTML = statsHtml + typesHtml;
}

export async function renderLibrary(el: HTMLElement): Promise<void> {
  const items = await getLibraryItems().catch(() => []);

  if (items.length === 0) {
    el.innerHTML = `
      <div class="profile-empty">
        <span class="profile-empty-icon">📚</span>
        <p>Tu biblioteca está vacía. ¡Empieza a buscar obras!</p>
        <a href="/search">Ir al buscador →</a>
      </div>`;
    return;
  }

  el.innerHTML = `
    <div class="library-list">
      ${items.map(item => `
        <div class="library-row">
          <span class="library-row-id">${item.external_id}</span>
          <span class="library-row-type">${typeLabel(item.item_type)}</span>
          <span class="library-row-status">${statusLabel(item.status ?? 'planning')}</span>
        </div>`).join('')}
    </div>`;
}

export function renderStats(el: HTMLElement): void {
  el.innerHTML = `<div class="profile-coming-soon"><p>📊 Estadísticas próximamente</p></div>`;
}
