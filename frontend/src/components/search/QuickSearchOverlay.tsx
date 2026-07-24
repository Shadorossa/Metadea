// Navbar quick-search — opened by clicking the magnifying glass (see
// Navbar.astro, which dispatches 'metadea:open-quick-search' instead of
// navigating). A single centered input; every category (media types,
// characters, staff, users) searches in parallel and renders as its own
// AniList-style section, all merged into one grid instead of behind a
// category filter.
import { useEffect, useMemo, useRef, useState } from 'react';
import { search as searchMedia, type SearchResult } from '../../lib/search';
import { searchAniListStaff, type AniListStaffSearchResult } from '../../lib/search/providers/anilist';
import { searchUsers, type UserSearchResult } from '../../lib/social/users';
import { ALL_MEDIA_TYPES } from '../../lib/constants/media';
import { getT } from '../../i18n/client';

const DEBOUNCE_MS = 300;
const MIN_CHARS = 2;
const SECTION_CAP = 6;
// Sections render in a fixed 4-column grid (see .quick-search-sections) —
// capped to 2 rows' worth so the box never grows past that regardless of how
// many categories a query matches. Characters/Staff/Users always keep their
// slot; media-type sections fill whatever's left.
const SECTION_COLUMNS = 4;
const MAX_TOTAL_SECTIONS = SECTION_COLUMNS * 2;

interface Row {
  key: string;
  title: string;
  sub: string;
  cover: string | null;
  href: string;
}

interface Section {
  key: string;
  heading: string;
  rows: Row[];
  viewAllHref: string | null;
}

function mediaRowsByType(results: SearchResult[]): Map<string, Row[]> {
  const byType = new Map<string, Row[]>();
  for (const r of results) {
    const row: Row = {
      key: r.externalId,
      title: r.titleMain,
      sub: String(r.releaseYear ?? ''),
      cover: r.coverUrl,
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

        const byType = mediaRowsByType(mediaPage.results);
        const mediaSections: Section[] = ALL_MEDIA_TYPES
          .filter(t => t !== 'character' && byType.has(t))
          .map(t => ({
            key: t,
            heading: typeLabels[t as keyof typeof typeLabels] ?? t,
            rows: byType.get(t)!.slice(0, SECTION_CAP),
            viewAllHref: `/search?type=${t}&q=${encodeURIComponent(query)}`,
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
              cover: r.coverUrl,
              href: `/character?id=${encodeURIComponent(r.externalId.replace('character:', ''))}`,
            })),
            viewAllHref: `/search?type=character&q=${encodeURIComponent(query)}`,
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
              cover: r.image,
              href: `/author?id=person:a${r.id}`,
            })),
            viewAllHref: null,
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

        {loading && <p className="quick-search-hint">…</p>}

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
                    <button type="button" className="quick-search-view-all" onClick={() => goTo(section.viewAllHref!)}>
                      {s.search_view_all}
                    </button>
                  )}
                </div>
                <div className="quick-search-section-grid">
                  {section.rows.map(row => (
                    <button key={row.key} type="button" className="quick-search-result" onClick={() => goTo(row.href)}>
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
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
