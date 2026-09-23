import { getT } from '../../i18n/runtime';

interface CharacterEditorUnsavedPromptProps {
  shake: number;
  pendingTabCloseId: string | null;
  submitting: boolean;
  canSubmit: boolean;
  onCloseTabWithoutSaving: (externalId: string) => void;
  onKeepEditing: () => void;
  onSubmit: () => void;
  onDiscard: () => void;
}

// Two flavours of the same toast: closing one session tab (close/keep) vs
// closing the whole editor (submit/discard).
export function CharacterEditorUnsavedPrompt({
  shake, pendingTabCloseId, submitting, canSubmit, onCloseTabWithoutSaving, onKeepEditing, onSubmit, onDiscard,
}: CharacterEditorUnsavedPromptProps) {
  const t = getT().character_editor;
  return (
    <div key={shake} className={`pr-unsaved-changes-toast${shake ? ' pr-unsaved-changes-toast--shake' : ''}`} role="alertdialog" aria-live="assertive" onClick={event => event.stopPropagation()}>
      {pendingTabCloseId ? <span>{t.unsaved_this_character}</span> : <span>{t.unsaved_generic}</span>}
      {pendingTabCloseId ? (
        <>
          <button type="button" className="pr-editor-btn pr-editor-btn--cancel" onClick={() => onCloseTabWithoutSaving(pendingTabCloseId)} disabled={submitting}>{t.close_without_saving}</button>
          <button type="button" className="pr-editor-btn pr-editor-btn--secondary" onClick={onKeepEditing}>{t.cancel}</button>
        </>
      ) : (
        <>
          <button type="button" className="pr-editor-btn pr-editor-btn--submit" onClick={onSubmit} disabled={submitting || !canSubmit}>
            {submitting ? t.submitting : 'Submit proposal'}
          </button>
          <button type="button" className="pr-editor-btn pr-editor-btn--cancel" onClick={onDiscard} disabled={submitting}>Descartar</button>
        </>
      )}
    </div>
  );
}
