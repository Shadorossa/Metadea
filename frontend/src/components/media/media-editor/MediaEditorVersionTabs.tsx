import React from 'react';
import type { Translations } from '../../../i18n/index';
import { createDefaultLog, createEmptyVersionEntry, type EntryAction, type LogState } from '../../../lib/media/log-state';
import { seriesSeasonExternalId } from '../../../lib/media/mapper-utils';
import type { MediaSeasonInfo } from '../../../lib/media/types';
import type { SagaEntry } from '../../../lib/anilist/saga';
import { editionTabLabel, formatSeasonTabLabel } from './media-editor-helpers';
import type { AvailableEdition } from './media-editor-derived';
import type { SeasonMeta } from './media-editor-load';

export interface MediaEditorVersionTabsProps {
  te: Translations['media']['editor'];
  activeLogId: string;
  logs: Record<string, LogState>;
  dispatchEntry: (action: EntryAction) => void;
  externalId: string;
  baseId: string;
  titleMain: string;
  parentGame?: { title: string; externalId: string; cover?: string };
  isUnifiedAnime: boolean;
  isUnifiedEvent: boolean;
  isUnifiedSeries: boolean;
  isBundle: boolean;
  generalLogId: string;
  generalBaseTitle: string;
  animeSeasonChain: SagaEntry[];
  eventSeasons: MediaSeasonInfo[];
  seriesSeasons: MediaSeasonInfo[];
  seasonMetaMap: Record<string, SeasonMeta>;
  allAvailableEditions: AvailableEdition[];
}

