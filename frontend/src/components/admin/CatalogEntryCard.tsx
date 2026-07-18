import { IconPencil, IconTrash } from '../local/ui/icons';

interface Props {
  id: string;
  title: string;
  cover: string | null | undefined;
  editLabel: string;
  deleteLabel: string;
  onEdit: () => void;
  onDelete: () => void;
  editDisabled?: boolean;
}

// Shared card shape for the "local" and "github" source tabs in
// CatalogAdminPanel — both used to render an identical cover/id/title/edit/
// delete card grid, differing only in the data source and edit handler.
export function CatalogEntryCard({ id, title, cover, editLabel, deleteLabel, onEdit, onDelete, editDisabled }: Props) {
  return (
    <div className="catalog-admin-card">
      <div className="catalog-admin-card-cover">
        {cover
          ? <img src={cover} alt="" loading="lazy" />
          : <span className="catalog-admin-card-no-cover">—</span>}
      </div>
      <div className="pr-editor-search-result-info">
        <div className="pr-editor-search-result-id">{id}</div>
        <div className="pr-editor-search-result-title">{title}</div>
      </div>
      <div className="catalog-admin-card-actions">
        <button type="button" className="catalog-admin-icon-btn" disabled={editDisabled} onClick={onEdit} aria-label={editLabel} title={editLabel}>
          <IconPencil size={13} />
        </button>
        <button type="button" className="catalog-admin-icon-btn catalog-admin-icon-btn--delete" onClick={onDelete} aria-label={deleteLabel} title={deleteLabel}>
          <IconTrash size={13} />
        </button>
      </div>
    </div>
  );
}
