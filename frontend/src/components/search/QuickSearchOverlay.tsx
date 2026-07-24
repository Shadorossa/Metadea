// Navbar quick-search — opened by clicking the magnifying glass (see
// Navbar.astro, which dispatches 'metadea:open-quick-search' instead of
// navigating). A single centered input with a type selector to its right
// (Media/Staff/Characters/Users), live results below as you type.
import { useEffect, useRef, useState } from 'react';
import { search as searchMedia, type SearchResult } from '../../lib/search';
import { searchAniListStaff, type AniListStaffSearchResult } from '../../lib/search/providers/anilist';
import { searchUsers, type UserSearchResult } from '../../lib/social/users';
import { getT } from '../../i18n/client';

type QueryType = 'media' | 'staff' | 'character' | 'user';

const DEBOUNCE_MS = 300;
const MIN_CHARS = 2;

type Row =
  | { kind: 'media'; key: string; title: string; sub: string; cover: string | null; href: string }
  | { kind: 'staff'; key: string; title: string; sub: string; cover: string | null; href: string }
  | { kind: 'user';  key: string; title: string; sub: string; cover: string | null; href: string };

function mediaResultsToRows(results: SearchResult[]): Row[] {
  return results.map(r => ({
    kind: 'media',
    key: r.externalId,
    title: r.titleMain,
    sub: r.type,
    cover: r.coverUrl,
    href: r.type === 'character'
      ? `/character?id=${encodeURIComponent(r.externalId.replace('character:', ''))}`
      : `/media?id=${encodeURIComponent(r.externalId)}`,
  }));
}

function staffResultsToRows(results: AniListStaffSearchResult[]): Row[] {
  return results.map(r => ({
    kind: 'staff',
    key: `staff:${r.id}`,
    title: r.name,
    sub: r.nameNative ?? '',
    cover: r.image,
    href: `/author?id=person:a${r.id}`,
  }));
}

function userResultsToRows(results: UserSearchResult[]): Row[] {
  return results.map(r => ({
    kind: 'user',
    key: r.userId,
    title: r.username,
    sub: '',
    cover: r.avatarUrl,
    href: `/user?id=${encodeURIComponent(r.userId)}`,
  }));
}

export function QuickSearchOverlay() {
  const s = getT().social;
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<QueryType>('media');
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener('metadea:open-quick-search', onOpen);
    return () => window.removeEventListener('metadea:open-quick-search', onOpen);
  }, []);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      setQuery('');
      setRows(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (!open || query.trim().length < MIN_CHARS) {
      setRows(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        if (type === 'media') {
          const page = await searchMedia(query, 'all', controller.signal);
          setRows(mediaResultsToRows(page.results));
        } else if (type === 'character') {
          const page = await searchMedia(query, 'character', controller.signal);
          setRows(mediaResultsToRows(page.results));
        } else if (type === 'staff') {
          const page = await searchAniListStaff(query, controller.signal);
          setRows(staffResultsToRows(page.results));
        } else {
          const results = await searchUsers(query, controller.signal);
          setRows(userResultsToRows(results));
        }
      } catch {
        if (!controller.signal.aborted) setRows([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [open, query, type]);

  if (!open) return null;

  async function goTo(href: string) {
    setOpen(false);
    const { navigate } = await import('astro:transitions/client');
    navigate(href);
  }

  return (
    <div className="quick-search-backdrop" onClick={() => setOpen(false)}>
      <div className="quick-search-box" onClick={e => e.stopPropagation()}>
        <div className="quick-search-row">
          <input
            ref={inputRef}
            type="text"
            className="quick-search-input"
            placeholder={s.search_placeholder}
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          <div className="quick-search-types">
            {(['media', 'staff', 'character', 'user'] as QueryType[]).map(t => (
              <button
                key={t}
                type="button"
                className={`quick-search-type-btn ${type === t ? 'active' : ''}`}
                onClick={() => setType(t)}
              >
                {t === 'media' ? s.search_type_media
                  : t === 'staff' ? s.search_type_staff
                  : t === 'character' ? s.search_type_character
                  : s.search_type_user}
              </button>
            ))}
          </div>
        </div>

        {query.trim().length > 0 && query.trim().length < MIN_CHARS && (
          <p className="quick-search-hint">{s.search_min_chars}</p>
        )}

        {loading && <p className="quick-search-hint">…</p>}

        {!loading && rows !== null && rows.length === 0 && (
          <p className="quick-search-hint">{s.search_no_results}</p>
        )}

        {!loading && rows !== null && rows.length > 0 && (
          <div className="quick-search-results">
            {rows.map(row => (
              <button
                key={row.key}
                type="button"
                className="quick-search-result"
                onClick={() => goTo(row.href)}
              >
                {row.cover
                  ? <img className="quick-search-result-cover" src={row.cover} alt="" loading="lazy" referrerPolicy="no-referrer" />
                  : <div className="quick-search-result-cover quick-search-result-cover--empty" />}
                <span className="quick-search-result-text">
                  <span className="quick-search-result-title">{row.title}</span>
                  {row.sub && <span className="quick-search-result-sub">{row.sub}</span>}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
