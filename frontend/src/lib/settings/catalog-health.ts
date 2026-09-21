import { findCatalogOrphans, deleteCatalogEntry, type CatalogOrphanEntry } from '../tauri/catalog';
import { showModal } from '../shared/modal-utils';

function renderEntryRow(entry: CatalogOrphanEntry): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'catalog-health-entry-row';

  const label = document.createElement('span');
  label.textContent = `${entry.title_main || entry.external_id} (${entry.type})`;
  row.appendChild(label);

  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'btn btn--sm btn--ghost';
  delBtn.textContent = 'Eliminar';
  delBtn.addEventListener('click', async () => {
    if (!confirm(`¿Eliminar "${entry.title_main || entry.external_id}" del catálogo? No está en tu biblioteca ni referenciado por nada.`)) return;
    delBtn.disabled = true;
    await deleteCatalogEntry(entry.external_id).catch(console.error);
    row.remove();
  });
  row.appendChild(delBtn);

  return row;
}

function renderSection(resultsEl: HTMLElement, title: string, entries: CatalogOrphanEntry[], emptyMessage: string) {
  const heading = document.createElement('h4');
  heading.className = 'catalog-health-section-heading';
  heading.textContent = `${title} (${entries.length})`;
  resultsEl.appendChild(heading);

  if (entries.length === 0) {
    const p = document.createElement('p');
    p.className = 'settings-hint';
    p.textContent = emptyMessage;
    resultsEl.appendChild(p);
    return;
  }
  entries.forEach(e => resultsEl.appendChild(renderEntryRow(e)));
}

// Settings > Entorno's orphan scan; possible duplicate candidates are
// reviewed in the catalog editor next to its search field.
export function initCatalogHealthCheck() {
  const btn = document.getElementById('catalog-health-btn') as HTMLButtonElement | null;
  const resultsEl = document.getElementById('catalog-health-results');
  if (!btn || !resultsEl) return;

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = 'Buscando...';
    try {
      const orphans = await findCatalogOrphans();
      resultsEl.innerHTML = '';
      showModal(resultsEl);
      renderSection(resultsEl, 'Huérfanas', orphans, 'No se encontraron entradas huérfanas.');
    } catch (err) {
      console.error('Failed to check catalog health:', err);
    } finally {
      btn.disabled = false;
      if (originalText) btn.textContent = originalText;
    }
  });
}
