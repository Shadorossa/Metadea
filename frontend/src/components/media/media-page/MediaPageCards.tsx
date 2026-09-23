import { memo, useState } from 'react';
import type { MediaEpisode, MediaTheme } from '../../../lib/tauri';
import { wrapAssetUrl, type FavoriteCustomImage } from '../../../lib/tauri';
import type { EventMatch } from '../../../lib/search/providers/apisports';
import type { FriendScore } from '../../../lib/anilist/friends';
import { formatRatingHtml, type RatingSystem } from '../../../lib/media/rating-utils';
import { openLink } from '../MediaStoreLinks';
import { ThemePreviewCardVideo } from '../ThemePreviewCardVideo';
import { toMediumCover } from '../../../lib/media/small-cover';
import { formatEpisodeNumber, formatMatchDate, splitTitleAfterColon } from './media-page-format';
import { SpoilerChip } from '../../spoilers/SpoilerShield';
import { getT } from '../../../i18n/runtime';
import { interpolate } from '../../../lib/shared/text/interpolate';
import type { FillerKind } from '../../../lib/anime/filler';
import { EpisodeFillerBadge, fillerCardClass, fillerCardTitle } from './EpisodeFillerBadge';

// `onRevealSpoiler` is set while the spoiler shield hides this episode (past
// the user's progress): the still is blurred and the title becomes a plain
// "Episode 16" — the number stays, the real title is not even in the DOM.
// `fillerKind` is the episode's AnimeFillerList category (EpisodeFillerBadge).
export const EpisodeCard = memo(function EpisodeCard({ ep, onRevealSpoiler, fillerKind }: { ep: MediaEpisode; onRevealSpoiler?: () => void; fillerKind?: FillerKind | null }) {
  const episodeLabel = ep.display_label ?? formatEpisodeNumber(ep.episode_number);
  const title = onRevealSpoiler
    ? interpolate(getT().spoilers.episode_placeholder, { episode: episodeLabel })
    : ep.name ?? `#${episodeLabel}`;
  return (
    <div className={`media-relation-card media-relation-card--static${fillerCardClass(fillerKind)}`} title={fillerCardTitle(fillerKind)}>
      <EpisodeFillerBadge kind={fillerKind} />
      <div className="media-relation-bg-layer media-episode-bg-layer">
        {ep.cover_url && <img className={onRevealSpoiler ? 'spoiler-blur' : undefined} src={ep.cover_url} alt="" loading="lazy" decoding="async" />}
      </div>
      <div className="media-relation-card-overlay" />
      <span className="media-relation-type">{`#${episodeLabel}`}</span>
      <div className="media-relation-card-content">
        <div className="media-relation-info">
          <span className="media-relation-title">{title}</span>
        </div>
      </div>
      {onRevealSpoiler && <SpoilerChip onReveal={onRevealSpoiler} className="spoiler-shield-chip--episode" />}
    </div>
  );
});

export const MatchCard = memo(function MatchCard({ match }: { match: EventMatch }) {
  const home = match.home || '-';
  const away = match.away || '-';
  const hasScore = match.homeScore != null && match.awayScore != null;
  return (
    <div className="media-relation-card media-relation-card--static media-match-card">
      <div className="media-relation-bg-layer">
        {match.image && <img src={match.image} alt="" loading="lazy" decoding="async" />}
      </div>
      <div className="media-relation-card-overlay" />
      <span className="media-relation-type">{formatMatchDate(match.date, match.time)}</span>
      <div className="media-relation-card-content">
        <div className="media-relation-info">
          <span className="media-relation-title">{home} – {away}</span>
          <span className="media-match-score">{hasScore ? `${match.homeScore} - ${match.awayScore}` : (match.status || 'vs')}</span>
          {match.venue && <span className="media-match-venue">{match.venue}</span>}
        </div>
      </div>
    </div>
  );
});

// The subset of a relation row the card actually paints — every caller's
// relation shape (page relations, comic issues, bundle children) carries at
// least these.
export interface RelationCardData {
  url?: string | null;
  cover?: string | null;
  typeLabel?: string | null;
  title: string;
}

// `onRevealCover` is set while the spoiler shield blurs this card's cover
// (a later season the user hasn't reached, with "hide covers" on).
export const RelationCard = memo(function RelationCard({ relation, changeKind, onRevealCover }: { relation: RelationCardData; changeKind?: 'added' | 'updated'; onRevealCover?: () => void }) {
  const Wrapper = relation.url ? 'a' : 'div';
  // A grid thumbnail (and its blurred backdrop, which shares the same
  // request) never needs the full-size cover the hero shows.
  const cover = relation.cover ? toMediumCover(relation.cover) : null;
  return (
    <Wrapper
      href={relation.url ?? undefined}
      className={`media-relation-card${relation.url ? '' : ' media-relation-card--static'}${changeKind ? ` media-relation-card--${changeKind}` : ''}`}
    >
      <div className="media-relation-bg-layer">
        {cover && <img className={onRevealCover ? 'spoiler-blur' : undefined} src={cover} alt="" loading="lazy" decoding="async" />}
      </div>
      <div className="media-relation-card-overlay" />
      <span className="media-relation-type">{relation.typeLabel}</span>
      <div className="media-relation-card-content">
        <div className={`media-relation-thumb${onRevealCover ? ' spoiler-blur' : ''}`}>
          {cover && <img src={cover} alt={relation.title} loading="lazy" decoding="async" />}
        </div>
        <div className="media-relation-info">
          <span className="media-relation-title">{splitTitleAfterColon(relation.title)}</span>
        </div>
      </div>
      {onRevealCover && cover && (
        <SpoilerChip onReveal={onRevealCover} element={relation.url ? 'span' : 'button'} className="spoiler-shield-chip--corner" />
      )}
    </Wrapper>
  );
});

