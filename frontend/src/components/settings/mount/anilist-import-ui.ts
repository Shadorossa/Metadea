import { importFromAniList, syncFromAniList, type ImportProgress } from '../../../lib/anilist/import';
import { showModal, hideModal } from '../../../lib/dom/modal-utils';
import { byId } from '../../../lib/dom/dom';
import { getT } from '../../../i18n/runtime';
import { createImportProgressModal } from './import-progress-modal';

const ALL_FORMATS = ['TV', 'TV_SHORT', 'MOVIE', 'SPECIAL', 'OVA', 'ONA', 'MANGA', 'ONE_SHOT', 'NOVEL'];

function selectedFormats(): string[] {
  return ALL_FORMATS.filter(f => (byId<HTMLInputElement>(`fmt-${f}`))?.checked);
}

export function initAniListImportUI(showToast: (msg?: string) => void) {
  const importBtn = byId<HTMLButtonElement>('anilist-import-btn');
  const importChooseModal = byId<HTMLElement>('anilist-import-choose-modal');

  async function updateImportButtons() {
    const { invoke } = await import('../../../lib/tauri/bridge');
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
      showToast(getT().settings.anilist_import_select_format);
      return;
    }

    hideChooseModal();
    const progressModal = createImportProgressModal(title);

    try {
      const result = await transfer(formats, progress => progressModal.update(progress));
      progressModal.remove();
      showToast(result.ok ? successMessage(result) : getT().settings.error_with_message.replace('{message}', result.error ?? ''));
    } catch (e) {
      progressModal.remove();
      const message = e instanceof Error ? e.message : (kind === 'import' ? getT().settings.anilist_import_failed : getT().settings.anilist_sync_failed);
      showToast(getT().settings.error_with_message.replace('{message}', message));
    } finally {
      await updateImportButtons();
    }
  }

  const doImport = () => runTransfer(
    'import',
    getT().settings.anilist_import_title,
    importFromAniList,
    result => getT().settings.anilist_import_result.replace('{count}', String(result.imported ?? 0)),
  );

  const doSync = () => runTransfer(
    'sync',
    getT().settings.anilist_sync_title,
    syncFromAniList,
    result => getT().settings.anilist_sync_result.replace('{updated}', String(result.updated ?? 0)).replace('{added}', String(result.added ?? 0)),
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
