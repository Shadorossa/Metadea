// The "Read" tab of a manga/comic/light-novel media page, shown when an
// enabled plugin contributes a source for the work's type. It picks a source,
// finds the work there (AniList id, then MAL id, then exact title; otherwise
// the user picks), remembers that match per work (plugin_work_links), lists
// the chapters with read markers from library progress, and opens a chapter
// in the regular reader through a plugin page source — reading then updates
// the library (and AniList/MAL sync) like any other reading.
import { useEffect, useMemo, useRef, useState } from 'react';
import { getT } from '../../i18n/runtime';
import { useExternalStore } from '../shared/hooks/useExternalStore';
import { ReaderModal } from '../reader/ReaderModal';
import { showToast } from '../../lib/dom/toast';
import { interpolate } from '../../lib/shared/text/interpolate';
import type { LibraryEntry } from '../../lib/tauri';
import { getPluginWorkLink, pluginHttpDownload, pluginHttpFetch, setPluginWorkLink } from '../../lib/tauri/plugins';
import { getPluginRuntime } from '../../lib/plugins/runtime-instance';
import { pickBestMatch, type MatchReason, type PluginWorkContext } from '../../lib/plugins/work-context';
import { pluginImagePageSource } from '../../lib/plugins/plugin-page-source';
import type { SourceChapter, SourceDetails, SourceSearchItem } from '../../lib/plugins/plugin-results';
import type { ReaderPageSource } from '../../lib/reader/page-source';
import { usePluginImage } from './hooks/usePluginImage';
import { pluginErrorText } from './plugin-error-text';

interface Props {
  work: PluginWorkContext;
  title: string;
  cover: string | null;
  totalCount: number | null;
  libraryEntry: LibraryEntry | null;
  onProgressSaved: () => void;
}

interface SourceKey { pluginId: string; sourceId: string }
interface Match { itemId: string; itemTitle: string; reason: MatchReason | 'linked' | 'manual' }
type Phase = 'loading' | 'searching' | 'pick' | 'chapters' | 'error';

const CHAPTER_PAGE = 60;
const sameSource = (a: SourceKey | null, b: SourceKey | null) => !!a && !!b && a.pluginId === b.pluginId && a.sourceId === b.sourceId;

function draftEntry(work: PluginWorkContext): LibraryEntry {
  return {
    id: '', user_id: 'local', external_id: work.externalId, type: work.type,
    status: 'planning', rating: null, rating_2: null, progress: 0, progress_2: 0, minutes_spent: 0,
    is_favorite: 0, is_platinum: 0, tags: null, notes: null,
    added_at: null, updated_at: null, selected_platform: null, selected_version: null,
    started_at: null, finished_at: null,
  };
}

function ResultCard({ pluginId, item, onPick }: { pluginId: string; item: SourceSearchItem; onPick: () => void }) {
  const cover = usePluginImage(pluginId, item.cover);
  return (
    <li>
      <button type="button" className="plugin-read-result" onClick={onPick}>
        <span className="plugin-read-result-cover">{cover && <img src={cover} alt="" loading="lazy" />}</span>
        <span className="plugin-read-result-title">{item.title}</span>
        {item.year && <span className="plugin-read-result-meta">{item.year}</span>}
      </button>
    </li>
  );
}

