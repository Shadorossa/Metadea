import type { RefObject } from 'react';
import type { Translations } from '../../../i18n/index';
import type { MediaPageData } from '../../../lib/media/types';
import { CONTAINS_RELATION_TYPES } from '../../../lib/media/saga/saga-relation-types';
import { IconPlus, IconCheck, IconLayers, IconHeart, IconRefresh, IconLink } from '../../local/ui/icons';
import { getT } from '../../../i18n/runtime';
import { StarRating, StatusDropdown } from './MediaPageControls';
import { CompanyName, PublisherLine } from './CompanyLinks';
import { CoverImage } from '../../shared/CoverImage';
import { SpoilerChip } from '../../spoilers/SpoilerShield';

interface Props {
  data: MediaPageData;
  currentId: string;
  previewMode: boolean;
  t: Translations['media'];
  titleRef: RefObject<HTMLHeadingElement | null>;
  displayCover: string | null;
  showsSeasonsTab: boolean;
  mediaInLibrary: boolean;
  isFavorited: boolean;
  retryingSync: boolean;
  eventAggregateStatus: string;
  eventAggregateRating: number;
  onProposeChanges: () => void;
  onRetrySync: () => void;
  onCopyLink: () => void;
  onOpenSaga: () => void;
  onCoverClick: () => void;
  onToggleFavorite: () => void;
  onStatusChange: (next: string) => void;
  onRate: (stars: number) => void;
  /** Set while the spoiler shield blurs this cover (a later, unstarted
   *  season with the "hide covers" setting on): reveals it. */
  coverSpoiler?: () => void;
}

