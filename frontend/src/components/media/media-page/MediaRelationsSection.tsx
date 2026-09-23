import type { Dispatch, ReactNode, SetStateAction } from 'react';
import type { EpisodeFillerView } from './useEpisodeFiller';
import type { Translations } from '../../../i18n/index';
import type { MediaEpisode, MediaTheme } from '../../../lib/tauri';
import type { MediaPageData } from '../../../lib/media/types';
import type { SagaEntry } from '../../../lib/anilist/saga';
import type { EventMatch } from '../../../lib/search/providers/apisports';
import { bucketRelations } from '../../../lib/media/media-page-data';
import { stripSeasonSuffix } from '../../../lib/media/mappers/mapper-utils';
import { MediaStoreLinks } from '../MediaStoreLinks';
import { GGDEALS_MEDIA_TYPES, ggDealsLink } from '../../../lib/media/ggdeals-link';
import { Pagination } from '../Pagination';
import { EpisodeCard, MatchCard, RelationCard, ThemeCardItem } from './MediaPageCards';
import { SectionTabs } from './MediaPageControls';
import type { MediaSpoilers } from './useMediaSpoilers';

export type RelationsTab = 'related' | 'recommended' | 'editions' | 'episodes' | 'matches' | 'seasons' | 'themes';

// .media-relations-grid is a fixed 4-column grid — 3 rows worth per page.
export const EPISODE_PAGE_SIZE = 12;

interface Props {
  data: MediaPageData;
  currentId: string;
  previewMode: boolean;
  previewAddedRelationIds: string[];
  previewUpdatedRelationIds: string[];
  t: Translations['media'];
  relationsTab: RelationsTab;
  setRelationsTab: Dispatch<SetStateAction<RelationsTab>>;
  relationPage: number;
  setRelationPage: Dispatch<SetStateAction<number>>;
  episodes: MediaEpisode[];
  themes: MediaTheme[];
  matches: EventMatch[];
  animeSeasonChain: SagaEntry[];
  showsSeasonsTab: boolean;
  isEventCompetition: boolean;
  hasEpisodes: boolean;
  hasThemes: boolean;
  displayCover: string | null;
  onPlayTheme: (theme: MediaTheme) => void;
  /** Spoiler shield answers for this page (absent: nothing hidden). */
  spoilers?: MediaSpoilers;
  /** AnimeFillerList data for the episodes tab (absent: no badges). */
  filler?: { view: EpisodeFillerView; toolbar: ReactNode; footer: ReactNode };
}

