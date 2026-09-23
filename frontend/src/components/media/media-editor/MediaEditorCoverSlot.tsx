import React from 'react';
import { toLargeCover } from '../../../lib/media/small-cover';
import { setCoverPreference } from '../../../lib/media/cover-preferences';
import type { CoverCandidate } from './media-editor-load';

export function MediaEditorCoverSlot({
  cover, hasCoverCandidates, coverCandidates, coverPreferenceId, coverPickerOpen,
  baseId, editionsLabel, setCoverPreferenceId, setCoverPickerOpen,
}: {
  cover?: string;
  hasCoverCandidates: boolean;
  coverCandidates: CoverCandidate[];
  coverPreferenceId: string | null;
  coverPickerOpen: boolean;
  baseId: string;
  editionsLabel: string;
  setCoverPreferenceId: (value: string | null) => void;
  setCoverPickerOpen: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  return (
    // Always reserves its slot (even with no cover yet for this
    // tab/season) — switching to a tab whose cover hasn't loaded
    // must never shift the title text sideways.
    <div className={`me-header-cover-slot${hasCoverCandidates ? ' me-header-cover-slot--selectable' : ''}`}>
      {cover && <img src={cover} alt="" className="me-header-cover" />}
      {hasCoverCandidates && (
        <>
          <button
            type="button"
            className="me-header-cover-picker-btn"
            aria-label={editionsLabel}
            title={editionsLabel}
            onClick={() => setCoverPickerOpen(open => !open)}
          >
            ⋯
          </button>
          {coverPickerOpen && (
            <div className="me-header-cover-picker-overlay" role="presentation" onClick={() => setCoverPickerOpen(false)}>
              <div className="me-header-cover-picker" role="dialog" aria-label={editionsLabel} onClick={e => e.stopPropagation()}>
                {coverCandidates.filter(candidate => candidate.cover).map(candidate => (
                  <button
                    key={candidate.externalId}
                    type="button"
                    className={`me-header-cover-option${coverPreferenceId === candidate.cover ? ' active' : ''}`}
                    aria-label={candidate.title}
                    title={candidate.title}
                    onClick={() => {
                      if (!candidate.cover) return;
                      const aliases = coverCandidates
                        .filter(c => c.cover && !c.externalId.includes(':localized-cover:'))
                        .map(c => c.externalId);
                      setCoverPreference(baseId, candidate.cover, aliases);
                      setCoverPreferenceId(candidate.cover);
                      setCoverPickerOpen(false);
                    }}
                  >
                    <img src={toLargeCover(candidate.cover)} alt="" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
