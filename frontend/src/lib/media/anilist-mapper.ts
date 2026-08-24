import type { AniListMediaDetail, AniListStaffEdge, AniListCharacterEdge } from '../search/providers/anilist';
import { getT } from '../../i18n/client';
import type { MediaPageData, MediaRelation, MediaAuthor, MediaCompany, MediaStat, MediaCharacter } from './types';
import { unifyGenres } from './genre-unifier';
import { formatDateParts, normalizeScore100, lookupLabel, countryName } from './mapper-utils';
import { canonicalizeAniListStatus, STATUS_BADGE_CLASS } from './media-status';
import { CANONICAL_RELATION_LABELS as canonicalRelationLabels } from './canonical-relations';
import { isReadingType } from '../constants/media';

// Matches media-relations.ts's RELATION_SORT_PRIORITY — only PARENT/SOURCE
// (the original work) sort before Prequel/Sequel; ADAPTATION (the
// derivative) sorts after them. This is only the transient pre-persist
// fetch order though — sortRelationsForDisplay re-sorts by the final,
// possibly-normalized relation_type at display/read time regardless.
const RELATION_PRIORITY: Record<string, number> = {
  PARENT: 1, SOURCE: 1, PREQUEL: 2, SEQUEL: 3, ADAPTATION: 4,
  SPIN_OFF: 5, ALTERNATIVE: 6, SUMMARY: 7,
};

// Shared with mediaService.ts's fetchExtraCharacters — the background
// top-up fetch for a large cast (see fetchAniListRemainingCharacters) maps
// its extra edges through this exact same function instead of a second,
// divergent copy of this logic.
export function mapAniListCharacterEdges(edges: AniListCharacterEdge[]): MediaCharacter[] {
  return edges.map(e => ({
    id:    e.node.id ? `character:a:${e.node.id}` : undefined,
    name:  e.node.name.full,
    // Prefer large — this seeds that character's own local DB row via
    // saveCharactersSkeleton, which becomes the sticky-preferred portrait
    // on that character's own (much bigger) page, not just this small grid
    // card, so `medium` alone looked pixelated there.
    image: e.node.image.large ?? e.node.image.medium ?? undefined,
    role:  e.role,
  }));
}

function formatDescription(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  // Convert physical newlines to <br> first
  let cleaned = raw.replace(/\r?\n/g, '<br>');
  // Replace consecutive <br> tags (with optional spaces/newlines inside/around them) with a single <br>
  cleaned = cleaned.replace(/(?:\s*<br\s*\/?>\s*)+/gi, '<br>');
  // Apply Source metadata styling
  return cleaned.replace(
    /\(Source:\s*([^)]+)\)/g,
    '<span class="media-description-source">&nbsp;&nbsp;—&nbsp;Source: $1</span>'
  );
}

export function resolveAniListType(mediaType: string, format: string | null | undefined): string {
  if (mediaType === 'manga' && format === 'NOVEL') return 'lnovel';
  if (mediaType === 'lnovel') return 'lnovel';
  return mediaType;
}