export function MediaEditorVersionTabs({
  te, activeLogId, logs, dispatchEntry, externalId, baseId, titleMain, parentGame,
  isUnifiedAnime, isUnifiedEvent, isUnifiedSeries, isBundle, generalLogId, generalBaseTitle,
  animeSeasonChain, eventSeasons, seriesSeasons, seasonMetaMap, allAvailableEditions,
}: MediaEditorVersionTabsProps) {
  if (!(isUnifiedAnime || isUnifiedEvent || isUnifiedSeries || parentGame || allAvailableEditions.length > 0)) return null;

  return (
        <div className="me-versions-tabs">
          {isUnifiedAnime ? (
            <>
              <button
                type="button"
                className={`me-version-tab-btn${activeLogId === generalLogId ? ' active' : ''}`}
                title={generalBaseTitle}
                onClick={() => dispatchEntry({ type: 'SWITCH_LOG', id: generalLogId })}
              >
                {generalBaseTitle}
              </button>
              <span className="me-version-tab-separator">|</span>
              {animeSeasonChain.map(seasonEntry => {
                const isActive = activeLogId === seasonEntry.externalId;
                const sTitle = seasonMetaMap[seasonEntry.externalId]?.title || seasonEntry.title;
                const label = formatSeasonTabLabel(sTitle, generalBaseTitle);
                return (
                  <button
                    key={seasonEntry.externalId}
                    type="button"
                    className={`me-version-tab-btn${isActive ? ' active' : ''}`}
                    title={sTitle}
                    onClick={() => {
                      if (!logs[seasonEntry.externalId]) {
                        dispatchEntry({ type: 'LOAD_LOG', id: seasonEntry.externalId, entry: createEmptyVersionEntry(seasonEntry.externalId, 'anime') });
                      }
                      dispatchEntry({ type: 'SWITCH_LOG', id: seasonEntry.externalId });
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </>
          ) : isUnifiedEvent ? (
            <>
              <button
                type="button"
                className={`me-version-tab-btn${activeLogId === externalId ? ' active' : ''}`}
                title={titleMain}
                onClick={() => dispatchEntry({ type: 'SWITCH_LOG', id: externalId })}
              >
                {titleMain}
              </button>
              <span className="me-version-tab-separator">|</span>
              {eventSeasons.map((season, index) => {
                const seasonId = season.externalId;
                if (!seasonId) return null;
                const isActive = activeLogId === seasonId;
                const label = season.name || `T${eventSeasons.length - index}`;
                return (
                  <button
                    key={seasonId}
                    type="button"
                    className={`me-version-tab-btn${isActive ? ' active' : ''}`}
                    title={label}
                    onClick={() => {
                      if (!logs[seasonId]) {
                        dispatchEntry({ type: 'LOAD_LOG', id: seasonId, entry: createEmptyVersionEntry(seasonId, 'event') });
                      }
                      dispatchEntry({ type: 'SWITCH_LOG', id: seasonId });
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </>
          ) : isUnifiedSeries ? (
            <>
              {/* Unlike anime's general tab, this one is the series' own
                  real entry — fully editable as it's always been, not a
                  derived read-mostly aggregate — so it's just baseId/
                  externalId under a friendlier label, same identity the
                  plain (non-tabbed) form below already edits. */}
              <button
                type="button"
                className={`me-version-tab-btn${activeLogId === baseId ? ' active' : ''}`}
                title={titleMain}
                onClick={() => dispatchEntry({ type: 'SWITCH_LOG', id: baseId })}
              >
                {titleMain}
              </button>
              <span className="me-version-tab-separator">|</span>
              {seriesSeasons.map(season => {
                const seasonId = seriesSeasonExternalId(externalId, season.seasonNumber);
                const isActive = activeLogId === seasonId;
                const label = `T${season.seasonNumber}`;
                return (
                  <button
                    key={seasonId}
                    type="button"
                    className={`me-version-tab-btn${isActive ? ' active' : ''}`}
                    title={season.name || label}
                    onClick={() => {
                      if (!logs[seasonId]) {
                        dispatchEntry({ type: 'LOAD_LOG', id: seasonId, entry: createEmptyVersionEntry(seasonId, 'series') });
                      }
                      dispatchEntry({ type: 'SWITCH_LOG', id: seasonId });
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </>
          ) : (
            <>
              {/* A bundle is never itself trackable (see isBundle's own
                  comment above) — no "Original" tab for it, only its contents. */}
              {!isBundle && (
                <button
                  type="button"
                  className={`me-version-tab-btn${activeLogId === baseId ? ' active' : ''}`}
                  onClick={() => dispatchEntry({ type: 'SWITCH_LOG', id: baseId })}
                >
                  {te.original}
                </button>
              )}
              {allAvailableEditions.map(ed => {
                const isActive = activeLogId === ed.externalId;
                // ed.label is already each edition's (bundle child included)
                // own real title — editionTabLabel just shortens it to
                // whatever follows a colon, same treatment for all of them.
                let tabLabel = editionTabLabel(ed.label, te.edition_default);

                // If it's a REMAKE with the same suffix as the original, label it "Remake"
                if (ed.relationType === 'REMAKE') {
                  const getLastPart = (title: string) => {
                    const idx = title.lastIndexOf(':');
                    return idx === -1 ? '' : title.substring(idx);
                  };
                  const originalTitle = parentGame?.title || titleMain;
                  const originalLast = getLastPart(originalTitle);
                  const editionLast = getLastPart(ed.label);
                  if (originalLast && editionLast && originalLast === editionLast) {
                    tabLabel = te.remake;
                  }
                }

                return (
                  <button
                    key={ed.externalId}
                    type="button"
                    className={`me-version-tab-btn${isActive ? ' active' : ''}`}
                    title={ed.label}
                    onClick={() => {
                      if (!ed.isBundleChild && !ed.isSeasonTab) {
                        const baseLogVal = logs[baseId] || createDefaultLog();
                        const currentVersions = baseLogVal.selectedVersion
                          ? baseLogVal.selectedVersion.split(',')
                          : [];
                        if (!currentVersions.includes(ed.externalId)) {
                          const nextVersions = [...currentVersions, ed.externalId].join(',');
                          dispatchEntry({ type: 'SET_VERSION', value: nextVersions, baseId });
                        }
                      }
                      if (!logs[ed.externalId]) {
                        dispatchEntry({ type: 'LOAD_LOG', id: ed.externalId, entry: createEmptyVersionEntry(ed.externalId, ed.isSeasonTab ? 'anime' : 'game') });
                      }
                      dispatchEntry({ type: 'SWITCH_LOG', id: ed.externalId });
                    }}
                  >
                    {tabLabel}
                  </button>
                );
              })}
            </>
          )}
        </div>
  );
}
