import type { Translations } from '../../../i18n/index';
import { openLink } from '../MediaStoreLinks';

/** "Data from AnimeFillerList", small, under the episode grid. */
export function FillerAttribution({ t, slug }: { t: Translations['media']['filler']; slug: string | undefined }) {
  const url = slug ? `https://www.animefillerlist.com/shows/${slug}` : 'https://www.animefillerlist.com/';
  return (
    <p className="media-filler-attribution">
      <a href={url} onClick={event => { event.preventDefault(); openLink(url); }}>{t.attribution}</a>
    </p>
  );
}