export function MediaRelationsSection({
  data,
  currentId,
  previewMode,
  previewAddedRelationIds,
  previewUpdatedRelationIds,
  t: tm,
  relationsTab,
  setRelationsTab,
  relationPage,
  setRelationPage,
  episodes,
  themes,
  matches,
  animeSeasonChain,
  showsSeasonsTab,
  isEventCompetition,
  hasEpisodes,
  hasThemes,
  displayCover,
  onPlayTheme,
  spoilers,
  filler,
}: Props) {
  const isComicOrHasIssues = data.type === 'comic' || (Array.isArray(data.relations) && data.relations.some(r => r.relationType === 'ISSUE'));
  const editionsLabel = isComicOrHasIssues ? tm.relations.ISSUE : tm.relations.EDITIONS;
  const editionsRelationType = isComicOrHasIssues ? 'ISSUE' : 'EDITIONS';
  const {
    related: relatedRelationsRaw,
    recommended: recommendedRelations,
    editions: editionRelations,
  } = bucketRelations(data.relations, data.format, editionsRelationType);
  // With the "Unificar temporadas" setting on, an anime's own PREQUEL/SEQUEL
  // rows move to the Temporadas tab instead of sitting in Relacionados —
  // with it off (or for every other media type), Relacionados is untouched,
  // exactly as it's always been.
  const relatedRelations = showsSeasonsTab
    ? relatedRelationsRaw.filter(r => r.relationType !== 'PREQUEL' && r.relationType !== 'SEQUEL')
    : relatedRelationsRaw;
  const hasRecommendedRelations = recommendedRelations.length > 0;
  const hasEditionRelations     = editionRelations.length > 0;
  const hasMatches              = data.type === 'event' && matches.length > 0;
  const tmdbSeasons             = data.type === 'series' ? (data.seasons ?? []) : [];
  const eventSeasons            = isEventCompetition ? (data.seasons ?? []) : [];
  const hasSeasonsTab            = showsSeasonsTab
    ? animeSeasonChain.length > 1
    : isEventCompetition
    ? eventSeasons.length > 0
    : tmdbSeasons.length > 0;
  const storeLinks = data.storeLinks ?? [];
  const ggDeals = GGDEALS_MEDIA_TYPES.includes(data.type) && data.titleMain
    ? { url: ggDealsLink({ title: data.titleMain, storeLinks }), label: tm.ggdeals_link }
    : undefined;
  const hasTabs = hasRecommendedRelations || hasEditionRelations || hasEpisodes || hasMatches || hasSeasonsTab || hasThemes;
  const visibleRelations = relationsTab === 'recommended'
    ? recommendedRelations
    : relationsTab === 'editions'
    ? editionRelations
    : relatedRelations;
  const pageSize = relationsTab === 'recommended' ? 8 : 12;

  return (
        <div className="media-col-related">
          <div className="media-section-header-row">
            {/* TMDB recommendations ride in the same list as real
                relations (saga/adaptation/etc) — when both are present,
                each label becomes a tab switching which subset the grid
                below shows, instead of mixing recommendations into
                "Related". */}
            <SectionTabs
              fallbackLabel={tm.section_related}
              tabs={hasTabs ? [
                { key: 'related', label: tm.section_related, active: relationsTab === 'related', onClick: () => { setRelationsTab('related'); setRelationPage(1); } },
                ...(hasEditionRelations ? [{ key: 'editions', label: editionsLabel, active: relationsTab === 'editions', onClick: () => { setRelationsTab('editions'); setRelationPage(1); } }] : []),
                ...(hasRecommendedRelations ? [{ key: 'recommended', label: tm.relations.RECOMMENDATION, active: relationsTab === 'recommended', onClick: () => { setRelationsTab('recommended'); setRelationPage(1); } }] : []),
                ...(hasSeasonsTab ? [{ key: 'seasons', label: tm.stat_seasons, active: relationsTab === 'seasons', onClick: () => { setRelationsTab('seasons'); setRelationPage(1); } }] : []),
                ...(hasEpisodes ? [{ key: 'episodes', label: tm.stat_episodes, active: relationsTab === 'episodes', onClick: () => { setRelationsTab('episodes'); setRelationPage(1); } }] : []),
                ...(hasMatches ? [{ key: 'matches', label: tm.stat_matches, active: relationsTab === 'matches', onClick: () => { setRelationsTab('matches'); setRelationPage(1); } }] : []),
                ...(hasThemes ? [{ key: 'themes', label: tm.section_themes, active: relationsTab === 'themes', onClick: () => { setRelationsTab('themes'); setRelationPage(1); } }] : []),
              ] : []}
            />
            {(storeLinks.length > 0 || ggDeals) && (
              <MediaStoreLinks links={storeLinks} ggDeals={ggDeals} />
            )}
          </div>
          {relationsTab === 'themes' ? (
            themes.length > 0 && (
              <>
                <div className="media-relations-grid">
                  {themes
                    .slice((relationPage - 1) * EPISODE_PAGE_SIZE, relationPage * EPISODE_PAGE_SIZE)
                    .map(t => (
                      <ThemeCardItem
                        key={`${t.external_id || currentId}-${t.theme_type}-${t.sequence}-${t.slug}`}
                        theme={t}
                        onPlay={() => onPlayTheme(t)}
                        fallbackUrl={data.bannerImage || displayCover || undefined}
                      />
                    ))}
                </div>
                {themes.length > EPISODE_PAGE_SIZE && (
                  <Pagination
                    currentPage={relationPage}
                    totalPages={Math.ceil(themes.length / EPISODE_PAGE_SIZE)}
                    onChange={setRelationPage}
                  />
                )}
              </>
            )
          ) : relationsTab === 'matches' ? (
            matches.length > 0 && (
              <>
                <div className="media-relations-grid">
                  {matches
                    .slice((relationPage - 1) * EPISODE_PAGE_SIZE, relationPage * EPISODE_PAGE_SIZE)
                    .map(match => <MatchCard key={match.id} match={match} />)}
                </div>
                {matches.length > EPISODE_PAGE_SIZE && (
                  <Pagination
                    currentPage={relationPage}
                    totalPages={Math.ceil(matches.length / EPISODE_PAGE_SIZE)}
                    onChange={setRelationPage}
                  />
                )}
              </>
            )
          ) : relationsTab === 'seasons' ? (
            // Reuses RelationCard (cover + title + a small top label) for both
            // sources — an anime's own chain member gets "T{n}" (or "Estás
            // aquí" on whichever one is the page currently open, same label
            // SagaViewerModal already uses), a TMDB season gets its own
            // TMDB-provided poster instead of the series' main cover.
            (showsSeasonsTab ? animeSeasonChain.length > 0 : isEventCompetition ? eventSeasons.length > 0 : tmdbSeasons.length > 0) && (
              isEventCompetition ? (
                <>
                  <div className="media-relations-grid">
                    {eventSeasons
                      .slice((relationPage - 1) * EPISODE_PAGE_SIZE, relationPage * EPISODE_PAGE_SIZE)
                      .map(season => (
                        <RelationCard
                          key={season.externalId ?? season.seasonNumber}
                          relation={{
                            url: season.externalId ? `/media?id=${encodeURIComponent(season.externalId)}` : undefined,
                            cover: season.coverUrl,
                            typeLabel: tm.stat_season,
                            title: season.name || `${tm.stat_seasons} ${season.seasonNumber}`,
                          }}
                        />
                      ))}
                  </div>
                  {eventSeasons.length > EPISODE_PAGE_SIZE && (
                    <Pagination
                      currentPage={relationPage}
                      totalPages={Math.ceil(eventSeasons.length / EPISODE_PAGE_SIZE)}
                      onChange={setRelationPage}
                    />
                  )}
                </>
              ) : (
                <div className="media-relations-grid">
                  {showsSeasonsTab
                    ? animeSeasonChain.map((entry, i) => (
                        <RelationCard
                          key={entry.externalId}
                          onRevealCover={spoilers?.isRelatedCoverHidden(entry.externalId, animeSeasonChain.slice(0, i).map(e => e.externalId))
                            ? () => spoilers.revealRelatedCover(entry.externalId)
                            : undefined}
                          relation={{
                            url: `/media?id=${encodeURIComponent(entry.externalId)}`,
                            cover: entry.cover,
                            typeLabel: `${tm.stat_season} ${i + 1}`,
                            // The badge above already says which season this
                            // is - stripSeasonSuffix hides "2nd Season"/"The
                            // Final Season" wording from the title itself
                            // instead of showing it twice.
                            title: stripSeasonSuffix(entry.title),
                          }}
                        />
                      ))
                    : tmdbSeasons.map(season => (
                        <RelationCard
                          key={season.seasonNumber}
                          relation={{
                            cover: season.coverUrl,
                            typeLabel: `${tm.stat_season} ${season.seasonNumber}`,
                            title: season.name || `${tm.stat_seasons} ${season.seasonNumber}`,
                          }}
                        />
                      ))}
                </div>
              )
            )
          ) : relationsTab === 'episodes' ? (
            episodes.length > 0 && (() => {
              const regularEps = episodes
                .filter(e => e.episode_number > 0)
                .filter(e => !filler?.view.hideFiller || filler.view.kindOf(e) !== 'filler')
                .sort((a, b) => a.episode_number - b.episode_number);
              const specialEps = episodes
                .filter(e => e.episode_number < 0)
                .sort((a, b) => Math.abs(a.episode_number) - Math.abs(b.episode_number));

              const regularPages = Math.ceil(regularEps.length / EPISODE_PAGE_SIZE);
              const specialPages = Math.ceil(specialEps.length / EPISODE_PAGE_SIZE);
              const totalEpPages = regularPages + specialPages;

              let pageEpisodes: MediaEpisode[];
              if (relationPage <= regularPages) {
                const start = (relationPage - 1) * EPISODE_PAGE_SIZE;
                pageEpisodes = regularEps.slice(start, start + EPISODE_PAGE_SIZE);
              } else {
                const spPage = relationPage - regularPages;
                const start = (spPage - 1) * EPISODE_PAGE_SIZE;
                pageEpisodes = specialEps.slice(start, start + EPISODE_PAGE_SIZE);
              }

              return (
                <>
                  {filler?.toolbar}
                  <div className="media-relations-grid">
                    {pageEpisodes.map(ep => (
                      <EpisodeCard
                        key={`${ep.external_id || currentId}-${ep.season_number}-${ep.episode_number}`}
                        ep={ep}
                        onRevealSpoiler={spoilers?.isEpisodeHidden(ep) ? () => spoilers.revealEpisode(ep) : undefined}
                        fillerKind={filler?.view.kindOf(ep)}
                      />
                    ))}
                  </div>
                  {totalEpPages > 1 && (
                    <Pagination
                      currentPage={relationPage}
                      totalPages={totalEpPages}
                      onChange={setRelationPage}
                      formatPage={p => {
                        if (p <= regularPages) return String(p);
                        return `SP${p - regularPages}`;
                      }}
                    />
                  )}
                  {filler?.footer}
                </>
              );
            })()
          ) : visibleRelations.length > 0 && (
            <>
              <div className="media-relations-grid">
                {visibleRelations
                  .slice((relationPage - 1) * pageSize, relationPage * pageSize)
                  .map((r, i) => (
                    <RelationCard
                      key={r.url ?? `${r.typeLabel}-${r.title}-${i}`}
                      relation={r}
                      onRevealCover={spoilers?.isRelatedCoverHidden(r.relatedExternalId)
                        ? () => spoilers.revealRelatedCover(r.relatedExternalId ?? '')
                        : undefined}
                      changeKind={previewMode && r.relatedExternalId
                        ? previewAddedRelationIds.includes(r.relatedExternalId)
                          ? 'added'
                          : previewUpdatedRelationIds.includes(r.relatedExternalId) ? 'updated' : undefined
                        : undefined}
                    />
                  ))}
              </div>
              {visibleRelations.length > pageSize && (
                <Pagination
                  currentPage={relationPage}
                  totalPages={Math.ceil(visibleRelations.length / pageSize)}
                  onChange={setRelationPage}
                />
              )}
            </>
          )}
        </div>
  );
}
