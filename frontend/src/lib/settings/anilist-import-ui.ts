import { importFromAniList, syncFromAniList, type ImportProgress } from '../anilist/import';
import { showModal, hideModal } from '../shared/modal-utils';
import { byId } from '../shared/dom';

const ALL_FORMATS = ['TV', 'TV_SHORT', 'MOVIE', 'SPECIAL', 'OVA', 'ONA', 'MANGA', 'ONE_SHOT', 'NOVEL'];

function selectedFormats(): string[] {
  return ALL_FORMATS.filter(f => (byId<HTMLInputElement>(`fmt-${f}`))?.checked);
}

function updateProgressUI(progress: ImportProgress) {
  const statusEl = document.getElementById('import-status');
  const progressEl = document.getElementById('import-progress');
  const countEl = document.getElementById('import-count');

  if (statusEl) statusEl.textContent = progress.message || progress.status;
  if (progressEl && progress.total > 0) {
    progressEl.style.width = `${(progress.current / progress.total) * 100}%`;
  }
  if (countEl) countEl.textContent = `${progress.current}/${progress.total}`;
}

function createProgressModal(title: string) {
  const modal = document.createElement('div');
  modal.id = 'anilist-import-progress-modal';
  modal.className = 'settings-progress-modal';
  modal.innerHTML = `
    <h3 class="settings-progress-modal-title">${title}</h3>
    <div class="settings-progress-box">
      <div class="settings-progress-status" id="import-status">Iniciando...</div>
      <div class="settings-progress-track">
        <div id="import-progress" class="settings-progress-fill" style="width: 0%;"></div>
      </div>
      <div class="settings-progress-count" id="import-count">0/0</div>
    </div>
  `;

  const backdrop = document.createElement('div');
  backdrop.id = 'anilist-import-progress-backdrop';
  backdrop.className = 'settings-modal-backdrop';

  document.body.appendChild(backdrop);
  document.body.appendChild(modal);
  return { modal, backdrop };
}

export function initAniListImportUI(showToast: (msg?: string) => void) {
  const importBtn = byId<HTMLButtonElement>('anilist-import-btn');
  const importChooseModal = byId<HTMLElement>('anilist-import-choose-modal');

  async function updateImportButtons() {
    const { invoke } = await import('../tauri');
    const hasToken = await invoke('get_anilist_token').catch(() => null);
    if (importBtn) importBtn.disabled = !hasToken;
  }

  function hideChooseModal() {
    hideModal(importChooseModal);
    document.getElementById('anilist-import-choose-backdrop')?.remove();
  }

  function showChooseModal() {
    if (!importChooseModal) return;
    showModal(importChooseModal);
    const backdrop = document.createElement('div');
    backdrop.id = 'anilist-import-choose-backdrop';
    backdrop.className = 'settings-modal-backdrop';
    backdrop.addEventListener('click', hideChooseModal);
    importChooseModal.parentElement!.appendChild(backdrop);
  }

  async function runTransfer(
    kind: 'import' | 'sync',
    title: string,
    transfer: (formats: string[], onProgress: (p: ImportProgress) => void) => Promise<{ ok: boolean; error?: string; imported?: number; updated?: number; added?: number }>,
    successMessage: (result: { imported?: number; updated?: number; added?: number }) => string,
  ) {
    const formats = selectedFormats();
    if (formats.length === 0) {
      showToast('Selecciona al menos un formato');
      return;
    }

    hideChooseModal();
    const { modal, backdrop } = createProgressModal(title);

    try {
      const result = await transfer(formats, updateProgressUI);
      modal.remove();
      backdrop.remove();
      showToast(result.ok ? successMessage(result) : `Error: ${result.error}`);
    } catch (e) {
      modal.remove();
      backdrop.remove();
      const message = e instanceof Error ? e.message : `${kind === 'import' ? 'Import' : 'Sync'} failed`;
      showToast(`Error: ${message}`);
    } finally {
      await updateImportButtons();
    }
  }

  const doImport = () => runTransfer(
    'import',
    'Importando desde AniList...',
    importFromAniList,
    result => `✓ Importados ${result.imported ?? 0} items`,
  );

  const doSync = () => runTransfer(
    'sync',
    'Sincronizando desde AniList...',
    syncFromAniList,
    result => `✓ ${result.updated ?? 0} actualizados, ${result.added ?? 0} nuevos`,
  );

  // Event delegation for import buttons (choose modal is created/destroyed dynamically)
  document.addEventListener('click', (e: MouseEvent) => {
    const btn = (e.target as HTMLElement).closest('button');
    if (!btn) return;

    if (btn.id === 'anilist-import-btn') showChooseModal();
    else if (btn.id === 'anilist-import-start-btn') doImport();
    else if (btn.id === 'anilist-sync-start-btn') doSync();
    else if (btn.id === 'anilist-import-cancel-btn') hideChooseModal();
  });

  setTimeout(() => { updateImportButtons(); }, 100);
}
