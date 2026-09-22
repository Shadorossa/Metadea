import React from 'react';
import type { Translations } from '../../../i18n/index';
import type { LibraryEntry } from '../../../lib/tauri';
import { IconCheck, IconAlertCircle, IconTrash } from '../../local/ui/icons';

export function MediaEditorActions({
  te, saving, sharing, status, existingEntry, isAniListTypeValue, anilistStatus, anilistError,
  handleSave, handleDelete, handleShare,
}: {
  te: Translations['media']['editor'];
  saving: boolean;
  sharing: boolean;
  status: string;
  existingEntry: LibraryEntry | null | undefined;
  isAniListTypeValue: boolean;
  anilistStatus: 'idle' | 'syncing' | 'ok' | 'error';
  anilistError: string | null;
  handleSave: () => void;
  handleDelete: () => void;
  handleShare: () => void;
}) {
  return (
    <div className="me-button-stack-side">
      <button type="button" className="me-btn me-btn--save"
        onClick={handleSave} disabled={saving}>
        {saving ? te.saving : te.save}
      </button>
      {/* Always rendered (reserved slot, hidden via CSS when this
          tab's log has never been saved) — switching between a
          logged and an unlogged season must never shift Share
          (and the AniList status line below it) up or down. */}
      <button type="button"
        className={`me-btn me-btn--delete${!existingEntry ? ' me-btn--hidden' : ''}`}
        onClick={handleDelete} disabled={!existingEntry}
        tabIndex={existingEntry ? 0 : -1}
        title={te.delete}>
        <IconTrash size={15} strokeWidth={2.5} />
      </button>
      <button type="button" className="me-btn me-btn--share"
        onClick={handleShare} disabled={status !== 'completed' || sharing}
        title={status !== 'completed' ? te.share_requires_completed : te.share}>
        {sharing ? (
          <span className="spinner spinner--sm" />
        ) : (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="18" cy="5" r="3"></circle>
            <circle cx="6" cy="12" r="3"></circle>
            <circle cx="18" cy="19" r="3"></circle>
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
          </svg>
        )}
      </button>
      {isAniListTypeValue && anilistStatus !== 'idle' && (
        <div className={`me-anilist-status me-anilist-status--${anilistStatus}`}>
          {anilistStatus === 'syncing' && (
            <><span className="me-anilist-spinner" /><span>AniList…</span></>
          )}
          {anilistStatus === 'ok' && (
            <><IconCheck size={12} strokeWidth={2.5} /><span>AniList</span></>
          )}
          {anilistStatus === 'error' && (
            <><IconAlertCircle size={12} strokeWidth={2.5} /><span title={anilistError ?? ''}>{te.anilist_error}</span></>
          )}
        </div>
      )}
    </div>
  );
}
