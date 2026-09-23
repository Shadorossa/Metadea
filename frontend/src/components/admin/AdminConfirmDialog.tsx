interface Props {
  message: string;
  cancelLabel: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}

// The delete confirmation overlay every admin tab shows before removing a row.
export function AdminConfirmDialog({ message, cancelLabel, confirmLabel, onCancel, onConfirm }: Props) {
  return (
    <div className="me-overlay" onClick={onCancel}>
      <div className="catalog-admin-confirm" onClick={e => e.stopPropagation()}>
        <p>{message}</p>
        <div className="catalog-admin-confirm-actions">
          <button type="button" className="catalog-admin-confirm-cancel" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className="catalog-admin-confirm-delete" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