export function PluginReadTab({ work, title, cover, totalCount, libraryEntry, onProgressSaved }: Props) {
  const t = getT();
  const tp = t.plugins;
  const runtime = getPluginRuntime();
  const installed = useExternalStore(runtime.plugins);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- recomputed when the installed list changes
  const sources = useMemo(() => runtime.sourcesFor(work.type), [runtime, installed, work.type]);

  const [selected, setSelected] = useState<SourceKey | null>(null);
  const [match, setMatch] = useState<Match | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<SourceSearchItem[]>([]);
  const [query, setQuery] = useState('');
  const [details, setDetails] = useState<SourceDetails | null>(null);
  const [shown, setShown] = useState(CHAPTER_PAGE);
  const [opening, setOpening] = useState<string | null>(null);
  const [reader, setReader] = useState<{ chapter: SourceChapter; filePath: string; pageSource?: ReaderPageSource } | null>(null);
  // Every async step checks it is still the latest request for this tab.
  const ticket = useRef(0);

  const sourceName = (key: SourceKey | null) => sources.find(s => sameSource({ pluginId: s.plugin.id, sourceId: s.source.id }, key))?.source.name ?? '';

  // Initial source: the remembered link, else the first available source.
  useEffect(() => {
    const mine = ++ticket.current;
    let cancelled = false;
    runtime.ensureLoaded()
      .then(() => getPluginWorkLink(work.externalId))
      .then(link => {
        if (cancelled || mine !== ticket.current) return;
        const available = runtime.sourcesFor(work.type);
        const linked = link && available.find(s => s.plugin.id === link.pluginId && s.source.id === link.sourceId);
        if (link && linked) {
          setSelected({ pluginId: link.pluginId, sourceId: link.sourceId });
          setMatch({ itemId: link.itemId, itemTitle: link.itemTitle, reason: 'linked' });
        } else if (available[0]) {
          setSelected({ pluginId: available[0].plugin.id, sourceId: available[0].source.id });
          setMatch(null);
        }
      })
      .catch(err => {
        if (cancelled) return;
        setError(pluginErrorText(err, t));
        setPhase('error');
      });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- once per work
  }, [work.externalId]);

  const search = async (key: SourceKey, text: string): Promise<SourceSearchItem[]> => {
    const result = await runtime.invoke(key.pluginId, 'sources.search', key.sourceId, [text, 1]);
    return result.items;
  };

  const remember = (key: SourceKey, item: SourceSearchItem) => {
    setPluginWorkLink(work.externalId, { pluginId: key.pluginId, sourceId: key.sourceId, itemId: item.id, itemTitle: item.title })
      .catch(err => showToast(pluginErrorText(err, t), 'error'));
  };

  // No match yet for the selected source: search by title automatically.
  useEffect(() => {
    if (!selected || match) return;
    const mine = ++ticket.current;
    const key = selected;
    setPhase('searching');
    setError(null);
    (async () => {
      let first: SourceSearchItem[] | null = null;
      for (const candidate of work.titles.slice(0, 3)) {
        const items = await search(key, candidate);
        if (mine !== ticket.current) return;
        first ??= items;
        const best = pickBestMatch(items, work);
        if (best) {
          setMatch({ itemId: best.item.id, itemTitle: best.item.title, reason: best.reason });
          remember(key, best.item);
          return;
        }
      }
      setResults(first ?? []);
      setQuery(work.titles[0] ?? '');
      setPhase('pick');
    })().catch(err => {
      if (mine !== ticket.current) return;
      setError(pluginErrorText(err, t));
      setPhase('error');
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- driven by source/match changes
  }, [selected, match]);

  // A match: load its chapters.
  useEffect(() => {
    if (!selected || !match) return;
    const mine = ++ticket.current;
    setPhase('loading');
    setError(null);
    setShown(CHAPTER_PAGE);
    runtime.invoke(selected.pluginId, 'sources.details', selected.sourceId, [match.itemId])
      .then(result => {
        if (mine !== ticket.current) return;
        setDetails(result);
        setPhase('chapters');
      })
      .catch(err => {
        if (mine !== ticket.current) return;
        setError(pluginErrorText(err, t));
        setPhase('error');
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- driven by source/match changes
  }, [selected, match]);

  const manualSearch = () => {
    if (!selected || !query.trim()) return;
    const mine = ++ticket.current;
    setPhase('searching');
    search(selected, query.trim())
      .then(items => {
        if (mine !== ticket.current) return;
        setResults(items);
        setPhase('pick');
      })
      .catch(err => {
        if (mine !== ticket.current) return;
        setError(pluginErrorText(err, t));
        setPhase('error');
      });
  };

  const pick = (item: SourceSearchItem) => {
    if (!selected) return;
    remember(selected, item);
    setMatch({ itemId: item.id, itemTitle: item.title, reason: 'manual' });
  };

  const changeMatch = () => {
    ticket.current += 1;
    setQuery(match?.itemTitle ?? work.titles[0] ?? '');
    setResults([]);
    setPhase('pick');
  };

  const openChapter = async (chapter: SourceChapter) => {
    if (!selected) return;
    const key = selected;
    setOpening(chapter.id);
    try {
      const pages = await runtime.invoke(key.pluginId, 'sources.pages', key.sourceId, [chapter.id]);
      if (pages.kind === 'images') {
        setReader({
          chapter,
          filePath: `plugin:${key.pluginId}/${chapter.id}`,
          pageSource: pluginImagePageSource(pluginHttpFetch, key.pluginId, chapter.id, pages.pages),
        });
      } else {
        const extension = pages.format === 'zip' ? 'cbz' : pages.format;
        const path = await pluginHttpDownload(key.pluginId, { url: pages.url, headers: pages.headers }, extension);
        setReader({ chapter, filePath: path });
      }
    } catch (err) {
      showToast(interpolate(tp.read_open_failed, { error: pluginErrorText(err, t) }), 'error');
    } finally {
      setOpening(null);
    }
  };

  if (sources.length === 0) return null;

  const progress = libraryEntry?.progress ?? 0;
  const chapters = [...(details?.chapters ?? [])].sort((a, b) => b.number - a.number);
  const nextChapter = [...chapters].reverse().find(c => Math.floor(c.number) > progress);
  const reasonLabel = match?.reason === 'anilistId' || match?.reason === 'malId'
    ? tp.read_matched_by_id
    : match?.reason === 'title'
    ? tp.read_matched_by_title
    : tp.read_linked;
  const currentName = sourceName(selected);

  return (
    <div className="plugin-read">
      <div className="plugin-read-bar">
        {sources.length > 1 ? (
          <label className="plugin-read-source">
            <span>{tp.read_source}</span>
            <select
              className="plugin-setting-input"
              value={selected ? `${selected.pluginId}\n${selected.sourceId}` : ''}
              onChange={e => {
                const [pluginId, sourceId] = e.target.value.split('\n');
                setDetails(null);
                setMatch(null);
                setSelected({ pluginId, sourceId });
              }}
            >
              {sources.map(s => (
                <option key={`${s.plugin.id}/${s.source.id}`} value={`${s.plugin.id}\n${s.source.id}`}>
                  {s.source.name} · {s.plugin.manifest?.name ?? s.plugin.id}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span className="plugin-read-source">{tp.read_source}: <strong>{currentName}</strong></span>
        )}
        {match && phase !== 'pick' && (
          <span className="plugin-read-match">
            <span className="plugin-read-match-title" title={match.itemTitle}>{match.itemTitle}</span>
            <span className="plugin-chip">{reasonLabel}</span>
            <button type="button" className="btn btn--sm btn--ghost" onClick={changeMatch}>{tp.read_change_match}</button>
          </span>
        )}
      </div>

      {(phase === 'loading' || phase === 'searching') && (
        <p className="settings-hint plugin-read-status">
          {phase === 'searching' ? interpolate(tp.read_searching, { source: currentName }) : tp.read_loading_chapters}
        </p>
      )}

      {phase === 'error' && (
        <div className="plugin-read-status plugin-read-status--error" role="alert">
          <p>{error}</p>
          <button type="button" className="btn btn--sm btn--secondary" onClick={() => { setError(null); setMatch(m => (m ? { ...m } : null)); if (!match) setSelected(s => (s ? { ...s } : s)); }}>
            {tp.read_retry}
          </button>
        </div>
      )}

      {phase === 'pick' && selected && (
        <div className="plugin-read-pick">
          <p className="settings-hint">{interpolate(tp.read_no_match, { source: currentName })}</p>
          <form className="plugins-url-row" onSubmit={e => { e.preventDefault(); manualSearch(); }}>
            <input
              type="search"
              className="plugin-setting-input"
              value={query}
              placeholder={interpolate(tp.read_search_placeholder, { source: currentName })}
              onChange={e => setQuery(e.target.value)}
            />
            <button type="submit" className="btn btn--sm btn--primary" disabled={!query.trim()}>{tp.read_search}</button>
          </form>
          {results.length === 0 ? (
            <p className="settings-hint">{tp.read_no_results}</p>
          ) : (
            <ul className="plugin-read-results">
              {results.map(item => <ResultCard key={item.id} pluginId={selected.pluginId} item={item} onPick={() => pick(item)} />)}
            </ul>
          )}
        </div>
      )}

      {phase === 'chapters' && (
        chapters.length === 0 ? (
          <p className="settings-hint plugin-read-status">{tp.read_no_chapters}</p>
        ) : (
          <>
            {nextChapter && (
              <button type="button" className="btn btn--sm btn--primary plugin-read-continue" disabled={!!opening} onClick={() => void openChapter(nextChapter)}>
                {interpolate(progress > 0 ? tp.read_continue : tp.read_start, { number: nextChapter.number })}
              </button>
            )}
            <ol className="plugin-read-chapters">
              {chapters.slice(0, shown).map(chapter => {
                const read = Math.floor(chapter.number) <= progress;
                return (
                  <li key={chapter.id} className={`plugin-read-chapter${read ? ' plugin-read-chapter--read' : ''}`}>
                    <button
                      type="button"
                      className="plugin-read-chapter-btn"
                      disabled={!!opening}
                      aria-label={interpolate(tp.read_open, { number: chapter.number })}
                      onClick={() => void openChapter(chapter)}
                    >
                      <span className="plugin-read-chapter-number">{interpolate(tp.read_chapter, { number: chapter.number })}</span>
                      {chapter.title && chapter.title !== interpolate(tp.read_chapter, { number: chapter.number }) && (
                        <span className="plugin-read-chapter-title">{chapter.title}</span>
                      )}
                      <span className="plugin-read-chapter-meta">
                        {chapter.volume != null && <span>{interpolate(tp.read_volume, { volume: chapter.volume })}</span>}
                        {chapter.scanlator && <span>{chapter.scanlator}</span>}
                        {chapter.date && <span>{chapter.date}</span>}
                      </span>
                      {opening === chapter.id
                        ? <span className="plugin-read-chapter-state">{tp.read_opening}</span>
                        : read && <span className="plugin-chip plugin-chip--read">{tp.read_read_badge}</span>}
                    </button>
                  </li>
                );
              })}
            </ol>
            {chapters.length > shown && (
              <button type="button" className="btn btn--sm btn--secondary" onClick={() => setShown(n => n + CHAPTER_PAGE)}>{tp.read_show_more}</button>
            )}
          </>
        )
      )}

      {reader && (
        <ReaderModal
          externalId={work.externalId}
          title={`${title} · ${interpolate(tp.read_chapter, { number: reader.chapter.number })}`}
          filePath={reader.filePath}
          episodeNumber={Math.floor(reader.chapter.number)}
          totalCount={totalCount}
          libraryEntry={libraryEntry ?? draftEntry(work)}
          cover={cover}
          isSingleTomo={false}
          pageSource={reader.pageSource}
          progressUnit="chapters"
          onClose={() => setReader(null)}
          onProgressSaved={onProgressSaved}
        />
      )}
    </div>
  );
}
