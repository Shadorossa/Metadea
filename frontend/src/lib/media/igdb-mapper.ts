import { igdbImageUrl } from '../tauri';
import type { MediaPageData, MediaRelation } from './types';
import { unifyGenres } from './genre-unifier';

interface IgdbSubGame {
  id: number;
  name: string;
  cover?: { image_id: string };
  first_release_date?: number;
}

interface IgdbDetailGame {
  id: number;
  name: string;
  summary?: string;
  cover?: { image_id: string };
  banner_image_id?: string | null;
  first_release_date?: number;
  rating?: number;
  total_rating?: number;
  game_type?: number;
  genres?: { id: number; name: string }[];
  involved_companies?: {
    id: number;
    company?: { name: string };
    developer?: boolean;
    publisher?: boolean;
  }[];
  platforms?: { id: number; name: string }[];
  alternative_names?: { name: string; comment?: string }[];
  store_links?: { platform: string; url: string }[];
  
  // Relaciones de versiones
  remakes?: IgdbSubGame[];
  remasters?: IgdbSubGame[];
  dlcs?: IgdbSubGame[];
  expansions?: IgdbSubGame[];
  standalone_expansions?: IgdbSubGame[];
  expanded_games?: IgdbSubGame[];
  ports?: IgdbSubGame[];
  forks?: IgdbSubGame[];
}

const GAME_TYPE_FORMAT: Record<number, string> = {
  0: 'GAME',
  2: 'EXPANSION',
  4: 'EXPANSION',
  5: 'MOD',
  6: 'EPISODE',
  7: 'SEASON',
  8: 'REMAKE',
  9: 'REMASTER',
  10: 'EXPANDED_GAME',
  11: 'PORT',
  12: 'FORK',
  14: 'UPDATE',
};

function findAltName(
  altNames: { name: string; comment?: string }[],
  predicate: (comment: string, name: string) => boolean,
): string | undefined {
  return altNames.find(an => predicate((an.comment ?? '').toLowerCase(), an.name))?.name;
}

export function mapIgdbToMedia(game: IgdbDetailGame, rawId: string): MediaPageData {
  const genres = game.genres?.map(g => g.name) ?? [];
  const developers = game.involved_companies?.filter(c => c.developer && c.company).map(c => c.company!.name) ?? [];
  const publishers = game.involved_companies?.filter(c => c.publisher && c.company).map(c => c.company!.name) ?? [];
  const platforms = [...new Set((game.platforms ?? []).map(p => p.name))];

  const coverUrl = game.cover?.image_id ? igdbImageUrl(game.cover.image_id, '1080p') : undefined;
  const bannerUrl = game.banner_image_id ? igdbImageUrl(game.banner_image_id, '1080p') : undefined;

  // Release date breakdown
  const releaseYear = game.first_release_date ? new Date(game.first_release_date * 1000).getFullYear() : undefined;
  const releaseMonth = game.first_release_date ? new Date(game.first_release_date * 1000).getUTCMonth() + 1 : undefined;
  const releaseDay = game.first_release_date ? new Date(game.first_release_date * 1000).getUTCDate() : undefined;

  const releaseDate = releaseYear
    ? new Date(game.first_release_date! * 1000).toLocaleDateString('es-ES', {
      day: 'numeric', month: 'long', year: 'numeric',
    })
    : null;

  // Alternative names: native (JP chars or "japanese" comment) and romaji
  const altNames = game.alternative_names ?? [];
  const titleNative = findAltName(
    altNames,
    (comment, name) => comment.includes('japanese') || /[぀-ヿ一-龯]/.test(name),
  );
  const titleRomaji = findAltName(
    altNames,
    (comment) => comment.includes('romaji') || comment.includes('romanized'),
  );

  // Type from rawId prefix (e.g. "vnovel:12345" → "vnovel")
  const mediaType = rawId.split(':')[0].split('_')[0] as 'game' | 'vnovel';

  // Format: VNs are always VISUAL_NOVEL; games use game_type
  const gameType = game.game_type ?? 0;
  const format = mediaType === 'vnovel' ? 'VISUAL_NOVEL' : (GAME_TYPE_FORMAT[gameType] ?? 'GAME');

  // Genre split: core genres → genreDots, tags → genreTagDots
  const { core: coreGenres, tags: genreTags } = unifyGenres(genres);
  const genreDots = coreGenres.join(' · ') || undefined;
  const genreTagDots = genreTags.join(' · ') || undefined;

  // Score (prefer total_rating, fallback to rating — IGDB is /100)
  const rawScore = game.total_rating ?? game.rating;
  const scoreGlobal = rawScore ? Math.round((rawScore / 10) * 10) / 10 : undefined;

  const stats: { label: string; value: string }[] = [];
  if (scoreGlobal) stats.push({ label: 'Puntuación', value: scoreGlobal.toFixed(1) + ' / 10' });

  const metaLines: string[] = [];
  if (platforms.length) metaLines.push(platforms.join(' · '));
  if (publishers.length) metaLines.push(publishers.join(', '));

  // Agrupamiento y mapeo de las relaciones de IGDB en secciones
  const relations: MediaRelation[] = [];

  const addRelations = (subGames: IgdbSubGame[] | undefined, label: string) => {
    if (!subGames) return;
    for (const sg of subGames) {
      const cover = sg.cover?.image_id ? igdbImageUrl(sg.cover.image_id, 'cover_big') : undefined;
      relations.push({
        typeLabel: label,
        title: sg.name,
        cover,
        url: `/media?id=game:${sg.id}`,
      });
    }
  };

  addRelations(game.remakes, 'Remake');
  addRelations(game.remasters, 'Remaster');
  addRelations(game.dlcs, 'DLC');
  addRelations(game.expansions, 'Expansión');
  addRelations(game.standalone_expansions, 'Standalone');
  addRelations(game.expanded_games, 'Edición expandida');
  addRelations(game.ports, 'Port');
  addRelations(game.forks, 'Fork');

  return {
    externalId: rawId,
    type: mediaType,
    titleMain: game.name,
    titleNative: titleNative,
    titleEnglish: titleRomaji,   // romaji plays the "english" slot in MediaPageData
    cover: coverUrl,
    bannerImage: bannerUrl,
    bannerColor: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
    genreDots,
    genreTagDots,
    metaLines,
    dateBadge: releaseDate ?? undefined,
    developerBadge: developers[0] ?? undefined,
    description: game.summary,
    stats,
    characters: [],
    relations,
    progressStatus: 'playing',
    progressLabel: 'Jugando',
    storeLinks: game.store_links?.filter(l => l.platform && l.url),
    // Catalog fields
    format,
    source: 'igdb',
    releaseYear,
    releaseMonth,
    releaseDay,
    platforms,
    scoreGlobal,
  };
}

