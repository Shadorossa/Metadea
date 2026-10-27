// Settings › AniList / MyAnimeList import: the blocking progress modal both
// imports show while they run. Each used to build its own copy, and the
// AniList one put the title into innerHTML unescaped.
import { getT } from '../../../i18n/runtime';
import { escapeHtml } from '../../../lib/shared/text/sanitize-html';
import type { ImportProgress } from '../../../lib/anilist/import';

export interface ImportProgressModal {
  update(progress: ImportProgress): void;
  remove(): void;
}

export function createImportProgressModal(title: string): ImportProgressModal {
  const modal = document.createElement('div');
  modal.className = 'settings-progress-modal';
  modal.innerHTML = `
    <h3 class="settings-progress-modal-title">${escapeHtml(title)}</h3>
    <div class="settings-progress-box">
      <div class="settings-progress-status">${escapeHtml(getT().settings.github_starting)}</div>
      <div class="settings-progress-track">
        <div class="settings-progress-fill" style="width: 0%;"></div>
      </div>
      <div class="settings-progress-count">0/0</div>
    </div>
  `;
  const backdrop = document.createElement('div');
  backdrop.className = 'settings-modal-backdrop';
  document.body.appendChild(backdrop);
  document.body.appendChild(modal);

  const statusEl = modal.querySelector<HTMLElement>('.settings-progress-status');
  const fillEl = modal.querySelector<HTMLElement>('.settings-progress-fill');
  const countEl = modal.querySelector<HTMLElement>('.settings-progress-count');

  return {
    update(progress) {
      if (statusEl) {
        statusEl.textContent = progress.status === 'done' && progress.failed
          ? getT().settings.anilist_import_partial
              .replace('{done}', String(progress.total - progress.failed))
              .replace('{total}', String(progress.total))
              .replace('{failed}', String(progress.failed))
          : progress.message || progress.status;
      }
      if (fillEl && progress.total > 0) fillEl.style.width = `${(progress.current / progress.total) * 100}%`;
      if (countEl) countEl.textContent = `${progress.current}/${progress.total}`;
    },
    remove() {
      modal.remove();
      backdrop.remove();
    },
  };
}