export function mapAniListToMedia(raw: AniListMediaDetail, mediaType: string): MediaPageData {
  const tm = getT().media;
  const resolvedType = resolveAniListType(mediaType, raw.format);

  const titleMain   = raw.title.romaji ?? raw.title.english ?? raw.title.native ?? '—';
  const titleNative = raw.title.native   && raw.title.native   !== titleMain ? raw.title.native   : undefined;
  const titleEnglish = raw.title.english && raw.title.english !== titleMain ? raw.title.english : undefined;
  // Always the real romaji, even when it's also titleMain — the catalog row
  // needs its own copy independent of whichever title got picked as the
  // page's headline.
  const titleRomaji = raw.title.romaji ?? undefined;

  const cover      = raw.coverImage?.extraLarge ?? raw.coverImage?.large ?? undefined;
  const coverColor = raw.coverImage?.color ?? '#1a1a2e';

  const formatLabel = lookupLabel(tm.formats, raw.format, raw.format ?? '');
  const canonicalStatus = canonicalizeAniListStatus(raw.status);
  const statusLabel = canonicalStatus ? lookupLabel(tm.statuses, canonicalStatus, canonicalStatus) : undefined;
  const statusClass = canonicalStatus ? (STATUS_BADGE_CLASS[canonicalStatus] ?? '') : '';

  // AniList doesn't know the final episode count while a show is still
  // airing (raw.episodes is null) — nextAiringEpisode.episode is the number
  // of the *next* episode to air, so subtracting 1 gives how many have
  // already aired, which is what total_count should track until the show
  // actually finishes (at which point raw.episodes takes over).
  const airedEpisodes = raw.nextAiringEpisode ? raw.nextAiringEpisode.episode - 1 : undefined;

  const seasonInfo = (raw.season && raw.seasonYear)
    ? `${lookupLabel(tm.seasons, raw.season, raw.season)} ${raw.seasonYear}`
    : formatDateParts(raw.startDate);

  const startFmt = formatDateParts(raw.startDate);
  const endFmt   = formatDateParts(raw.endDate);
  const dateBadge = startFmt
    ? (endFmt ? `${startFmt} - ${endFmt}` : startFmt)
    : undefined;

  // Namespaced under "anilist:" — AniList's studio ids and IGDB's company
  // ids are independent numbering spaces that would otherwise collide in
  // the shared companies table. AniList has one connection for both roles,
  // told apart by the edge's isMain flag: the actual (main) animation
  // studio is 'developer', every other credited company — AniList's own
  // site calls these "Producers", usually the production committee — is
  // 'publisher', mirroring games' developer/publisher split.
  const studioCompanies: MediaCompany[] = resolvedType === 'anime'
    ? raw.studios.edges.map(e => ({
        external_id: `company:anilist:${e.node.id}`,
        name: e.node.name,
        logo_url: null,
        role: e.isMain ? 'developer' : 'publisher',
      }))
    : [];
  // metaLines[0] is always the publisher line (rendered in the bold
  // "studios label" slot right under genre dots) — format has its own
  // dedicated Stats row above and must never show here instead, even when
  // there's no producer to show.
  const publisherNames = studioCompanies.filter(c => c.role === 'publisher').map(c => c.name).join(', ');
  const metaLines   = [publisherNames].filter(Boolean);

  const { core: coreGenres, tags: genreTags } = unifyGenres(raw.genres);
  const genreDots    = coreGenres.join(' · ') || undefined;
  const genreTagDots = genreTags.join(' · ')  || undefined;

  const characters = mapAniListCharacterEdges(raw.characters.edges);

  const relations: MediaRelation[] = raw.relations.edges
    .filter(e => e.relationType !== 'CHARACTER' && e.node.format !== 'MUSIC' && (e.node.coverImage?.extraLarge || e.node.coverImage?.large || e.node.coverImage?.medium))
    .sort((a, b) => {
      const typePriority = (RELATION_PRIORITY[a.relationType] ?? 99) - (RELATION_PRIORITY[b.relationType] ?? 99);
      if (typePriority !== 0) return typePriority;
      // Dentro del mismo tipo, ordenar por startDate (más antiguo primero)
      const aYear = a.node.startDate?.year ?? 0;
      const aMonth = a.node.startDate?.month ?? 0;
      const bYear = b.node.startDate?.year ?? 0;
      const bMonth = b.node.startDate?.month ?? 0;
      return (aYear * 12 + aMonth) - (bYear * 12 + bMonth);
    })
    .map(e => {
      const relatedIsAnime = e.node.type?.toUpperCase() === 'ANIME';
      // AniList's own relation data isn't always reciprocally curated — many
      // adaptation pairs only ever set "ADAPTATION" on both edges instead of
      // "SOURCE" for whichever side came later, which made the actual
      // original work read as "Adaptation" on its own derivative's page (and,
      // once cached, the reciprocal insert in save_media_relations then
      // mislabeled the other side too). Media type alone can't decide this —
      // manga-original (One Piece) and anime-original (Code Geass) franchises
      // both exist — so whichever of the two released first wins as SOURCE.
      let relationType = e.relationType;
      if (relationType === 'ADAPTATION' || relationType === 'SOURCE') {
        const currentDate = (raw.startDate?.year ?? 0) * 12 + (raw.startDate?.month ?? 0);
        const relatedDate = (e.node.startDate?.year ?? 0) * 12 + (e.node.startDate?.month ?? 0);
        if (currentDate > 0 && relatedDate > 0 && currentDate !== relatedDate) {
          // The label describes the RELATED node's role relative to current,
          // not the other way around: if related came out earlier, related
          // is the source (this one adapted it); if related came later, this
          // one came first and related is the adaptation.
          relationType = relatedDate < currentDate ? 'SOURCE' : 'ADAPTATION';
        }
      }
      const typeLabel = lookupLabel(canonicalRelationLabels, relationType, relationType);
      const relType = relatedIsAnime ? 'anime'
        : e.node.format === 'NOVEL' ? 'lnovel'
        : 'manga';
      const relatedExternalId = `${relType}:${e.node.id}`;
      return {
        typeLabel,
        relationType,
        title: e.node.title.romaji ?? '',
        // Prefer the high-res cover — this becomes the FULL cover on that
        // related title's own page too (via save_media_relations' stub-row
        // insert), not just this small relation card, so `medium` alone
        // used to look pixelated/blurry the first time that title's own
        // page was opened before a live fetch replaced it. `large` (AniList's
        // standard, near-always-populated size) as the middle fallback: when
        // extraLarge is missing this used to skip straight to `medium` (a
        // genuinely tiny thumbnail), stretched to fill that title's own full
        // page cover before its first live fetch replaced it.
        cover: e.node.coverImage?.extraLarge ?? e.node.coverImage?.large ?? e.node.coverImage?.medium ?? undefined,
        url:   `/media?id=${relatedExternalId}`,
        relatedExternalId,
        format: e.node.format ?? undefined,
      };
    });

  // Staff / Authors — AniList lists staff roles (Original Creator, Original
  // Story, Director, Story & Art, ...) without ranking them, so the first
  // non-empty tier in priority order becomes the work's credited author(s).
  // Anime falls back to Director too since many anime don't credit an
  // Original Creator staff entry at all. Manga/light novels are usually
  // credited to one "Story & Art" mangaka, but when the story and art are
  // split between two different people, AniList credits them separately as
  // "Story" and "Art" — both belong together as co-authors, so that tier
  // combines the two roles instead of picking just one.
  const staffEdges = raw.staff?.edges || [];
  const mapStaffEdges = (edges: AniListStaffEdge[], role: string): MediaAuthor[] =>
    edges.filter(e => e.role === role).map(e => ({
      // "person:a{id}" — shares the person: namespace with TMDB's own staff/
      // authors (person:t{id}), the "a"/"t" prefix keeping the two providers'
      // otherwise-independent numeric ids from colliding.
      external_id: `person:a${e.node.id}`,
      name: e.node.name.full,
      // Prefer large — same reasoning as the characters list above, this
      // becomes the sticky-preferred portrait on that author's own page.
      image: e.node.image?.large || e.node.image?.medium || undefined,
      role,
      url: `/author?id=person:a${e.node.id}`,
    }));

  const rolePriority: string[][] = resolvedType === 'anime'
    ? [['Original Creator'], ['Original Story'], ['Director']]
    : resolvedType === 'manga' || resolvedType === 'lnovel'
      ? [['Story & Art'], ['Story', 'Art'], ['Original Creator'], ['Original Story']]
      : [];

  let authors: MediaAuthor[] = [];
  for (const tier of rolePriority) {
    const matches = tier.flatMap(role => mapStaffEdges(staffEdges, role));
    if (matches.length > 0) {
      authors = matches;
      break;
    }
  }

  // Full staff list for the media page's own "Staff" tab (next to
  // Personajes) — every credited role, not just whichever tier won the
  // "Author" pick above. A person credited for more than one role (e.g.
  // Director + Series Composition) only gets one card, with their first
  // listed role.
  const seenStaffIds = new Set<number>();
  const staff: MediaPageData['staff'] = staffEdges
    .filter(e => {
      if (seenStaffIds.has(e.node.id)) return false;
      seenStaffIds.add(e.node.id);
      return true;
    })
    .map(e => ({
      id: `person:a${e.node.id}`,
      name: e.node.name.full,
      image: e.node.image?.large || e.node.image?.medium || undefined,
      role: e.role,
    }));

  const scoreGlobal = normalizeScore100(raw.averageScore);

  const stats: MediaPageData['stats'] = [];
  // Every other provider mapper (igdb-mapper, tmdb-mapper) pushes this score
  // stat — this one never did, so it only ever showed up via the catalog-only
  // fast path (mapCatalogEntryToPartialData) and vanished again once a live
  // AniList fetch replaced that data with this mapper's own stats array.
  if (scoreGlobal) stats.push({ label: tm.stat_score, value: String(scoreGlobal), isScore: true });
  if (authors.length > 0) {
    stats.push({
      label: authors[0].role || 'Author',
      value: authors.map(a => a.name).join(', '),
    });
  }
  if (resolvedType === 'anime') {
    const episodeCount = raw.episodes ?? airedEpisodes;
    // AniList has no season concept of its own — every entry is its own
    // single "season" for consistency with TMDB's Episodios | Temporadas stat.
    stats.push({ label: tm.stat_episodes, value: String(episodeCount ?? 0), label2: tm.stat_seasons, value2: '1' });
    if (raw.duration) stats.push({ label: tm.stat_duration, value: `${raw.duration} min` });
  } else if (resolvedType === 'manga' || resolvedType === 'lnovel') {
    if (raw.chapters || raw.volumes) {
      const chaptersStat: MediaStat = { label: tm.stat_chapters, value: String(raw.chapters ?? 0) };
      if (raw.volumes) {
        chaptersStat.label2 = tm.stat_volumes;
        chaptersStat.value2 = String(raw.volumes);
      }
      stats.push(chaptersStat);
    }
  }
  if (formatLabel || statusLabel) {
    const statusStat: MediaStat = { label: tm.stat_format, value: formatLabel };
    if (statusLabel) {
      statusStat.label2 = tm.stat_status;
      statusStat.value2 = statusLabel;
    }
    stats.push(statusStat);
  }
  if (raw.countryOfOrigin) {
    stats.push({ label: tm.stat_country, value: countryName(raw.countryOfOrigin) ?? raw.countryOfOrigin });
  }

  // SagaViewer only makes sense when there's at least one direct prequel/sequel
  // to walk from — the full transitive chain is resolved later, on demand,
  // by lib/anilist/saga.ts when the user actually opens the viewer.
  const hasSaga = raw.relations.edges.some(e => e.relationType === 'PREQUEL' || e.relationType === 'SEQUEL');

  const progressStatus = isReadingType(resolvedType) ? 'reading' as const : 'watching' as const;
  const progressLabel  = resolvedType === 'anime'
    ? (getT().profile.status_watching)
    : (getT().profile.status_reading);

  return {
    externalId: `${resolvedType}:${raw.id}`,
    type: resolvedType,
    titleMain,
    titleNative,
    titleRomaji,
    titleEnglish,
    cover,
    bannerImage:  raw.bannerImage ?? undefined,
    bannerColor:  `linear-gradient(135deg, ${coverColor}22, ${coverColor}44)`,
    statusLabel,
    statusClass,
    genreDots,
    genreTagDots,
    metaLines,
    dateBadge,
    description:  formatDescription(raw.description),
    stats,
    characters,
    charactersHasMore: raw.characters.pageInfo.hasNextPage,
    staff,
    relations,
    progressStatus,
    progressLabel,
    // Catalog metadata
    source:       'anilist',
    sourceUrl:    raw.siteUrl ?? undefined,
    format:       raw.format ?? undefined,
    releaseYear:  raw.startDate?.year  ?? undefined,
    releaseMonth: raw.startDate?.month ?? undefined,
    releaseDay:   raw.startDate?.day   ?? undefined,
    releaseEndYear:  raw.endDate?.year  ?? undefined,
    releaseEndMonth: raw.endDate?.month ?? undefined,
    releaseEndDay:   raw.endDate?.day   ?? undefined,
    scoreGlobal,
    countryOfOrigin: raw.countryOfOrigin ?? undefined,
    platforms:    undefined,
    timeLength:   resolvedType === 'anime' ? (raw.duration ?? undefined) : undefined,
    status:       canonicalStatus,
    totalCount:   resolvedType === 'anime' ? (raw.episodes ?? airedEpisodes) : (raw.chapters ?? undefined),
    totalCount_2: (resolvedType === 'manga' || resolvedType === 'lnovel') ? (raw.volumes ?? undefined) : undefined,
    // Studios only apply to anime — AniList's `studios` connection is
    // effectively unused for manga/light novels (no animation involved).
    companies:    studioCompanies.length > 0 ? studioCompanies : undefined,
    authors:      authors.length > 0 ? authors : undefined,
    hasSaga,
  };
}
