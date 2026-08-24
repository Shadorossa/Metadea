// Navbar quick-search — opened by clicking the magnifying glass (see
// Navbar.astro, which dispatches 'metadea:open-quick-search' instead of
// navigating). A single centered input; every category (media types,
// characters, staff, users) searches in parallel and renders as its own
// AniList-style section, all merged into one grid instead of behind a
// category filter.
import { useEffect, useMemo, useRef, useState } from 'react';
import { search as searchMedia, type SearchResult } from '../../lib/search';
import { searchAniListStaff, fetchAniListStaffDetail, type AniListStaffSearchResult } from '../../lib/search/providers/anilist';
import { searchUsers, type UserSearchResult } from '../../lib/social/users';
import { ALL_MEDIA_TYPES } from '../../lib/constants/media';
import { getT } from '../../i18n/client';
import { STORAGE_KEYS } from '../../lib/shared/storage-keys';
import { toSmallCover } from '../../lib/shared/small-cover';

const DEBOUNCE_MS = 300;
const MIN_CHARS = 2;
const SECTION_CAP = 6;
// Sections render in a fixed 4-column grid (see .quick-search-sections) —
// capped to 2 rows' worth so the box never grows past that regardless of how
// many categories a query matches. Characters/Staff/Users always keep their
// slot; media-type sections fill whatever's left.
const SECTION_COLUMNS = 4;
const MAX_TOTAL_SECTIONS = SECTION_COLUMNS * 2;
// How many top staff matches get their full work list fetched to backfill
// the media sections (e.g. searching "Sorachi" surfacing Gintama under
// Anime/Manga/Novela Ligera even though the title itself never matched) —
// kept small since each one is an extra network round-trip.
const STAFF_BACKFILL_LIMIT = 2;

interface Row {
  key: string;
  title: string;
  sub: string;
  cover: string | null;
  href: string;
  // Users render their avatar borderless and without the fixed media-cover
  // width — a profile picture, not a cover art aspect ratio.
  isAvatar?: boolean;
}

interface Section {
  key: string;
  heading: string;
  rows: Row[];
  viewAllHref: string | null;
}

// AniList only tracks anime/manga (light novels are manga + format NOVEL) —
// staffMedia has no equivalent for games/movies/books/comics, so this can
// only ever backfill those three sections.
function staffMediaType(node: { type: string; format: string | null }): string | null {
  if (node.type === 'ANIME') return 'anime';
  if (node.type === 'MANGA') return node.format === 'NOVEL' ? 'lnovel' : 'manga';
  return null;
}

async function fetchStaffBackfill(staffId: number, signal: AbortSignal): Promise<Array<{ type: string; row: Row }>> {
  const detail = await fetchAniListStaffDetail(staffId).catch(() => null);
  if (!detail || signal.aborted) return [];
  const out: Array<{ type: string; row: Row }> = [];
  for (const edge of detail.staffMedia.edges) {
    const type = staffMediaType(edge.node);
    if (!type) continue;
    const externalId = `${type}:${edge.node.id}`;
    out.push({
      type,
      row: {
        key: externalId,
        title: edge.node.title.english || edge.node.title.romaji || externalId,
        sub: edge.staffRole,
        cover: edge.node.coverImage?.medium ?? null,
        href: `/media?id=${encodeURIComponent(externalId)}`,
      },
    });
  }
  return out;
}

function mediaRowsByType(results: SearchResult[]): Map<string, Row[]> {
  const byType = new Map<string, Row[]>();
  for (const r of results) {
    const row: Row = {
      key: r.externalId,
      title: r.titleMain,
      sub: String(r.releaseYear ?? ''),
      cover: toSmallCover(r.coverUrl),
      href: `/media?id=${encodeURIComponent(r.externalId)}`,
    };
    const list = byType.get(r.type) ?? [];
    list.push(row);
    byType.set(r.type, list);
  }
  return byType;
}

