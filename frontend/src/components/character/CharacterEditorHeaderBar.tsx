import { X } from 'lucide-react';
import { getT } from '../../i18n/runtime';
import { PrEditorHeader } from '../shared/PrEditorHeader';

interface CharacterEditorHeaderBarProps {
  title: string;
  currentId: string;
  statusMsg: string;
  submitting: boolean;
  canSubmit: boolean;
  onImport: () => void;
  onCancel: () => void;
  onSubmit: () => void;
}

export function CharacterEditorHeaderBar({ title, currentId, statusMsg, submitting, canSubmit, onImport, onCancel, onSubmit }: CharacterEditorHeaderBarProps) {
  const t = getT().character_editor;
  return (
    <PrEditorHeader
      title={title}
      subtitle={`ID: ${currentId}`}
      status={statusMsg && (
        <div className="pr-editor-header-status">
          <div className="spinner spinner--small pr-editor-header-status-spinner" />
          <span>{statusMsg}</span>
        </div>
      )}
      actions={
      <>
        <button
          type="button"
          className="pr-editor-btn pr-editor-btn--secondary pr-editor-header-action pr-editor-header-action--import"
          onClick={onImport}
          title={t.import_fandom_title}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          <span>{t.import_data_button}</span>
        </button>
        <button
          type="button"
          className="pr-editor-btn pr-editor-btn--cancel pr-editor-header-action pr-editor-header-action--icon pr-editor-header-cancel"
          onClick={onCancel}
          disabled={submitting}
          title={t.cancel}
          aria-label={t.cancel}
        >
          <X size={17} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="pr-editor-btn pr-editor-btn--submit pr-editor-header-action"
          onClick={onSubmit}
          disabled={submitting || !canSubmit}
        >
          {submitting ? t.submitting : 'Submit Proposal'}
        </button>
      </>
      }
    />
  );
}
