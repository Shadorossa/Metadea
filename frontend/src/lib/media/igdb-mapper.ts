import { igdbImageUrl } from '../tauri';
import type { MediaPageData } from './types';

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
}

// Mirrors Metamedia's IGDB_TO_UNIFIED mapping
const IGDB_TO_UNIFIED: Record<string, { core?: string; tag?: string }> = {
  'Adventure': { core: 'Adventure' },
  'Fighting': { core: 'Fighting' },
  'Shooter': { core: 'Shooter' },
  'Music': { core: 'Music' },
  'Platform': { core: 'Platform' },
  'Puzzle': { core: 'Puzzle' },
  'Racing': { core: 'Racing' },
  'Real Time Strategy (RTS)': { core: 'Strategy' },
  'Role-playing (RPG)':        { core: 'RPG' },
  'Turn-based strategy (TBS)': { core: 'TBS' },
  'Tactical': { core: 'Tactical' },
  'Sport': { core: 'Sports' },
  'Strategy': { core: 'Strategy' },
  'Indie': { core: 'Indie' },
  'Arcade': { core: 'Arcade' },
  'Visual Novel': { core: 'Visual Novel' },
  'Card & Board Game': { core: 'Card & Board Game' },
  'MOBA': { core: 'MOBA' },
  'Simulator': { core: 'Simulator' },
  "Hack and slash/Beat 'em up": { core: 'Fighting' },
  'Quiz / Trivia': { tag: 'Quiz/Trivia' },
  'Action': { core: 'Action' },
  'Fantasy': { core: 'Fantasy' },
  'Science fiction': { core: 'Science Fiction' },
  'Horror': { core: 'Horror' },
  'Thriller': { core: 'Thriller' },
  'Comedy': { core: 'Comedy' },
  'Drama': { core: 'Drama' },
  'Mystery': { core: 'Mystery' },
  'Romance': { core: 'Romance' },
  'Survival': { tag: 'Survival' },
  'Historical': { core: 'History' },
  'Stealth': { tag: 'Stealth' },
  'Business': { tag: 'Business' },
  'Non-fiction': { tag: 'Non-fiction' },
  'Sandbox': { tag: 'Sandbox' },
  'Educational': { tag: 'Educational' },
  'Kids': { tag: 'Kids' },
  'Open world': { tag: 'Open world' },
  'Warfare': { core: 'War' },
  'Party': { tag: 'Party' },
  '4X': { tag: '4X' },
  'Erotic': { tag: 'Erotic' },
  'Point-and-click': { tag: 'Point-and-click' },
  'Cyberpunk': { core: 'Cyberpunk' },
  'Steampunk': { core: 'Steampunk' },
};

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

function splitGenres(genres: string[]): { core: string[]; tags: string[] } {
  const core: string[] = [];
  const tags: string[] = [];
  for (const genre of genres) {
    const mapped = IGDB_TO_UNIFIED[genre];
    if (mapped?.core && !core.includes(mapped.core)) core.push(mapped.core);
    else if (mapped?.tag && !tags.includes(mapped.tag)) tags.push(mapped.tag);
  }
  return { core, tags };
}

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

  // Format from game_type
  const gameType = game.game_type ?? 0;
  const format = GAME_TYPE_FORMAT[gameType] ?? 'GAME';

  // Genre split: core genres → genreDots, tags → genreTagDots
  const { core: coreGenres, tags: genreTags } = splitGenres(genres);
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

  return {
    externalId: rawId,
    type: 'game',
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
    relations: [],
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
