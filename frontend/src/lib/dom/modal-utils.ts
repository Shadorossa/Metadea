// Shared show/hide for the flex/none inline modals used across settings
// (GitHub device flow, AniList token prompt, AniList import chooser).

export function showModal(modal: HTMLElement | null | undefined) {
  if (modal) modal.style.display = 'flex';
}

export function hideModal(modal: HTMLElement | null | undefined) {
  if (modal) modal.style.display = 'none';
}
