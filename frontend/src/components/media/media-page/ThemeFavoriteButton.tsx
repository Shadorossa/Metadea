import { useSyncExternalStore } from 'react';
import { Star } from 'lucide-react';
import type { MediaTheme } from '../../../lib/tauri';
import { getT } from '../../../i18n/runtime';
import { jukeboxStore } from '../../../lib/jukebox/jukebox-store';
import { isThemeFavorite } from '../../../lib/jukebox/jukebox-favorites';
import { toggleFavorite } from '../../../lib/jukebox/jukebox-engine';
import { showToast } from '../../../lib/dom/toast';
import { formatAppError } from '../../../lib/errors/format-error';

interface Props {
  theme: MediaTheme;
  // What the jukebox strip shows next to the song.
  mediaTitle: string;
  coverUrl?: string | null;
}

// Jukebox "favourite theme" star, shown in the theme player's info bar.
export function ThemeFavoriteButton({ theme, mediaTitle, coverUrl }: Props) {
  // Only the queue reference, not the whole player state: the jukebox's
  // timeupdate ticks would otherwise re-render the overlay constantly.
  const favorites = useSyncExternalStore(jukeboxStore.subscribe, () => jukeboxStore.get().queue, () => jukeboxStore.initial.queue);
  const favorite = isThemeFavorite(favorites, theme);
  const tj = getT().jukebox;
  const label = favorite ? tj.remove_favorite : tj.add_favorite;
  return (
    <button
      type="button"
      className={`media-theme-fav media-theme-fav--inline${favorite ? ' media-theme-fav--on' : ''}`}
      aria-pressed={favorite}
      aria-label={label}
      title={label}
      onClick={e => {
        e.stopPropagation();
        toggleFavorite(theme, !favorite, { mediaTitle, coverUrl: coverUrl ?? null })
          .catch(err => showToast(formatAppError(err, getT()), 'error'));
      }}
    >
      <Star size={14} fill={favorite ? 'currentColor' : 'none'} />
    </button>
  );
}
