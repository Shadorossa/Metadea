import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import {
  getCatalogEntry, saveCatalogEntry,
  getCachedSaga, saveCachedSaga,
  getMediaRelations, saveMediaRelations,
  getMediaAuthors,
} from '../../lib/tauri/catalog';
import type { MediaCatalogEntry, DbMediaRelation, DbMediaAuthor } from '../../lib/tauri/catalog';
import { getMediaCharacters, type MediaCharacter } from '../../lib/tauri/characters';
import type { SagaEntry } from '../../lib/anilist/saga';
import { search, type MediaType, type SearchResult as ApiSearchResult } from '../../lib/search';

const BUNDLE_RELATION_TYPES = ['EPISODE', 'UPDATE'];
const SAGA_RELATION_TYPES = ['PREQUEL', 'SEQUEL'];

// Every media type an API search can plausibly return — a saga/bundled-in
// relation isn't guaranteed to share the current entry's own type (e.g. a
// vnovel's saga can include a movie adaptation), so all of them are queried
// in parallel rather than restricting to the entry's own type.
const SEARCHABLE_TYPES: MediaType[] = ['anime', 'manga', 'lnovel', 'game', 'vnovel', 'movie', 'series', 'book'];

interface BundledRelation {
  external_id: string;
  type: 'episode' | 'update';
  title?: string | null;
  cover?: string | null;
}

interface Props {
  externalId: string;
  onClose: () => void;
  onSaved?: () => void;
}

// Ensures the id picked from a live API search is backed by a local catalog
// row — this is what makes external_id the same canonical value across every
// user's install (it's the API's own numeric id, not something invented
// locally). Only creates a thin skeleton when nothing exists yet: this must
// never overwrite a richer, already-cataloged row (save_catalog_entry is a
// full INSERT OR REPLACE, so writing a thin stub over an existing rich row
// would wipe its genres/synopsis/platforms/etc. back to null).
async function ensureSkeletonCatalogEntry(result: ApiSearchResult): Promise<void> {
  const existing = await getCatalogEntry(result.externalId).catch(() => null);
  if (existing) return;

  const now = new Date().toISOString();
  await saveCatalogEntry({
    id: '',
    external_id: result.externalId,
    type: result.type,
    format: result.format || null,
    source: result.source,
    title_main: result.titleMain,
    title_romaji: result.titleRomaji,
    title_native: result.titleNative,
    cover_url: result.coverUrl,
    release_year: result.releaseYear,
    release_month: result.releaseMonth,
    release_day: result.releaseDay,
    score_global: result.scoreGlobal,
    created_at: now,
    updated_at: now,
  }).catch(err => console.error('Failed to save skeleton catalog entry:', err));
}

type SearchSort = 'relevance' | 'title_asc' | 'year_desc' | 'year_asc' | 'score_desc';

const SORT_FNS: Record<SearchSort, (a: ApiSearchResult, b: ApiSearchResult) => number> = {
  relevance: () => 0,
  title_asc: (a, b) => (a.titleMain || '').localeCompare(b.titleMain || ''),
  year_desc: (a, b) => (b.releaseYear ?? -Infinity) - (a.releaseYear ?? -Infinity),
  year_asc: (a, b) => (a.releaseYear ?? Infinity) - (b.releaseYear ?? Infinity),
  score_desc: (a, b) => (b.scoreGlobal ?? -Infinity) - (a.scoreGlobal ?? -Infinity),
};