export function MediaHero({
  data,
  currentId,
  previewMode,
  t: tm,
  titleRef,
  displayCover,
  showsSeasonsTab,
  mediaInLibrary,
  isFavorited,
  retryingSync,
  eventAggregateStatus,
  eventAggregateRating,
  onProposeChanges,
  onRetrySync,
  onCopyLink: handleCopyLink,
  onOpenSaga,
  onCoverClick: handleCoverClick,
  onToggleFavorite: handleToggleFavorite,
  onStatusChange: handleStatusChange,
  onRate: handleRate,
  coverSpoiler,
}: Props) {
  // Only certain edition types get redirected to their base game and blocked
  // from being logged separately. Expansions are allowed as independent entries
  // since they're typically sold and played separately (e.g., RE4 Separate Ways).
  const isBlockedEdition = !!data.parentGame && data.format !== 'EXPANSION';
  // API-Sports competitions have their own base entry and child season pages.
  // Each season keeps its own matches and progress entry.
  // A bundle (e.g. "The Great Ace Attorney Chronicles") isn't a playable
  // title on its own — its contained works are — so it gets the same
  // "can't be logged/edited here" treatment as a blocked edition, just with
  // its own banner text instead of "is a version of {title}" (a bundle
  // doesn't have one single parent to point back to). Detected from having
  // at least two CONTAINS (EPISODE) relations of its own rather than from
  // `data.format === 'BUNDLE'` — an already-cataloged container can be stuck
  // with a stale format from before that value existed (persistToCatalog
  // preserves an existing format rather than recomputing it), so the
  // relation itself is the only reliable signal.
  const isBundle = data.relations.filter(r => !!r.relationType && CONTAINS_RELATION_TYPES.includes(r.relationType)).length >= 2;
  const isUneditable = isBlockedEdition || isBundle;
  const developer = data.companies?.find(c => c.role === 'developer');
  // "Copy link" lives in MediaPage (handleCopyLink) so the `l` shortcut and
  // this button share one handler.
  const deepLinkText = getT().deep_link;
  const bannerStyle = !data.bannerImage
    ? ({ '--banner-color': data.bannerColor } as React.CSSProperties)
    : undefined;

  return (
      <div className={`media-hero${data.type === 'game' || data.type === 'vnovel' ? ' media-hero--game' : ''}`}>
        <div
          className={data.bannerImage ? 'media-banner' : 'media-banner media-banner--color'}
          style={bannerStyle}
        >
          {data.bannerImage && (
            <img className="media-banner-img" src={data.bannerImage} alt="" loading="lazy" />
          )}
        </div>

        <div className="media-banner-badges-container">
          {data.dateBadge && (
            <div className="media-banner-date-badge">{data.dateBadge}</div>
          )}
          {!previewMode && (
            <button
              type="button"
              className="media-banner-pr-btn"
              onClick={onProposeChanges}
              title={tm.propose_github_changes}
            >
              <IconPlus />
            </button>
          )}
          {!previewMode && (
            <button
              type="button"
              className={`media-banner-pr-btn${retryingSync ? ' media-banner-pr-btn--spinning' : ''}`}
              onClick={onRetrySync}
              disabled={retryingSync}
              title={tm.retry_sync}
            >
              <IconRefresh />
            </button>
          )}
          {!previewMode && (
            <button
              type="button"
              className="media-banner-pr-btn"
              onClick={handleCopyLink}
              title={deepLinkText.copy_link}
            >
              <IconLink />
            </button>
          )}
        </div>
        {developer && (
          <div className="media-banner-developer-badge">
            <CompanyName company={developer} mediaType={data.type} />
          </div>
        )}

        <div className="media-hero-body">
          {/* Izquierda: títulos */}
          <div className="media-hero-left">
            <h1 className="media-title-main" ref={titleRef}>{data.titleMain}</h1>
            {/* Prefer the native-script title (Japanese kanji/kana, ...) —
                fall back to the romaji title only when it's missing and
                actually differs from the main heading above (titleMain is
                usually the romaji itself, so showing it again as a subtitle
                would just repeat the same text). Both come straight from the
                catalog row (title_native/title_romaji), no live fetch needed. */}
            {data.titleNative
              ? <p className="media-title-native">{data.titleNative}</p>
              : (data.titleRomaji && data.titleRomaji !== data.titleMain)
                ? <p className="media-title-native">{data.titleRomaji}</p>
                : null}
            {data.titleEnglish && <p className="media-title-english">{data.titleEnglish}</p>}
          </div>

          {/* Centro: cover + widget de biblioteca */}
          <div className="media-cover-column">
            {/* Hidden (not removed) once the Temporadas tab takes over this
                same job for anime — SagaViewerModal itself is untouched and
                still opens normally for every other media type. */}
            {!previewMode && data.hasSaga && !showsSeasonsTab && (
              <button type="button" className="media-saga-btn" onClick={onOpenSaga}>
                <IconLayers size={14} />
                {tm.saga_button}
              </button>
            )}
            <div className="media-cover-frame">
            <div
              className={`media-cover-wrap${mediaInLibrary ? ' in-library' : ''}${isUneditable ? ' is-edition' : ''}${previewMode ? ' is-preview' : ''}`}
              role={previewMode ? undefined : 'button'}
              tabIndex={previewMode ? undefined : 0}
              aria-label={isBlockedEdition
                ? tm.is_version_of.replace('{title}', data.parentGame!.title)
                : isBundle
                ? tm.is_bundle
                : tm.add_to_library.replace('\n', ' ')}
              onClick={() => {
                if (previewMode) return;
                if (isBlockedEdition) {
                  window.location.href = `/media?id=${encodeURIComponent(data.parentGame!.externalId)}&openEditor=true&subId=${encodeURIComponent(currentId)}`;
                  return;
                }
                if (isBundle) return;
                handleCoverClick();
              }}
              onKeyDown={e => !previewMode && (e.key === 'Enter' || e.key === ' ') && (
                isBlockedEdition
                  ? (window.location.href = `/media?id=${encodeURIComponent(data.parentGame!.externalId)}&openEditor=true&subId=${encodeURIComponent(currentId)}`)
                  : isBundle
                  ? undefined
                  : handleCoverClick()
              )}
            >
              {displayCover && (
                <CoverImage externalId={data.externalId} className={`media-cover-img cover-image-fill${coverSpoiler ? ' spoiler-blur' : ''}`} src={displayCover} alt={data.titleMain} />
              )}
              <div className="media-cover-overlay">
                <div className="media-cover-overlay-inner">
                  {isBlockedEdition ? (
                    <span className="media-cover-overlay-label">
                      {tm.is_version_of.replace('{title}', data.parentGame!.title)}
                    </span>
                  ) : isBundle ? (
                    <span className="media-cover-overlay-label">{tm.is_bundle}</span>
                  ) : (
                    <>
                      <span className="media-cover-overlay-icon">
                        {mediaInLibrary ? <IconCheck size={22} strokeWidth={2.5} /> : <IconPlus size={22} strokeWidth={2.5} />}
                      </span>
                      <span
                        className="media-cover-overlay-label"
                        dangerouslySetInnerHTML={{
                          __html: (mediaInLibrary ? tm.in_library : tm.add_to_library).replace('\n', '<br>'),
                        }}
                      />
                    </>
                  )}
                </div>
              </div>
            </div>
              {/* Outside the cover button: revealing must not open the editor. */}
              {coverSpoiler && displayCover && <SpoilerChip onReveal={coverSpoiler} />}
              {!previewMode && (
                // Same dual write MediaEditorModal's own heart button makes
                // on save (saveLibraryEntry's is_favorite column, then
                // syncFavorites for the separate favorites list) — this
                // started bundle-only (no library entry/editor of its own to
                // hold that button at all) doing just the syncFavorites half,
                // but favoriting straight from the cover is useful for every
                // media type, and needs the same is_favorite write the editor
                // makes or whatever elsewhere treats that column as the
                // source of truth never sees it. handleEditorSaved/Deleted
                // keep isFavorited in sync with the editor's own toggle too.
                // Lives outside .media-cover-wrap (not inside it) specifically
                // so it can straddle the cover's own bottom edge — that
                // wrap's overflow:hidden (it clips its own hover overlay)
                // would otherwise clip half the button off.
                <button
                  type="button"
                  className={`media-cover-favorite-btn${isFavorited ? ' active' : ''}`}
                  onClick={e => {
                    e.stopPropagation();
                    handleToggleFavorite();
                  }}
                  title={tm.editor.favorite}
                >
                  <IconHeart filled={isFavorited} size={18} />
                </button>
              )}
            </div>

            {!previewMode && !isUneditable && (
            <div className="media-library-widget-box">
              <div className="media-library-row-horizontal">
                <StatusDropdown
                  status={eventAggregateStatus}
                  progressStatus={data.progressStatus}
                  progressLabel={data.progressLabel}
                  onChange={handleStatusChange}
                  t={tm}
                />
                <StarRating rating={eventAggregateRating} onRate={handleRate} t={tm} />
              </div>
            </div>
            )}
          </div>

          {/* Derecha: géneros + meta */}
          <div className="media-hero-right">
            {(data.genreDots || data.genreTagDots) && (
              <div className="media-genres-row">
                {data.genreDots    && <span className="media-genres-dots">{data.genreDots}</span>}
                {data.genreTagDots && <span className="media-genres-tags">{data.genreTagDots}</span>}
              </div>
            )}
            {data.metaLines?.[0] && <PublisherLine line={data.metaLines[0]} companies={data.companies} mediaType={data.type} />}
            {data.metaLines?.[1] && <p className="media-cover-meta">{data.metaLines[1]}</p>}
            {data.metaLines?.[2] && <p className="media-cover-meta">{data.metaLines[2]}</p>}
          </div>
        </div>
      </div>
  );
}
