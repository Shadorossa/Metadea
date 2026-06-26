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
  genres?: { id: number; name: string }[];
  involved_companies?: {
    id: number;
    company?: { name: string };
    developer?: boolean;
    publisher?: boolean;
  }[];
  platforms?: { id: number; name: string }[];
}

export function mapIgdbToMedia(game: IgdbDetailGame, rawId: string): MediaPageData {
  const year = game.first_release_date
    ? new Date(game.first_release_date * 1000).getFullYear()
    : null;

  const genres     = game.genres?.map(g => g.name) ?? [];
  const developers = game.involved_companies?.filter(c => c.developer && c.company).map(c => c.company!.name) ?? [];
  const publishers = game.involved_companies?.filter(c => c.publisher && c.company).map(c => c.company!.name) ?? [];
  const platforms  = game.platforms?.map(p => p.name) ?? [];

  const coverUrl  = game.cover?.image_id ? igdbImageUrl(game.cover.image_id, '1080p') : undefined;
  const bannerUrl = game.banner_image_id  ? igdbImageUrl(game.banner_image_id, '1080p') : undefined;

  const releaseDate = game.first_release_date
    ? new Date(game.first_release_date * 1000).toLocaleDateString('es-ES', {
        day: 'numeric', month: 'long', year: 'numeric',
      })
    : null;

  const stats: { label: string; value: string }[] = [];
  if (game.rating) stats.push({ label: 'Puntuación', value: (game.rating / 10).toFixed(1) + ' / 10' });

  const metaLines: string[] = [];
  if (platforms.length)  metaLines.push(platforms.join(' · '));
  if (publishers.length) metaLines.push(publishers.join(', '));

  return {
    externalId:     rawId,
    type:           'game',
    titleMain:      game.name,
    cover:          coverUrl,
    bannerImage:    bannerUrl,
    bannerColor:    'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
    genreDots:      genres.join(' · ') || undefined,
    metaLines,
    dateBadge:      releaseDate ?? undefined,
    developerBadge: developers[0] ?? undefined,
    description:    game.summary,
    stats,
    characters:     [],
    relations:      [],
    progressStatus: 'playing',
    progressLabel:  'Jugando',
  };
}
