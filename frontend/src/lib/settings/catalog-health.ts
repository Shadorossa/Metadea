import { findCatalogHealthIssues, deleteCatalogEntry, type CatalogHealthEntry } from '../tauri/catalog';
import { showModal } from '../shared/modal-utils';

function renderEntryRow(entry: CatalogHealthEntry, deletable: boolean): HTMLDivElement {
  const row = document.createElement('div');
  row.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:0.5rem; padding:0.4rem 0; border-bottom:1px solid var(--border-color); font-size:0.78rem;';

  const label = document.createElement('span');
  label.textContent = `${entry.title_main || entry.external_id} (${entry.type})`;
  row.appendChild(label);

  if (deletable) {
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
  }

  return row;
}

function renderSection(resultsEl: HTMLElement, title: string, entries: CatalogHealthEntry[], emptyMessage: string, deletable: boolean) {
  const heading = document.createElement('h4');
  heading.textContent = `${title} (${entries.length})`;
  heading.style.cssText = 'margin: 1rem 0 0.4rem; font-size: 0.8rem; color: var(--text-main);';
  resultsEl.appendChild(heading);

  if (entries.length === 0) {
    const p = document.createElement('p');
    p.className = 'settings-hint';
    p.textContent = emptyMessage;
    resultsEl.appendChild(p);
    return;
  }
  entries.forEach(e => resultsEl.appendChild(renderEntryRow(e, deletable)));
}

// Settings > Entorno's "Detectar duplicados y huérfanos" button — a
// read-only maintenance scan (see find_catalog_health_issues in
// media_catalog.rs for exactly what counts as each). Orphans get a real
// delete button since nothing else references them; duplicates are listed
// for manual review only — merging two catalog rows for "the same" work
// isn't safe to automate (they may differ in source/relations/etc.).
export function initCatalogHealthCheck() {
  const btn = document.getElementById('catalog-health-btn') as HTMLButtonElement | null;
  const resultsEl = document.getElementById('catalog-health-results');
  if (!btn || !resultsEl) return;

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = 'Buscando...';
    try {
      const report = await findCatalogHealthIssues();
      resultsEl.innerHTML = '';
      showModal(resultsEl);
      renderSection(resultsEl, 'Huérfanas', report.orphans, 'No se encontraron entradas huérfanas.', true);
      renderSection(resultsEl, 'Posibles duplicados', report.duplicates, 'No se encontraron duplicados.', false);
    } catch (err) {
      console.error('Failed to check catalog health:', err);
    } finally {
      btn.disabled = false;
      if (originalText) btn.textContent = originalText;
    }
  });
}
