import { useEffect, useMemo, useRef, useState } from 'react';
import type { Translations } from '../../../i18n/index';
import { getT } from '../../../i18n/runtime';
import type { FillerIndexShow } from '../../../lib/tauri/anime-filler';
import { searchFillerIndex } from '../../../lib/anime/filler-match';
import {
  clearFillerLink, loadFillerIndex, refreshFillerShow, saveManualFillerLink, suggestFillerOffset,
} from '../../../lib/anime/filler-data';
import { formatAppError } from '../../../lib/errors/format-error';
import { showToast } from '../../../lib/dom/toast';
import type { EpisodeFillerView } from './useEpisodeFiller';

interface Props {
  t: Translations['media']['filler'];
  currentId: string;
  view: EpisodeFillerView;
  onClose: () => void;
}

// The episodes section's "Link filler list" / "Change" popover: a search over
// the cached AnimeFillerList index and the entry's starting episode in the
// show's absolute numbering (prefilled from the chain, editable for the
// cases the automatic offset gets wrong). Saving stores a manual link.
export function FillerLinkPopover({ t, currentId, view, onClose }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState<FillerIndexShow[] | null>(null);
  const [query, setQuery] = useState('');
  const [slug, setSlug] = useState<string | undefined>(view.ownSlug);
  const [startEpisode, setStartEpisode] = useState(String((view.ownInfo?.episodeOffset ?? 0) + 1));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadFillerIndex().then(shows => { if (!cancelled) setIndex(shows); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  const results = useMemo(() => (index ? searchFillerIndex(query, index, 12) : []), [index, query]);
  const selectedTitle = index?.find(show => show.slug === slug)?.title ?? view.ownInfo?.title ?? slug;

  const pick = (nextSlug: string) => {
    setSlug(nextSlug);
    if (nextSlug !== view.ownSlug && view.state) {
      setStartEpisode(String(suggestFillerOffset(view.state, currentId, nextSlug) + 1));
    }
  };

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
      onClose();
    } catch (error) {
      showToast(formatAppError(error, getT()), 'error');
    } finally {
      setBusy(false);
    }
  };

  const start = Math.max(1, Math.floor(Number(startEpisode) || 1));
  const linkedSlug = view.ownSlug;

  return (
    <div ref={rootRef} className="media-filler-popover" role="dialog" aria-label={t.popover_title}>
      <p className="media-filler-popover-title">{t.popover_title}</p>
      {index && index.length === 0 ? (
        <p className="media-filler-popover-empty">{t.index_unavailable}</p>
      ) : (
        <>
          <input
            className="media-filler-popover-search"
            type="search"
            value={query}
            placeholder={t.search_placeholder}
            aria-label={t.search_placeholder}
            autoFocus
            onChange={event => setQuery(event.target.value)}
          />
          <ul className="media-filler-popover-results">
            {results.map(show => (
              <li key={show.slug}>
                <button
                  type="button"
                  className={`media-filler-popover-result${show.slug === slug ? ' is-selected' : ''}`}
                  aria-pressed={show.slug === slug}
                  onClick={() => pick(show.slug)}
                >
                  {show.title}
                </button>
              </li>
            ))}
            {index && results.length === 0 && <li className="media-filler-popover-empty">{t.no_results}</li>}
          </ul>
        </>
      )}
      {slug && (
        <div className="media-filler-popover-selected">
          <span className="media-filler-popover-selected-title">{selectedTitle}</span>
          <label className="media-filler-popover-offset">
            <span>{t.start_episode}</span>
            <input type="number" min={1} step={1} value={startEpisode} onChange={event => setStartEpisode(event.target.value)} />
          </label>
        </div>
      )}
      <div className="media-filler-popover-actions">
        {linkedSlug && (
          <>
            <button type="button" className="media-filler-popover-btn" disabled={busy} onClick={() => void run(() => clearFillerLink(currentId))}>{t.unlink}</button>
            <button type="button" className="media-filler-popover-btn" disabled={busy} onClick={() => void run(() => refreshFillerShow(linkedSlug, view.airing))}>{t.refresh}</button>
          </>
        )}
        <span className="media-filler-popover-spacer" />
        <button type="button" className="media-filler-popover-btn" onClick={onClose}>{t.cancel}</button>
        <button
          type="button"
          className="media-filler-popover-btn media-filler-popover-btn--primary"
          disabled={busy || !slug}
          onClick={() => slug && void run(() => saveManualFillerLink(currentId, slug, start - 1, view.airing))}
        >
          {t.save}
        </button>
      </div>
    </div>
  );
}
