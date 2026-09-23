import React from 'react';
import { getT } from '../../i18n/runtime';
import { PrEditorAddButton } from '../media/pr-editor/PrEditorAddButton';
import { getRolePageCount, getRolePageItems, PrEditorRolePagination } from '../media/pr-editor/PrEditorRolePagination';
import type { AppearanceRow } from '../../lib/character/character-editor-diff';
import type { CharacterEditorAction } from '../../lib/character/character-editor-state';

export const RELATION_TYPE_OPTIONS = ['MAIN', 'SUPPORTING', 'BACKGROUND', 'CAMEO'];
const getRelationTypeLabels = () => {
  const t = getT();
  return {
    MAIN: t.character.role_main,
    SUPPORTING: t.character.role_supporting,
    BACKGROUND: t.character.role_background,
    CAMEO: t.character.role_cameo,
  };
};

export const groupAppearancesByRole = (appearances: AppearanceRow[]) => RELATION_TYPE_OPTIONS.map(type => ({
  type,
  allAppearances: appearances.filter(appearance => (appearance.relation_type ?? 'SUPPORTING') === type),
}));

export const getAppearanceTotalPages = (appearances: AppearanceRow[]) =>
  getRolePageCount(groupAppearancesByRole(appearances).map(group => group.allAppearances.length));

interface CharacterEditorAppearancesTabProps {
  appearances: AppearanceRow[];
  dispatch: React.Dispatch<CharacterEditorAction>;
  page: number;
  onPageChange: (page: number) => void;
  onOpenSearch: (relationType: string) => void;
}

export function CharacterEditorAppearancesTab({ appearances, dispatch, page, onPageChange, onOpenSearch }: CharacterEditorAppearancesTabProps) {
  const t = getT().character_editor;
  const appearanceGroups = groupAppearancesByRole(appearances);
  const appearanceTotalPages = getAppearanceTotalPages(appearances);
  const safeAppearancePage = Math.min(page, appearanceTotalPages - 1);
  const removeAppearance = (mediaExternalId: string) =>
    dispatch({ type: 'edit', patch: { appearances: appearances.filter(a => a.media_external_id !== mediaExternalId) } });

  return (
    <>
    {/* ── Apariciones ── */}
    <div className="pr-editor-section">
      <div className="pr-editor-character-appearance-groups pr-editor-character-appearance-groups--paginated">
        {appearanceGroups.map(group => {
          const { type, allAppearances: roleAppearances } = group;
          const pageAppearances = getRolePageItems(roleAppearances, safeAppearancePage);
          const label = getRelationTypeLabels()[type as keyof ReturnType<typeof getRelationTypeLabels>] || type;
          return (
            <section className="pr-editor-character-appearance-group pr-editor-media-character-role-group" key={type}>
              <div className="pr-editor-character-appearance-header">
                <h3 className="pr-editor-section-title pr-editor-character-appearance-title">
                  {label} <span>({roleAppearances.length})</span>
                </h3>
                <PrEditorAddButton
                  onClick={() => onOpenSearch(type)}
                  title={`${t.add_appearance}: ${label}`}
                />
              </div>
              <div className="pr-editor-characters-grid pr-editor-media-character-role-grid">
                {pageAppearances.map(a => (
          <div key={a.media_external_id} className="pr-editor-media-card">
            <div className="pr-editor-media-card-cover">
              {a.cover
                ? <img className="cover-image-fill" src={a.cover} alt="" />
                : <div className="pr-editor-media-card-placeholder" />}
              <button
                type="button"
                className="pr-editor-media-card-remove"
                onClick={() => removeAppearance(a.media_external_id)}
              >
                ×
              </button>
            </div>
            <div className="pr-editor-media-card-title" title={a.release_year ? `${a.title} (${a.release_year})` : a.title}>
              {a.title}
            </div>
            {a.release_year ? <div className="pr-editor-character-appearance-year">({a.release_year})</div> : null}
          </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
      <PrEditorRolePagination page={safeAppearancePage} totalPages={appearanceTotalPages} onPageChange={onPageChange} />

      {/* Character identity merges are managed in the dedicated tab. */}
      {/* <div className="pr-editor-appearance-merges">
        <div className="pr-editor-section-title">{t.appearance_merges}</div>
        {appearances.map(a => (
          <div className="pr-editor-appearance-merge-row" key={`merge-${a.media_external_id}`}>
            <div className="pr-editor-appearance-merge-work" title={a.title}>{a.title}</div>
            <div className="pr-editor-appearance-merge-controls">
              <span
                className={`pr-editor-appearance-merge-label${a.merged_character_external_id ? '' : ' is-empty'}`}
                title={a.merged_character_external_id || undefined}
              >
                {a.merged_character_external_id
                  ? `${t.merged_with}: ${a.merged_character_name || a.merged_character_external_id}`
                  : t.no_merge_target}
              </span>
              <button
                type="button"
                className="pr-editor-appearance-merge-btn"
                onClick={() => setMergePickerFor(a.media_external_id)}
              >
                {a.merged_character_external_id ? t.change_merge : t.merge_character}
              </button>
              {a.merged_character_external_id && (
                <button
                  type="button"
                  className="pr-editor-appearance-merge-clear"
                  onClick={() => clearAppearanceMergeTarget(a.media_external_id)}
                  title={t.clear_merge}
                  aria-label={t.clear_merge}
                >×</button>
              )}
            </div>
          </div>
        ))}
      </div> */}
    </div>
    </>
  );
}
