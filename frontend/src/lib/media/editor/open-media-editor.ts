// Opens the Media Editor for a bare external_id — the editor fetches its own
// catalog/library data for it. Used by GameDetailPanel/LocalMediaDetailPanel's
// neighbor-row clicks (a prequel/sequel/bundle child), where only the id is
// known going in, not a full library/catalog entry (unlike each panel's own
// richer handleEdit, which already has both and passes them along too — a
// different call shape, not consolidated here).
export function openMediaEditor(externalId: string): void {
  window.dispatchEvent(new CustomEvent('open-profile-editor', { detail: { externalId } }));
}