export interface CharacterCardData {
  id?: string | null;
  hrefId?: string | null;
  name: string;
  role?: string | null;
  image?: string | null;
}

interface CharacterCardProps {
  character: CharacterCardData;
  charTab: 'characters' | 'staff';
  customImagesMap: Map<string, FavoriteCustomImage>;
  /** Set while the spoiler shield blurs this character (a late debut:
   *  absent from every work the user has started). */
  onRevealSpoiler?: () => void;
}

export const CharacterCard = memo(function CharacterCard({ character: c, charTab, customImagesMap, onRevealSpoiler }: CharacterCardProps) {
  const hrefId = c.hrefId || c.id;
  const href = hrefId
    ? (charTab === 'staff' ? `/author?id=${encodeURIComponent(hrefId)}` : `/character?id=${encodeURIComponent(hrefId)}`)
    : undefined;
  const customImg = c.id ? customImagesMap.get(c.id) : undefined;
  const displayImg = customImg ? wrapAssetUrl(customImg.image_url) : c.image;

  return (
    <a href={href} className="media-char-card">
      <div className={`media-char-bg-layer${onRevealSpoiler ? ' spoiler-blur' : ''}`}>
        {displayImg && <img src={displayImg} alt="" loading="lazy" decoding="async" />}
      </div>
      <div className="media-char-card-overlay" />
      <div className="media-char-card-content">
        <div className={`media-char-thumb${onRevealSpoiler ? ' spoiler-blur' : ''}`}>
          {displayImg && <img src={displayImg} alt={c.name} loading="lazy" decoding="async" />}
        </div>
        <div className="media-char-info">
          {c.role && <span className="media-char-role">{c.role}</span>}
          <span className="media-char-name">{c.name}</span>
        </div>
      </div>
      {onRevealSpoiler && displayImg && (
        <SpoilerChip onReveal={onRevealSpoiler} element="span" className="spoiler-shield-chip--corner" />
      )}
    </a>
  );
});

interface UserScoreCardProps {
  score: FriendScore;
  ratingSystem: RatingSystem;
}

export const UserScoreCard = memo(function UserScoreCard({ score: f, ratingSystem }: UserScoreCardProps) {
  return (
    <div className="media-user-card" data-tooltip={f.name}>
      <button
        type="button"
        className="media-user-avatar"
        onClick={() => openLink(f.profileUrl)}
        title={f.name}
      >
        {f.avatar
          ? <img className="cover-image-fill" src={f.avatar} alt="" loading="lazy" />
          : <div className="media-user-avatar-placeholder">{f.name[0]?.toUpperCase()}</div>}
      </button>
      <span dangerouslySetInnerHTML={{ __html: formatRatingHtml(f.score / 10, ratingSystem, 'media-user-score') }} />
    </div>
  );
});

export function ThemeCardItem({
  theme,
  onPlay,
  fallbackUrl,
}: {
  theme: MediaTheme;
  onPlay: () => void;
  fallbackUrl?: string;
}) {
  const [isHovered, setIsHovered] = useState(false);
  return (
    <div
      className={`media-relation-card media-relation-card--static media-theme-card${theme.video_url ? ' media-theme-card--playable' : ''}`}
      onClick={() => theme.video_url && onPlay()}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="media-relation-bg-layer media-theme-bg-layer">
        <ThemePreviewCardVideo
          externalId={theme.external_id}
          slug={theme.slug}
          src={theme.video_url ?? undefined}
          initialPreviewUrl={theme.preview_url ?? undefined}
          fallbackUrl={fallbackUrl}
          isHovered={isHovered}
        />
      </div>
      <div className="media-relation-card-overlay" />
      <span className={`media-relation-type media-theme-badge media-theme-badge--${theme.theme_type.toLowerCase()}`}>
        {theme.theme_type}{theme.sequence}
      </span>
      <div className="media-relation-card-content">
        <div className="media-relation-info">
          <span className="media-relation-title">{theme.song_title ?? `${theme.theme_type}${theme.sequence}`}</span>
          {theme.artists && <span className="media-theme-artist">{theme.artists}</span>}
        </div>
      </div>
    </div>
  );
}