export function QuickSearchOverlay() {
  const s = getT().social;
  const typeLabels = getT().search.types;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [sections, setSections] = useState<Section[] | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Full (unsliced, un-Row-transformed) results behind each media/character
  // section — "Ver todos" hands these to /search via sessionStorage instead
  // of letting SearchIsland re-run the exact same query+type fetch it just
  // watched this component make. Not React state: only ever read at click
  // time, never rendered.
  const handoffRef = useRef<{
    byType: Map<string, SearchResult[]>;
    hasMore: boolean;
    characterResults: SearchResult[];
    characterHasMore: boolean;
  }>({ byType: new Map(), hasMore: false, characterResults: [], characterHasMore: false });

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
      setSections(null);
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
      setSections(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const [mediaPage, characterPage, staffPage, userResults] = await Promise.all([
          searchMedia(query, 'all', controller.signal).catch(() => ({ results: [], hasMore: false })),
          searchMedia(query, 'character', controller.signal).catch(() => ({ results: [], hasMore: false })),
          searchAniListStaff(query, controller.signal).catch(() => ({ results: [], hasMore: false })),
          searchUsers(query, controller.signal).catch(() => [] as UserSearchResult[]),
        ]);
        if (controller.signal.aborted) return;

        const rawByType = new Map<string, SearchResult[]>();
        for (const r of mediaPage.results) {
          const list = rawByType.get(r.type) ?? [];
          list.push(r);
          rawByType.set(r.type, list);
        }
        handoffRef.current = {
          byType: rawByType,
          hasMore: mediaPage.hasMore,
          characterResults: characterPage.results,
          characterHasMore: characterPage.hasMore,
        };

        const byType = mediaRowsByType(mediaPage.results);

        // Backfill: a staff hit's own known works (e.g. "Sorachi" -> Gintama)
        // get merged into their media-type section even when the query never
        // matched any title directly. Skips a work already found by title
        // search so it isn't duplicated.
        const topStaff = staffPage.results.slice(0, STAFF_BACKFILL_LIMIT);
        const backfillLists = await Promise.all(
          topStaff.map((st: AniListStaffSearchResult) => fetchStaffBackfill(st.id, controller.signal))
        );
        if (controller.signal.aborted) return;
        for (const list of backfillLists) {
          for (const { type, row } of list) {
            const existing = byType.get(type) ?? [];
            if (existing.some(r => r.key === row.key)) continue;
            existing.push(row);
            byType.set(type, existing);
          }
        }

        const mediaSections: Section[] = ALL_MEDIA_TYPES
          .filter(t => t !== 'character' && byType.has(t))
          .map(t => ({
            key: t,
            heading: typeLabels[t as keyof typeof typeLabels] ?? t,
            rows: byType.get(t)!.slice(0, SECTION_CAP),
            viewAllHref: `/search?type=${t}&q=${encodeURIComponent(query.trim())}`,
          }));

        const extraSections: Section[] = [];
        if (characterPage.results.length > 0) {
          extraSections.push({
            key: 'character',
            heading: s.search_section_characters,
            rows: characterPage.results.slice(0, SECTION_CAP).map(r => ({
              key: r.externalId,
              title: r.titleMain,
              sub: '',
              cover: toSmallCover(r.coverUrl),
              href: `/character?id=${encodeURIComponent(r.externalId.replace('character:', ''))}`,
            })),
            viewAllHref: `/search?type=character&q=${encodeURIComponent(query.trim())}`,
          });
        }
        if (staffPage.results.length > 0) {
          extraSections.push({
            key: 'staff',
            heading: s.search_section_staff,
            rows: staffPage.results.slice(0, SECTION_CAP).map((r: AniListStaffSearchResult) => ({
              key: `staff:${r.id}`,
              title: r.name,
              sub: r.nameNative ?? '',
              cover: toSmallCover(r.image),
              href: `/author?id=person:a${r.id}`,
            })),
            viewAllHref: `/search?type=staff&q=${encodeURIComponent(query.trim())}`,
          });
        }
        if (userResults.length > 0) {
          extraSections.push({
            key: 'user',
            heading: s.search_section_users,
            rows: userResults.slice(0, SECTION_CAP).map((r: UserSearchResult) => ({
              key: r.userId,
              title: r.username,
              sub: '',
              cover: r.avatarUrl,
              href: `/user?id=${encodeURIComponent(r.userId)}`,
              isAvatar: true,
            })),
            viewAllHref: null,
          });
        }

        // Characters/Staff/Users always get their slot; media-type sections
        // (the more numerous, less "final destination" kind) yield first.
        const maxMedia = Math.max(0, MAX_TOTAL_SECTIONS - extraSections.length);
        setSections([...mediaSections.slice(0, maxMedia), ...extraSections]);
      } catch {
        if (!controller.signal.aborted) setSections([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [open, query, s, typeLabels]);

  const totalRows = useMemo(() => sections?.reduce((sum, sec) => sum + sec.rows.length, 0) ?? 0, [sections]);

  if (!open) return null;

  async function goTo(href: string) {
    setOpen(false);
    const { navigate } = await import('astro:transitions/client');
    navigate(href);
  }

  // "Ver todos" already has this exact query+type's results in hand — hands
  // them to /search (SearchIsland reads this same sessionStorage key) instead
  // of letting it re-run the identical fetch this component just made.
  function goToViewAll(section: Section) {
    if (!section.viewAllHref) return;
    const results = section.key === 'character' ? handoffRef.current.characterResults : handoffRef.current.byType.get(section.key);
    const hasMore = section.key === 'character' ? handoffRef.current.characterHasMore : handoffRef.current.hasMore;
    if (results && results.length > 0) {
      try {
        sessionStorage.setItem(STORAGE_KEYS.searchState, JSON.stringify({
          query: query.trim(),
          mediaType: section.key,
          results,
          status: 'done',
          page: 1,
          hasMore,
          sortField: 'releaseDate',
          sortDirection: 'desc',
        }));
      } catch { /* handoff is a pure optimization — a normal fetch still works without it */ }
    }
    goTo(section.viewAllHref);
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
        </div>

        {query.trim().length > 0 && query.trim().length < MIN_CHARS && (
          <p className="quick-search-hint">{s.search_min_chars}</p>
        )}

        {!loading && sections !== null && totalRows === 0 && (
          <p className="quick-search-hint">{s.search_no_results}</p>
        )}

        {!loading && sections !== null && totalRows > 0 && (
          <div className="quick-search-sections">
            {sections.map(section => (
              <div className="quick-search-section" key={section.key}>
                <div className="quick-search-section-header">
                  <h3 className="quick-search-section-title">{section.heading}</h3>
                  {section.viewAllHref && (
                    <button type="button" className="quick-search-view-all" onClick={() => goToViewAll(section)}>
                      {s.search_view_all}
                    </button>
                  )}
                </div>
                <div className="quick-search-section-grid">
                  {section.rows.map(row => (
                    <button key={row.key} type="button" className="quick-search-result" onClick={() => goTo(row.href)}>
                      {row.cover
                        ? <img
                            className={row.isAvatar ? 'quick-search-result-avatar' : 'quick-search-result-cover'}
                            src={row.cover}
                            alt=""
                            loading="lazy"
                            referrerPolicy="no-referrer"
                          />
                        : <div className="quick-search-result-cover quick-search-result-cover--empty" />}
                      <span className="quick-search-result-text">
                        <span className="quick-search-result-title">{row.title}</span>
                        {row.sub && <span className="quick-search-result-sub">{row.sub}</span>}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

      </div>

      {loading && (
        <div className="quick-search-loading-bar">
          <div className="quick-search-loading-bar-fill" />
        </div>
      )}
    </div>
  );
}
