import type { FillerKind } from '../../../lib/anime/filler';
import { getT } from '../../../i18n/runtime';

// The AnimeFillerList category of one episode card: a red "Filler" pill, a
// blue "Mixed" pill, a subtle grey "Anime canon" one; manga canon (the
// normal case) is unmarked. The meaning lives in each pill's tooltip, so
// the list needs no legend block. The card's own accent comes from
// fillerCardClass.
export function EpisodeFillerBadge({ kind }: { kind: FillerKind | null | undefined }) {
  if (!kind || kind === 'manga_canon') return null;
  const t = getT().media.filler;
  const [label, tooltip] = kind === 'filler'
    ? [t.pill_filler, t.tooltip_filler]
    : kind === 'mixed'
      ? [t.pill_mixed, t.tooltip_mixed]
      : [t.pill_anime_canon, t.tooltip_anime_canon];
  return (
    <span className={`media-filler-pill media-filler-pill--${kind}`} title={tooltip} aria-label={tooltip}>
      {label}
    </span>
  );
}

/** Extra class for the episode card: a red (filler) or blue (mixed) left
 *  accent and tint. */
export function fillerCardClass(kind: FillerKind | null | undefined): string {
  if (kind === 'filler') return ' media-episode--filler';
  if (kind === 'mixed') return ' media-episode--mixed';
  return '';
}
