import { useCallback, useState } from 'react';
import type { Translations } from '../../../i18n/index';
import type { LibraryEntry } from '../../../lib/tauri';
import { effectiveEpisodeTotal, effectiveProgress, entryHasFiller, skipsFiller } from '../../../lib/anime/filler';
import { interpolate } from '../../../lib/shared/text/interpolate';
import { openLink } from '../MediaStoreLinks';
import { FillerChoice } from './FillerChoice';
import { FillerLinkPopover } from './FillerLinkPopover';
import type { EpisodeFillerView } from './useEpisodeFiller';

interface Props {
  t: Translations['media']['filler'];
  currentId: string;
  view: EpisodeFillerView;
  /** The library entry when the work is in the library (the choice needs one). */
  entry: LibraryEntry | null;
  total: number | null | undefined;
  onSkipFillerChange: (skip: boolean) => void;
}

// Above the episode grid: "Hide filler", the entry's "Filler: Watched /
// Skipped" choice with its canon progress, and the link control. Renders
// nothing when there's no filler data and nothing to link to (the site is
// unreachable or backing off), so the feature simply hides.
export function FillerEpisodesToolbar({ t, currentId, view, entry, total, onSkipFillerChange }: Props) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const closePopover = useCallback(() => setPopoverOpen(false), []);
  if (!view.applies || (!view.ownSlug && !view.anyFiller && !view.indexAvailable)) return null;

  const info = view.ownInfo;
  const canChoose = !!entry && entryHasFiller(info, total);
  const skipping = skipsFiller(entry, info, total);
  const canonTotal = skipping ? effectiveEpisodeTotal(entry, info, total) : null;

  return (
    <div className="media-filler-toolbar">
      {view.anyFiller && (
        <label className="media-filler-hide" title={t.hide_filler_hint}>
          <input type="checkbox" checked={view.hideFiller} onChange={event => view.setHideFiller(event.target.checked)} />
          <span>{t.hide_filler}</span>
        </label>
      )}
      {canChoose && (
        <FillerChoice t={t} skip={skipping} onChange={onSkipFillerChange} info={info} total={total} />
      )}
      {skipping && canonTotal != null && (
        <span className="media-filler-progress">
          {interpolate(t.effective_progress, { progress: effectiveProgress(entry, info, total), total: canonTotal })}
        </span>
      )}
      <div className="media-filler-link">
        {view.ownSlug ? (
          <>
            <span className="media-filler-link-title" title={info && !info.manual ? t.auto_linked : undefined}>
              {interpolate(t.linked_to, { title: info?.title ?? view.ownSlug })}
            </span>
            {!info && <span className="media-filler-link-pending">{t.pending}</span>}
            <button type="button" className="media-filler-link-btn" onClick={() => setPopoverOpen(open => !open)}>{t.change}</button>
          </>
        ) : (
          <button type="button" className="media-filler-link-btn" onClick={() => setPopoverOpen(open => !open)}>{t.link}</button>
        )}
        {popoverOpen && <FillerLinkPopover t={t} currentId={currentId} view={view} onClose={closePopover} />}
      </div>
    </div>
  );
}

/** "Data from AnimeFillerList", small, under the episode grid. */
export function FillerAttribution({ t, slug }: { t: Translations['media']['filler']; slug: string | undefined }) {
  const url = slug ? `https://www.animefillerlist.com/shows/${slug}` : 'https://www.animefillerlist.com/';
  return (
    <p className="media-filler-attribution">
      <a href={url} onClick={event => { event.preventDefault(); openLink(url); }}>{t.attribution}</a>
    </p>
  );
}