function MediaSearchPopup({ onSelect, onClose, excludeIds = [] }: { onSelect: (result: ApiSearchResult) => void; onClose: () => void; excludeIds?: string[] }) {
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<MediaType | 'all'>('all');
  const [sortBy, setSortBy] = useState<SearchSort>('relevance');
  const [results, setResults] = useState<ApiSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    const typesToQuery = typeFilter === 'all' ? SEARCHABLE_TYPES : [typeFilter];
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setIsLoading(true);
      Promise.all(typesToQuery.map(t => search(query, t, controller.signal).catch(() => [])))
        .then(perType => {
          if (controller.signal.aborted) return;
          setResults(perType.flat().slice(0, 60));
        })
        .finally(() => {
          if (!controller.signal.aborted) setIsLoading(false);
        });
    }, 400);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, typeFilter]);

  const handleSelect = async (result: ApiSearchResult) => {
    onClose();
    await ensureSkeletonCatalogEntry(result);
    onSelect(result);
  };

  const sortedResults = [...results].sort(SORT_FNS[sortBy]);
  const filteredResults = sortedResults.filter(r => !excludeIds.includes(r.externalId));

  return (
    <div className="pr-editor-search-popup" onClick={e => { e.stopPropagation(); onClose(); }}>
      <div className="pr-editor-search-popup-content pr-editor-search-popup-content--wide" onClick={e => e.stopPropagation()}>
        <div className="pr-editor-search-controls">
          <input
            type="text"
            placeholder="Search titles across AniList, IGDB, TMDB, OpenLibrary..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            autoFocus
            className="pr-editor-search-input"
          />
          <select
            className="pr-editor-search-select"
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value as MediaType | 'all')}
          >
            <option value="all">All types</option>
            <option value="anime">Anime</option>
            <option value="manga">Manga</option>
            <option value="lnovel">Light Novel</option>
            <option value="game">Game</option>
            <option value="vnovel">Visual Novel</option>
            <option value="movie">Movie</option>
            <option value="series">Series</option>
            <option value="book">Book</option>
          </select>
          <select
            className="pr-editor-search-select"
            value={sortBy}
            onChange={e => setSortBy(e.target.value as SearchSort)}
          >
            <option value="relevance">Relevance</option>
            <option value="title_asc">Title A-Z</option>
            <option value="year_desc">Newest first</option>
            <option value="year_asc">Oldest first</option>
            <option value="score_desc">Highest score</option>
          </select>
        </div>
        <div className="pr-editor-search-results pr-editor-search-results--grid">
          {isLoading && <div className="pr-editor-search-loading">Searching...</div>}
          {!isLoading && filteredResults.length === 0 && query && (
            <div className="pr-editor-search-empty">No results</div>
          )}
          <div className="pr-editor-search-grid">
            {filteredResults.map(r => (
              <button
                key={r.externalId}
                type="button"
                className="pr-editor-search-result-card"
                onClick={() => handleSelect(r)}
              >
                {r.coverUrl && (
                  <img src={r.coverUrl} alt="" className="pr-editor-search-result-cover" />
                )}
                <div className="pr-editor-search-result-info">
                  <div className="pr-editor-search-result-id">{r.externalId}</div>
                  <div className="pr-editor-search-result-title">{r.titleMain || '—'}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

interface SlotInputProps {
  label: string;
  value: string | null | undefined;
  onChange: (newValue: string | null) => void;
  placeholder?: string;
  /** Render each item as an image thumbnail (loaded from the item itself as
   *  a URL) instead of a plain text pill — used for banner URLs, where the
   *  raw string is meaningless to a reviewer but the image it points to
   *  isn't. */
  preview?: boolean;
  /** Span both grid columns instead of sharing a row with another field —
   *  only worth it for image-preview lists (thumbnails need the room); plain
   *  tag lists default to half-width so two of them share a row instead of
   *  each claiming a full row and stacking the whole form tall. */
  fullWidth?: boolean;
}

function SlotInput({ label, value, onChange, placeholder, preview, fullWidth }: SlotInputProps) {
  const items = value ? value.split(',').map(s => s.trim()).filter(Boolean) : [];
  const [inputVal, setInputVal] = useState('');

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const val = inputVal.trim();
      if (val && !items.includes(val)) {
        const next = [...items, val].join(',');
        onChange(next);
      }
      setInputVal('');
    } else if (e.key === 'Backspace' && !inputVal && items.length > 0) {
      const next = items.slice(0, -1).join(',');
      onChange(next || null);
    }
  };

  const handleRemove = (itemToRemove: string) => {
    const next = items.filter(i => i !== itemToRemove).join(',');
    onChange(next || null);
  };

  return (
    <div className={`pr-editor-field${fullWidth ? ' pr-editor-field--full' : ''}`}>
      <label>{label}</label>
      <div className={`pr-editor-slots-box${preview ? ' pr-editor-slots-box--preview' : ''}`}>
        {items.map(item => (
          preview ? (
            <div key={item} className="pr-editor-image-slot">
              <div className="pr-editor-image-slot-media">
                <img src={item} alt="" className="pr-editor-image-slot-img" />
                <button type="button" className="pr-editor-image-slot-remove" onClick={() => handleRemove(item)}>×</button>
              </div>
              <span className="pr-editor-image-slot-url" title={item}>{item}</span>
            </div>
          ) : (
            <span key={item} className="pr-editor-slot-pill">
              {item}
              <button type="button" className="pr-editor-slot-remove" onClick={() => handleRemove(item)}>×</button>
            </span>
          )
        ))}
        <input
          type="text"
          className="pr-editor-slot-input"
          placeholder={placeholder || 'Press Enter or comma to add...'}
          value={inputVal}
          onChange={e => setInputVal(e.target.value)}
          onKeyDown={handleKeyDown}
        />
      </div>
    </div>
  );
}

export function PrEditorModal({ externalId, onClose, onSaved }: Props) {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [entry, setEntry] = useState<MediaCatalogEntry | null>(null);
  const [originalEntry, setOriginalEntry] = useState<MediaCatalogEntry | null>(null);

  const [bundledRelations, setBundledRelations] = useState<BundledRelation[]>([]);
  const [originalBundledIds, setOriginalBundledIds] = useState<Set<string>>(new Set());

  // Saga — one single ordered chain (chronological order), including this
  // entry itself. Every adjacent pair in this order gets a SEQUEL edge
  // (earlier → later) and a PREQUEL edge (later → earlier) on submit — for
  // every id in the chain, not just the one currently open in the editor.
  const [sagaOrder, setSagaOrder] = useState<string[]>([externalId]);
  const [originalSagaOrder, setOriginalSagaOrder] = useState<string[]>([externalId]);

  // Display-only metadata (cover/title) for saga members other than this
  // entry, so tags can show a thumbnail instead of a bare id — populated
  // either from the existing relation rows (which already join title/cover
  // from media_catalog) or from the live API search result the user picked.
  const [sagaMeta, setSagaMeta] = useState<Record<string, { title: string | null; cover: string | null }>>({});
  const [sagaRelationTypes, setSagaRelationTypes] = useState<Record<string, 'main' | 'alternative' | 'source' | 'episode' | 'update'>>({});
  const [draggedSagaIndex, setDraggedSagaIndex] = useState<number | null>(null);

  // Every other relation type (ADAPTATION, SIDE_STORY, SPIN_OFF, ...) is kept
  // as an untouched pass-through — save_media_relations replaces the *entire*
  // relation set for this media_external_id in one shot, so anything not
  // resurfaced here (e.g. from an AniList auto-sync) would otherwise be wiped
  // the moment this form saves.
  const [otherRelations, setOtherRelations] = useState<DbMediaRelation[]>([]);

  const [characters, setCharacters] = useState<MediaCharacter[]>([]);
  const [mediaAuthors, setMediaAuthors] = useState<DbMediaAuthor[]>([]);

  const [searchPopupMode, setSearchPopupMode] = useState<'saga' | 'bundled' | null>(null);

  useEffect(() => {
    getCatalogEntry(externalId)
      .then(res => {
        const resolved = res ?? {
          id: '',
          external_id: externalId,
          type: externalId.split(':')[0],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        setEntry(resolved);
        setOriginalEntry(resolved);
      })
      .catch(err => {
        console.error('Failed to get catalog entry:', err);
        setErrorMsg('Error reading local data');
      })
      .finally(() => setLoading(false));

    getMediaRelations(externalId)
      .then(rels => {
        const relsList = rels || [];
        const bundled = relsList.filter(r => BUNDLE_RELATION_TYPES.includes(r.relation_type));
        const prequels = relsList.filter(r => r.relation_type === 'PREQUEL');
        const sequels = relsList.filter(r => r.relation_type === 'SEQUEL');

        const chainTypes = ['ALTERNATIVE', 'SOURCE', 'EPISODE', 'UPDATE'];
        const chainRels = relsList.filter(r => chainTypes.includes(r.relation_type));

        const others = relsList.filter(r =>
          !BUNDLE_RELATION_TYPES.includes(r.relation_type) &&
          !SAGA_RELATION_TYPES.includes(r.relation_type) &&
          !chainTypes.includes(r.relation_type)
        );

        const bundledMapped = bundled.map(r => ({
          external_id: r.related_media_external_id,
          type: (r.relation_type === 'UPDATE' ? 'update' : 'episode') as BundledRelation['type'],
          title: r.title,
          cover: r.cover,
        }));
        setBundledRelations(bundledMapped);
        setOriginalBundledIds(new Set(bundledMapped.map(r => r.external_id)));

        const initialRelationTypes: Record<string, 'main' | 'alternative' | 'source' | 'episode' | 'update'> = {};
        const chainRelIds: string[] = [];
        for (const r of chainRels) {
          const type = r.relation_type.toLowerCase() as 'alternative' | 'source' | 'episode' | 'update';
          initialRelationTypes[r.related_media_external_id] = type;
          chainRelIds.push(r.related_media_external_id);
        }
        setSagaRelationTypes(initialRelationTypes);

        const prequelIds = prequels.map(r => r.related_media_external_id);
        const sequelIds = sequels.map(r => r.related_media_external_id);
        const initialChain = [
          ...prequelIds,
          externalId,
          ...sequelIds,
          ...chainRelIds.filter(id => !prequelIds.includes(id) && id !== externalId && !sequelIds.includes(id))
        ];
        setSagaOrder(initialChain);
        setOriginalSagaOrder(initialChain);

        const meta: Record<string, { title: string | null; cover: string | null }> = {};
        for (const r of [...prequels, ...sequels, ...chainRels]) {
          meta[r.related_media_external_id] = { title: r.title, cover: r.cover ?? null };
        }
        setSagaMeta(meta);

        setOtherRelations(others);
      })
      .catch(() => {
        setBundledRelations([]);
        setOtherRelations([]);
      });

    getMediaCharacters(externalId).then(setCharacters).catch(() => setCharacters([]));
    getMediaAuthors(externalId).then(setMediaAuthors).catch(() => setMediaAuthors([]));
  }, [externalId]);

  const addToSaga = (result: ApiSearchResult) => {
    if (!sagaOrder.includes(result.externalId)) setSagaOrder([...sagaOrder, result.externalId]);
    setSagaMeta(prev => ({ ...prev, [result.externalId]: { title: result.titleMain, cover: result.coverUrl } }));
  };
  const removeFromSaga = (external_id: string) => {
    if (external_id === externalId) return; // this entry can move, not leave its own saga
    setSagaOrder(sagaOrder.filter(id => id !== external_id));
  };
  const reorderSaga = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= sagaOrder.length || toIndex >= sagaOrder.length) return;
    const next = [...sagaOrder];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    setSagaOrder(next);
  };

  // Native HTML5 drag-and-drop is unreliable inside Tauri's webview, so
  // reordering is done with plain pointer events instead: press on a card,
  // then whichever card the pointer is currently over (found via
  // elementFromPoint + a data-saga-index marker) swaps into the dragged
  // card's slot live, left-to-right following the saga's chronological order.
  useEffect(() => {
    if (draggedSagaIndex === null) return;

    const handleMove = (e: PointerEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const card = el?.closest<HTMLElement>('[data-saga-index]');
      if (!card) return;
      const overIndex = parseInt(card.dataset.sagaIndex || '', 10);
      if (Number.isNaN(overIndex) || overIndex === draggedSagaIndex) return;
      reorderSaga(draggedSagaIndex, overIndex);
      setDraggedSagaIndex(overIndex);
    };
    const handleUp = () => setDraggedSagaIndex(null);

    document.addEventListener('pointermove', handleMove);
    document.addEventListener('pointerup', handleUp);
    return () => {
      document.removeEventListener('pointermove', handleMove);
      document.removeEventListener('pointerup', handleUp);
    };
  }, [draggedSagaIndex, sagaOrder]);

  const addBundledRelation = (result: ApiSearchResult) => {
    if (!bundledRelations.find(r => r.external_id === result.externalId)) {
      setBundledRelations([...bundledRelations, {
        external_id: result.externalId,
        type: 'episode',
        title: result.titleMain,
        cover: result.coverUrl,
      }]);
    }
  };

  const updateBundledRelation = (index: number, patch: Partial<BundledRelation>) => {
    setBundledRelations(bundledRelations.map((r, i) => i === index ? { ...r, ...patch } : r));
  };

  const removeBundledRelation = (index: number) => {
    setBundledRelations(bundledRelations.filter((_, i) => i !== index));
  };

  const handleChange = (field: keyof MediaCatalogEntry, value: any) => {
    if (!entry) return;
    setEntry({
      ...entry,
      [field]: value === '' ? null : value
    });
  };

  // Human-readable "- " bullet list of everything this proposal adds or
  // changes, used as the PR body — diffs catalog fields against the entry as
  // it was when the modal opened, plus set-differences for the relation
  // buckets this editor manages (bundled-in, saga order).
  const buildChangeSummary = (): string => {
    if (!entry) return '';
    const lines: string[] = [];

    const DIFF_FIELDS: Array<[keyof MediaCatalogEntry, string]> = [
      ['title_main', 'Main Title'], ['title_romaji', 'Romaji Title'], ['title_native', 'Native Title'],
      ['synopsis', 'Synopsis'], ['cover_url', 'Cover URL'], ['banners_csv', 'Banner URLs'],
      ['release_year', 'Release Year'], ['release_month', 'Release Month'], ['release_day', 'Release Day'],
      ['total_count', 'Episodes/Chapters'], ['total_count_2', 'Seasons/Volumes'],
      ['genres_csv', 'Genres'], ['genres_tag_csv', 'Themes/Tags'],
      ['platforms_csv', 'Platforms'], ['companies_cache_csv', 'Companies/Studios'], ['authors_csv', 'Authors/Staff'],
    ];
    for (const [field, label] of DIFF_FIELDS) {
      const before = originalEntry?.[field] ?? null;
      const after = entry[field] ?? null;
      if (before === after) continue;
      if (before == null || before === '') lines.push(`- Added ${label}: "${after}"`);
      else if (after == null || after === '') lines.push(`- Removed ${label} (was "${before}")`);
      else lines.push(`- Changed ${label}: "${before}" → "${after}"`);
    }

    const formatWork = (id: string, title?: string | null): string => {
      const displayTitle = title || (id === externalId ? entry?.title_main : null) || sagaMeta[id]?.title || null;
      return displayTitle ? `${displayTitle} (${id})` : id;
    };

    const addedBundled = bundledRelations.filter(r => !originalBundledIds.has(r.external_id));
    for (const r of addedBundled) lines.push(`- Added Bundled In: ${formatWork(r.external_id, r.title)} (${r.type})`);
    const removedBundled = [...originalBundledIds].filter(id => !bundledRelations.some(r => r.external_id === id));
    for (const id of removedBundled) lines.push(`- Removed Bundled In: ${formatWork(id)}`);

    const originalSagaIds = new Set(originalSagaOrder);
    const addedSaga = sagaOrder.filter(id => id !== externalId && !originalSagaIds.has(id));
    for (const id of addedSaga) {
      const type = sagaRelationTypes[id] || 'main';
      lines.push(`- Added to Saga: ${formatWork(id)} [type: ${type}]`);
    }
    const removedSaga = originalSagaOrder.filter(id => id !== externalId && !sagaOrder.includes(id));
    for (const id of removedSaga) lines.push(`- Removed from Saga: ${formatWork(id)}`);
    if (addedSaga.length === 0 && removedSaga.length === 0 && sagaOrder.join(',') !== originalSagaOrder.join(',') && sagaOrder.length > 1) {
      lines.push(`- Reordered Saga: ${sagaOrder.map(id => `${formatWork(id)} [type: ${sagaRelationTypes[id] || 'main'}]`).join(' → ')}`);
    } else if (sagaOrder.length > 1) {
      lines.push(`- Saga order: ${sagaOrder.map(id => `${formatWork(id)} [type: ${sagaRelationTypes[id] || 'main'}]`).join(' → ')}`);
    }

    if (characters.length > 0) lines.push(`- Includes ${characters.length} cached character(s)`);
    if (mediaAuthors.length > 0) lines.push(`- Includes ${mediaAuthors.length} cached author/staff credit(s)`);

    return lines.length > 0 ? lines.join('\n') : '- No field changes detected (metadata refresh only)';
  };

  const handleSubmit = async () => {
    if (!entry) return;
    setSubmitting(true);
    setErrorMsg('');
    setStatusMsg('Checking GitHub token...');

    try {
      const token = await invoke<string | null>('get_github_token').catch(() => null);
      if (!token) {
        throw new Error('Please log in with GitHub in Metadea Settings to submit proposals.');
      }

      await saveCatalogEntry(entry);

      // Resolves display metadata (title/cover) for any id in the chain —
      // this entry's own fields for itself, otherwise whatever the search
      // result (or the pre-existing relation row) gave us.
      const getMeta = (id: string): { title: string | null; cover: string | null } =>
        id === externalId
          ? { title: entry.title_main || externalId, cover: entry.cover_url || null }
          : sagaMeta[id] ?? { title: id, cover: null };

      // sagaOrder is the whole saga's chronological order (this entry
      // included) — walked pairwise so every adjacent pair produces a SEQUEL
      // edge (earlier → later) and a PREQUEL edge (later → earlier). That's
      // what automates prequel/sequel for *every* entry in the saga, not just
      // the one currently open in the editor.
      const fullChain = sagaOrder;
      type TaggedRelation = DbMediaRelation & { media_external_id: string };
      const chainRelations: TaggedRelation[] = [];

      interface InstallmentGroup {
        mainId: string;
        allIds: string[];
      }
      const groups: InstallmentGroup[] = [];
      const nonGroupRelations: { id: string; mainId: string; type: 'source' | 'episode' | 'update' }[] = [];

      for (const id of fullChain) {
        const relType = sagaRelationTypes[id] || 'main';
        if (relType === 'main' || groups.length === 0) {
          groups.push({ mainId: id, allIds: [id] });
        } else if (relType === 'alternative') {
          groups[groups.length - 1].allIds.push(id);
        } else {
          const activeMainId = groups[groups.length - 1].mainId;
          nonGroupRelations.push({ id, mainId: activeMainId, type: relType });
        }
      }

      // 1. Generate Prequel/Sequel between adjacent groups
      for (let g = 0; g < groups.length - 1; g++) {
        const prevGroup = groups[g];
        const nextGroup = groups[g + 1];
        for (const prevId of prevGroup.allIds) {
          for (const nextId of nextGroup.allIds) {
            chainRelations.push({
              media_external_id: prevId,
              related_media_external_id: nextId,
              relation_type: 'SEQUEL',
              type_label: 'Sequel',
              title: getMeta(nextId).title || nextId,
              cover: getMeta(nextId).cover,
            });
            chainRelations.push({
              media_external_id: nextId,
              related_media_external_id: prevId,
              relation_type: 'PREQUEL',
              type_label: 'Prequel',
              title: getMeta(prevId).title || prevId,
              cover: getMeta(prevId).cover,
            });
          }
        }
      }

      // 2. Generate Alternative relations within each group
      for (const group of groups) {
        const mainId = group.mainId;
        for (const altId of group.allIds) {
          if (altId !== mainId) {
            chainRelations.push({
              media_external_id: mainId,
              related_media_external_id: altId,
              relation_type: 'ALTERNATIVE',
              type_label: 'Alternative Version',
              title: getMeta(altId).title || altId,
              cover: getMeta(altId).cover,
            });
            chainRelations.push({
              media_external_id: altId,
              related_media_external_id: mainId,
              relation_type: 'ALTERNATIVE',
              type_label: 'Alternative Version',
              title: getMeta(mainId).title || mainId,
              cover: getMeta(mainId).cover,
            });
          }
        }
      }

      // 3. Generate Non-Group relations (source, episode, update)
      for (const rel of nonGroupRelations) {
        if (rel.type === 'source') {
          chainRelations.push({
            media_external_id: rel.mainId,
            related_media_external_id: rel.id,
            relation_type: 'SOURCE',
            type_label: 'Source Material',
            title: getMeta(rel.id).title || rel.id,
            cover: getMeta(rel.id).cover,
          });
          chainRelations.push({
            media_external_id: rel.id,
            related_media_external_id: rel.mainId,
            relation_type: 'ADAPTATION',
            type_label: 'Adaptation',
            title: getMeta(rel.mainId).title || rel.mainId,
            cover: getMeta(rel.mainId).cover,
          });
        } else if (rel.type === 'episode') {
          chainRelations.push({
            media_external_id: rel.mainId,
            related_media_external_id: rel.id,
            relation_type: 'EPISODE',
            type_label: 'Episode',
            title: getMeta(rel.id).title || rel.id,
            cover: getMeta(rel.id).cover,
          });
          chainRelations.push({
            media_external_id: rel.id,
            related_media_external_id: rel.mainId,
            relation_type: 'PART_OF',
            type_label: 'Part of',
            title: getMeta(rel.mainId).title || rel.mainId,
            cover: getMeta(rel.mainId).cover,
          });
        } else if (rel.type === 'update') {
          chainRelations.push({
            media_external_id: rel.mainId,
            related_media_external_id: rel.id,
            relation_type: 'UPDATE',
            type_label: 'Update',
            title: getMeta(rel.id).title || rel.id,
            cover: getMeta(rel.id).cover,
          });
          chainRelations.push({
            media_external_id: rel.id,
            related_media_external_id: rel.mainId,
            relation_type: 'PART_OF',
            type_label: 'Part of',
            title: getMeta(rel.mainId).title || rel.mainId,
            cover: getMeta(rel.mainId).cover,
          });
        }
      }

      // Local SagaViewer cache (separate feature/table from media_relations
      // above) — still gets the full ordered chain so grouping/browsing keeps
      // working exactly as before.
      if (fullChain.length > 1) {
        const chain: SagaEntry[] = fullChain.map(id => id === externalId ? {
          externalId,
          title: entry.title_main || externalId,
          cover: entry.cover_url || null,
          format: entry.format || null,
          mediaType: entry.type,
          year: entry.release_year ?? null,
          month: entry.release_month ?? null,
          day: entry.release_day ?? null,
        } : {
          externalId: id,
          title: getMeta(id).title || id,
          cover: getMeta(id).cover,
          format: null,
          mediaType: id.split(':')[0] || 'anime',
          year: null,
          month: null,
          day: null,
        });
        await saveCachedSaga(chain).catch(err => console.error('Failed to save saga:', err));
      }

      const bundledDbRelations: DbMediaRelation[] = bundledRelations
        .filter(r => r.external_id.trim())
        .map(r => ({
          related_media_external_id: r.external_id.trim(),
          relation_type: r.type.toUpperCase(),
          type_label: r.type === 'update' ? 'Update' : 'Episode',
          title: r.title || r.external_id.trim(),
          cover: r.cover ?? null,
        }));

      // Current entry: otherRelations (untouched pass-through) + Bundled In +
      // its own slice of the chain-derived edges.
      const currentChainRows = chainRelations.filter(r => r.media_external_id === externalId);
      const currentFinalRelations: DbMediaRelation[] = [...otherRelations, ...bundledDbRelations, ...currentChainRows];
      await saveMediaRelations(externalId, currentFinalRelations)
        .catch(err => console.error('Failed to save relations:', err));

      // Every other entry in the chain also needs its own new prequel/sequel
      // edge written locally — fetch its existing relations first so this
      // only replaces the specific PREQUEL/SEQUEL edges pointing at something
      // inside this chain, keeping everything else (including any prequel/
      // sequel to media outside this chain) untouched.
      const otherChainIds = [...new Set(fullChain.filter(id => id !== externalId))];
      for (const otherId of otherChainIds) {
        try {
          const existing = await getMediaRelations(otherId);
          const chainTypes = ['PREQUEL', 'SEQUEL', 'ALTERNATIVE', 'SOURCE', 'ADAPTATION', 'EPISODE', 'UPDATE', 'PART_OF'];
          const kept = (existing || []).filter(r =>
            !(chainTypes.includes(r.relation_type) && fullChain.includes(r.related_media_external_id))
          );
          const newRows = chainRelations.filter(r => r.media_external_id === otherId);
          await saveMediaRelations(otherId, [...kept, ...newRows]);
        } catch (err) {
          console.error(`Failed to propagate saga relation to ${otherId}:`, err);
        }
      }

      if (onSaved) onSaved();

      setStatusMsg('Fetching GitHub profile...');
      const user = await invoke<any>('get_github_user_profile', { token });
      const username = user.login;

      // The PR touches more than the flat catalog row — it's a bundle so a
      // single collaborative-catalog file can also carry the entry's
      // characters, authors, and relations (bundled-in episodes/updates plus
      // the whole saga chain's prequel/sequel edges — tagged per-media since
      // the chain spans more than just this entry) into the shared community
      // database (see scripts/build-database.js, which fans each field out
      // into its own table by that tag instead of assuming everything
      // belongs to this file's own entry).
      const bundle = {
        media_catalog: entry,
        media_relations: [
          ...currentFinalRelations.map(r => ({ ...r, media_external_id: externalId })),
          ...chainRelations.filter(r => r.media_external_id !== externalId),
        ],
        characters,
        media_authors: mediaAuthors,
      };
      const changeSummary = buildChangeSummary();

      const jsonContent = JSON.stringify(bundle, null, 2);
      const base64Content = btoa(unescape(encodeURIComponent(jsonContent)));
      const repoOwner = 'Shadorossa';
      const repoName = 'Metadea';
      const filePath = `database/${externalId.replace(':', '-')}.json`;
      const branchName = `proposal-${externalId.replace(':', '-')}-${username}`;

      const isOwner = username.toLowerCase() === repoOwner.toLowerCase();
      let targetRepoOwner = repoOwner;

      if (!isOwner) {
        setStatusMsg('Creating repository fork...');
        const forkRes = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/forks`, {
          method: 'POST',
          headers: {
            'Authorization': `token ${token}`,
            'Accept': 'application/vnd.github.v3+json'
          }
        });
        if (!forkRes.ok && forkRes.status !== 202) {
          throw new Error('Failed to create repository fork on GitHub.');
        }
        targetRepoOwner = username;
        setStatusMsg('Waiting for GitHub to prepare the fork (3s)...');
        await new Promise(r => setTimeout(r, 3000));
      }

      setStatusMsg('Getting main branch references...');
      const mainBranchRes = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/git/ref/heads/main`, {
        headers: { 'Authorization': `token ${token}` }
      });
      if (!mainBranchRes.ok) {
        throw new Error('Failed to obtain main branch reference.');
      }
      const mainBranchData = await mainBranchRes.json();
      const mainSha = mainBranchData.object.sha;

      setStatusMsg('Creating proposal branch...');
      const createBranchRes = await fetch(`https://api.github.com/repos/${targetRepoOwner}/${repoName}/git/refs`, {
        method: 'POST',
        headers: {
          'Authorization': `token ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ref: `refs/heads/${branchName}`,
          sha: mainSha
        })
      });

      if (!createBranchRes.ok && createBranchRes.status !== 422) {
        throw new Error('Failed to create proposal branch.');
      }

      let fileSha: string | undefined;
      const fileCheckRes = await fetch(`https://api.github.com/repos/${targetRepoOwner}/${repoName}/contents/${filePath}?ref=${branchName}`, {
        headers: { 'Authorization': `token ${token}` }
      });
      if (fileCheckRes.ok) {
        const fileCheckData = await fileCheckRes.json();
        fileSha = fileCheckData.sha;
      }

      setStatusMsg('Uploading data to GitHub...');
      const commitRes = await fetch(`https://api.github.com/repos/${targetRepoOwner}/${repoName}/contents/${filePath}`, {
        method: 'PUT',
        headers: {
          'Authorization': `token ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: `Update catalog entry for ${entry.title_main || externalId}`,
          content: base64Content,
          branch: branchName,
          sha: fileSha
        })
      });

      if (!commitRes.ok) {
        throw new Error('Failed to commit JSON file to GitHub.');
      }

      // Always open a PR (even for the repo owner — a same-repo branch→main
      // PR works fine on GitHub) so the flow is consistent: every submission
      // ends with a real PR the app can open in the browser, prepared with a
      // dash-bulleted list of exactly what changed.
      setStatusMsg('Opening Pull Request...');
      const prBody = `Proposal submitted from Metadea desktop application by user @${username}.\n\nUpdates collaborative catalog data for **${entry.title_main || externalId}** (\`${externalId}\`).\n\n### Changes\n${changeSummary}`;
      const prRes = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/pulls`, {
        method: 'POST',
        headers: {
          'Authorization': `token ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title: `[Proposal] Catalog data for ${entry.title_main || externalId}`,
          head: isOwner ? branchName : `${username}:${branchName}`,
          base: 'main',
          body: prBody,
        })
      });

      let prUrl: string | null = null;
      if (!prRes.ok) {
        const prData = await prRes.json();
        if (prData.errors?.[0]?.message?.includes('A pull request already exists')) {
          setStatusMsg('Proposal uploaded! An active Pull Request already exists.');
          const existingRes = await fetch(
            `https://api.github.com/repos/${repoOwner}/${repoName}/pulls?head=${isOwner ? repoOwner : username}:${branchName}&state=open`,
            { headers: { 'Authorization': `token ${token}` } }
          );
          if (existingRes.ok) {
            const existing = await existingRes.json();
            prUrl = existing?.[0]?.html_url ?? null;
          }
        } else {
          throw new Error('Failed to open Pull Request.');
        }
      } else {
        setStatusMsg('Proposal submitted successfully!');
        const prData = await prRes.json();
        prUrl = prData.html_url ?? null;
      }

      if (prUrl) {
        const tauri = (window as any).__TAURI__;
        if (tauri?.opener?.openUrl) {
          tauri.opener.openUrl(prUrl);
        } else {
          window.open(prUrl, '_blank');
        }
      }

      setTimeout(() => {
        onClose();
      }, 1500);

    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || 'Error communicating with GitHub API');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="pr-editor-overlay">
        <div className="pr-editor-modal pr-editor-modal--loading">
          <div className="spinner" />
        </div>
      </div>
    );
  }

  if (!entry) return null;

  return createPortal(
    <div className="pr-editor-overlay" onClick={onClose}>
      <div className="pr-editor-modal" onClick={e => e.stopPropagation()}>
        <div className="pr-editor-header">
          <span className="pr-editor-title">Edit Collaborative Catalog Entry</span>
          <span className="pr-editor-subtitle">ID: {externalId}</span>
        </div>

        <div className="pr-editor-body">
          {errorMsg && <div className="pr-editor-alert pr-editor-alert--error">{errorMsg}</div>}
          {statusMsg && <div className="pr-editor-alert pr-editor-alert--status">{statusMsg}</div>}

          <div className="pr-editor-section">
            <span className="pr-editor-section-title">Titles &amp; Synopsis</span>
            <div className="pr-editor-form-grid">
              <div className="pr-editor-field">
                <label>Main Title</label>
                <input type="text" value={entry.title_main || ''} onChange={e => handleChange('title_main', e.target.value)} />
              </div>

              <div className="pr-editor-field">
                <label>Romaji Title</label>
                <input type="text" value={entry.title_romaji || ''} onChange={e => handleChange('title_romaji', e.target.value)} />
              </div>

              <div className="pr-editor-field">
                <label>Native Title</label>
                <input type="text" value={entry.title_native || ''} onChange={e => handleChange('title_native', e.target.value)} />
              </div>

              <div className="pr-editor-field pr-editor-field--full">
                <label>Synopsis / Description</label>
                <textarea rows={4} value={entry.synopsis || ''} onChange={e => handleChange('synopsis', e.target.value)} />
              </div>
            </div>
          </div>

          <div className="pr-editor-section">
            <span className="pr-editor-section-title">Images</span>
            <div className="pr-editor-field-row">
              <div className="pr-editor-field pr-editor-field--fixed">
                <label>Cover URL</label>
                <div className="pr-editor-cover-row">
                  {entry.cover_url && (
                    <img src={entry.cover_url} alt="" className="pr-editor-cover-preview" />
                  )}
                  <input type="text" value={entry.cover_url || ''} onChange={e => handleChange('cover_url', e.target.value)} />
                </div>
              </div>

              <SlotInput label="Banner URLs" value={entry.banners_csv} onChange={v => handleChange('banners_csv', v)} preview />
            </div>
          </div>

          <div className="pr-editor-section">
            <span className="pr-editor-section-title">Classification</span>
            <div className="pr-editor-form-grid">
              <SlotInput label="Genres" value={entry.genres_csv} onChange={v => handleChange('genres_csv', v)} />
              <SlotInput label="Themes / Tags" value={entry.genres_tag_csv} onChange={v => handleChange('genres_tag_csv', v)} />
              <SlotInput label="Platforms" value={entry.platforms_csv} onChange={v => handleChange('platforms_csv', v)} />
              <SlotInput label="Companies / Studios" value={entry.companies_cache_csv} onChange={v => handleChange('companies_cache_csv', v)} />
              <SlotInput label="Authors / Staff" value={entry.authors_csv} onChange={v => handleChange('authors_csv', v)} />
            </div>
          </div>

          <div className="pr-editor-section">
            <span className="pr-editor-section-title">Release &amp; Progress</span>
            <div className="pr-editor-field-row">
              <div className="pr-editor-subgroup">
                <span className="pr-editor-subgroup-label">Release Date</span>
                <div className="pr-editor-subgroup-fields">
                  <div className="pr-editor-field pr-editor-field--small">
                    <label>Year</label>
                    <input type="number" value={entry.release_year || ''} onChange={e => handleChange('release_year', e.target.value ? parseInt(e.target.value, 10) : null)} />
                  </div>
                  <div className="pr-editor-field pr-editor-field--small">
                    <label>Month</label>
                    <input type="number" value={entry.release_month || ''} onChange={e => handleChange('release_month', e.target.value ? parseInt(e.target.value, 10) : null)} />
                  </div>
                  <div className="pr-editor-field pr-editor-field--small">
                    <label>Day</label>
                    <input type="number" value={entry.release_day || ''} onChange={e => handleChange('release_day', e.target.value ? parseInt(e.target.value, 10) : null)} />
                  </div>
                </div>
              </div>

              <div className="pr-editor-subgroup-divider" />

              <div className="pr-editor-subgroup">
                <span className="pr-editor-subgroup-label">Totals</span>
                <div className="pr-editor-subgroup-fields">
                  <div className="pr-editor-field pr-editor-field--small">
                    <label>Episodes / Chapters</label>
                    <input type="number" value={entry.total_count || ''} onChange={e => handleChange('total_count', e.target.value ? parseInt(e.target.value, 10) : null)} />
                  </div>
                  <div className="pr-editor-field pr-editor-field--small">
                    <label>Seasons / Volumes</label>
                    <input type="number" value={entry.total_count_2 || ''} onChange={e => handleChange('total_count_2', e.target.value ? parseInt(e.target.value, 10) : null)} />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="pr-editor-section pr-editor-section--row">
            <div className="pr-editor-subsection pr-editor-subsection--saga">
              <label className="pr-editor-subsection-label">Saga order</label>
              <div className="pr-editor-media-grid">
                {sagaOrder.map((id, i) => {
                  const meta = id === externalId
                    ? { title: entry.title_main, cover: entry.cover_url }
                    : sagaMeta[id] ?? { title: null, cover: null };
                  return (
                    <div
                      key={id}
                      data-saga-index={i}
                      className={`pr-editor-media-card${id === externalId ? ' pr-editor-media-card--current' : ''}${draggedSagaIndex === i ? ' pr-editor-media-card--dragging' : ''}`}
                      onPointerDown={() => setDraggedSagaIndex(i)}
                    >
                      <div className="pr-editor-media-card-cover">
                        {meta.cover
                          ? <img src={meta.cover} alt="" draggable={false} />
                          : <div className="pr-editor-media-card-placeholder" />}
                        {id !== externalId && (
                          <button
                            type="button"
                            className="pr-editor-media-card-remove"
                            onPointerDown={e => e.stopPropagation()}
                            onClick={() => removeFromSaga(id)}
                          >×</button>
                        )}
                      </div>
                      <span className="pr-editor-media-card-title" title={id}>
                        {meta.title || id}{id === externalId ? ' (this entry)' : ''}
                      </span>
                      <select
                        className="pr-editor-media-card-select"
                        value={sagaRelationTypes[id] || 'main'}
                        onPointerDown={e => e.stopPropagation()}
                        onChange={e => {
                          const val = e.target.value as any;
                          setSagaRelationTypes(prev => ({ ...prev, [id]: val }));
                        }}
                      >
                        <option value="main">Main</option>
                        <option value="alternative">Alternative</option>
                        <option value="source">Source Material</option>
                        <option value="episode">Episode</option>
                        <option value="update">Update</option>
                      </select>
                    </div>
                  );
                })}
              </div>
              <button type="button" className="pr-editor-add-btn" onClick={() => setSearchPopupMode('saga')}>+ Add to Saga</button>
            </div>

            <div className="pr-editor-subsection">
              <label className="pr-editor-subsection-label">Bundled In</label>
              <div className="pr-editor-media-grid">
                {bundledRelations.map((r, i) => (
                  <div key={i} className="pr-editor-media-card">
                    <div className="pr-editor-media-card-cover">
                      {r.cover
                        ? <img src={r.cover} alt="" draggable={false} />
                        : <div className="pr-editor-media-card-placeholder" />}
                      <button type="button" className="pr-editor-media-card-remove" onClick={() => removeBundledRelation(i)}>×</button>
                    </div>
                    <span className="pr-editor-media-card-title" title={r.external_id}>{r.title || r.external_id}</span>
                    <select
                      value={r.type}
                      onChange={e => updateBundledRelation(i, { type: e.target.value as BundledRelation['type'] })}
                      className="pr-editor-media-card-select"
                    >
                      <option value="episode">Episode</option>
                      <option value="update">Update</option>
                    </select>
                  </div>
                ))}
              </div>
              <button type="button" className="pr-editor-add-btn" onClick={() => setSearchPopupMode('bundled')}>+ Add</button>
            </div>
          </div>
        </div>

        <div className="pr-editor-footer">
          <button type="button" className="pr-editor-btn pr-editor-btn--cancel" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="button" className="pr-editor-btn pr-editor-btn--submit" onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Submitting...' : 'Submit Proposal'}
          </button>
        </div>
      </div>

      {searchPopupMode === 'saga' && (
        <MediaSearchPopup
          onSelect={id => addToSaga(id)}
          onClose={() => setSearchPopupMode(null)}
          excludeIds={sagaOrder}
        />
      )}

      {searchPopupMode === 'bundled' && (
        <MediaSearchPopup
          onSelect={id => addBundledRelation(id)}
          onClose={() => setSearchPopupMode(null)}
          excludeIds={[externalId, ...bundledRelations.map(r => r.external_id)]}
        />
      )}
    </div>,
    document.body
  );
}
