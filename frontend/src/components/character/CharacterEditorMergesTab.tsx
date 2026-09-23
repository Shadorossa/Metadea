import React from 'react';
import { getT } from '../../i18n/runtime';
import { PrEditorAddButton } from '../media/pr-editor/PrEditorAddButton';
import type { CharacterMerge } from '../../lib/tauri/characters';

interface CharacterEditorMergesTabProps {
  mergedCharacters: CharacterMerge[];
  onRemove: (externalId: string) => void;
  onOpenSearch: () => void;
  mergeInfoRef: React.RefObject<HTMLButtonElement | null>;
  // The hint itself renders at the modal root (outside the modal's
  // overflow:hidden), so this tab only owns the trigger button.
  mergeHint: { isOpen: boolean; open: () => void; close: () => void };
}

export function CharacterEditorMergesTab({ mergedCharacters, onRemove, onOpenSearch, mergeInfoRef, mergeHint }: CharacterEditorMergesTabProps) {
  const t = getT().character_editor;

  return (
    <div className="pr-editor-section pr-editor-character-merges">
      {mergedCharacters.length > 0 ? (
        <div className="pr-editor-character-merge-list">
          {mergedCharacters.map(item => (
            <div className="pr-editor-character-merge-item" key={item.external_id}>
              {item.image_url
                ? <img src={item.image_url} alt="" />
                : <div className="pr-editor-character-merge-placeholder">{item.name.charAt(0).toUpperCase()}</div>}
              <span className="pr-editor-character-merge-name" title={`${item.name} · ${item.external_id}`}>
                <strong>{item.name}</strong>
                <small>{item.external_id}</small>
              </span>
              <button type="button" onClick={() => onRemove(item.external_id)} title={t.clear_merge} aria-label={t.clear_merge}>×</button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="pr-editor-add-row pr-editor-character-merge-add-row">
        <PrEditorAddButton onClick={onOpenSearch} title={t.add_merge} />
        <button
          ref={mergeInfoRef}
          type="button"
          className="pr-editor-merge-info"
          aria-label={`${t.merge_info}: ${t.merge_hint}`}
          aria-describedby={mergeHint.isOpen ? 'character-merge-info-tooltip' : undefined}
          onMouseEnter={mergeHint.open}
          onMouseLeave={() => {
            if (document.activeElement !== mergeInfoRef.current) mergeHint.close();
          }}
          onFocus={mergeHint.open}
          onBlur={mergeHint.close}
        ><span className="info-indicator" aria-hidden="true">i</span></button>
      </div>

      {/* Superseded by MediaSearchPopup's castPicker (see the modal); kept for reference. */}
      {/* {mergeSelectedWork && createPortal(
        <div className="pr-editor-overlay pr-editor-overlay--nested pr-editor-merge-cast-overlay" onClick={() => setMergeSelectedWork(null)}>
          <div className="pr-editor-merge-cast-modal" onClick={event => event.stopPropagation()}>
            <div className="pr-editor-merge-cast-header">
              <div>
                <span className="pr-editor-section-title">{t.select_character}</span>
                <small>{mergeSelectedWork.title}</small>
              </div>
              <button type="button" onClick={() => setMergeSelectedWork(null)} aria-label={t.cancel}>×</button>
            </div>
            {mergeCandidatesLoading ? (
              <div className="pr-editor-character-merges-empty">{t.loading_characters}</div>
            ) : mergeCandidates.length > 0 ? (
              <div className="pr-editor-merge-cast-list">
                {mergeCandidates.map(candidate => (
                  <button type="button" className="pr-editor-merge-cast-option" key={candidate.external_id} onClick={() => addMergedCharacter(candidate)}>
                    {candidate.image_url
                      ? <img src={candidate.image_url} alt="" />
                      : <span className="pr-editor-character-merge-placeholder">{candidate.name.charAt(0).toUpperCase()}</span>}
                    <span><strong>{candidate.name}</strong><small>{candidate.external_id}</small></span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="pr-editor-character-merges-empty">{t.no_characters}</div>
            )}
          </div>
        </div>,
        document.body,
      )} */}
    </div>
  );
}
