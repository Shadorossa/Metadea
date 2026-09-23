import { RefreshCw, Trash2, X } from 'lucide-react';
import type { Translations } from '../../../i18n/index';

interface Props {
  pe: Translations['pr_editor'];
  blocked: boolean;
  isResyncing: boolean;
  submitting: boolean;
  submitDisabled: boolean;
  onResync: () => void;
  onToggleBlocked: () => void;
  onCancel: () => void;
  onSubmit: () => void;
}

// The modal header's right-hand buttons: resync from the live source,
// block/unblock ("Eliminar de Metadea"), cancel, submit.
export function PrEditorHeaderActions({ pe, blocked, isResyncing, submitting, submitDisabled, onResync, onToggleBlocked, onCancel, onSubmit }: Props) {
  return (
    <>
      <button
        type="button"
        className="pr-editor-block-btn pr-editor-block-btn--icon pr-editor-header-action pr-editor-header-action--icon"
        title={pe.resync_tooltip}
        aria-label={pe.resync_tooltip}
        aria-busy={isResyncing}
        disabled={isResyncing}
        onClick={onResync}
      >
        <RefreshCw size={16} aria-hidden="true" className={isResyncing ? 'pr-editor-spin' : undefined} />
      </button>
      <button
        type="button"
        className={`pr-editor-block-btn pr-editor-block-btn--icon pr-editor-header-action pr-editor-header-action--icon${blocked ? ' pr-editor-block-btn--active' : ''}`}
        aria-pressed={blocked}
        title={pe.block_tooltip}
        aria-label={pe.block_tooltip}
        onClick={onToggleBlocked}
      >
        <Trash2 size={16} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="pr-editor-btn pr-editor-btn--cancel pr-editor-header-action pr-editor-header-action--icon pr-editor-header-cancel"
        onClick={onCancel}
        disabled={submitting}
        title={pe.cancel}
        aria-label={pe.cancel}
      >
        <X size={17} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="pr-editor-btn pr-editor-btn--submit pr-editor-header-action"
        onClick={onSubmit}
        disabled={submitDisabled}
      >
        {submitting ? pe.sending : pe.submit_proposal}
      </button>
    </>
  );
}
