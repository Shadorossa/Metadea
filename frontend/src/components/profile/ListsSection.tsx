import { useEffect, useState } from 'react';
import {
  getAllUserLists, createUserList, getCustomImagesMap, type FavoriteCustomImage,
} from '../../lib/tauri';
import type { CatalogSummary, ListInfo, ListItemFull } from '../../lib/tauri';
import { getAllCharactersLight, type CharacterEntry } from '../../lib/tauri/characters';
import { getT } from '../../i18n/runtime';
import { getCachedLibraryAndCatalog } from '../../lib/profile/library-data-cache';
import { getCachedUserInfo } from '../../lib/profile/user-info';
import { beginGlobalLoading } from '../../lib/dom/global-loading';
import { ListsGrid } from './lists/ListsGrid';
import { ListDetail } from './lists/ListDetail';
import { TierProfileSection } from '../tier/TierProfileSection';

/* ── Top-level ──────────────────────────────────────────────────────────── */

interface ListsSectionProps {
  overrideLists?: ListInfo[];
  overrideCatalogMap?: Map<string, CatalogSummary>;
  overrideFetchItems?: (listKey: string) => Promise<ListItemFull[]>;
  readOnly?: boolean;
}

export function ListsSection({ overrideLists, overrideCatalogMap, overrideFetchItems, readOnly }: ListsSectionProps = {}) {
  const p = getT().profile;

  const [catalogMap, setCatalogMap] = useState<Map<string, CatalogSummary>>(overrideCatalogMap ?? new Map());
  const [charactersMap, setCharactersMap] = useState<Map<string, CharacterEntry>>(new Map());
  const [customImagesMap, setCustomImagesMap] = useState<Map<string, FavoriteCustomImage>>(new Map());
  const [username, setUsername] = useState('user');
  const [customLists, setCustomLists] = useState<ListInfo[]>(overrideLists ?? []);
  const [activeListKey, setActiveListKey] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get('list');
  });

  useEffect(() => {
    if (overrideLists) {
      setCustomLists(overrideLists);
    }
  }, [overrideLists]);

  useEffect(() => {
    if (overrideCatalogMap) {
      setCatalogMap(overrideCatalogMap);
    }
  }, [overrideCatalogMap]);

  const handleOpenList = (key: string | null) => {
    setActiveListKey(key);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      const current = url.searchParams.get('list');
      if (current === (key ?? null)) return;
      if (key) {
        url.searchParams.set('list', key);
        if (url.pathname === '/user') {
          url.searchParams.set('tab', 'lists');
        } else if (url.pathname === '/profile') {
          url.hash = 'lists';
        }
        history.pushState(history.state, '', url.toString());
      } else {
        url.searchParams.delete('list');
        history.pushState(history.state, '', url.toString());
      }
    }
  };

  useEffect(() => {
    const onPopState = () => {
      const listFromUrl = new URLSearchParams(window.location.search).get('list');
      setActiveListKey(listFromUrl);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // No blocking "Cargando..." placeholder here — the grid renders right
  // away (empty at first, or already filled from cache) while the global
  // bottom loading bar (BaseLayout.astro) shows the fetch is in flight.
  useEffect(() => {
    if (overrideLists) return;
    let cancelled = false;
    const endLoading = beginGlobalLoading();
    (async () => {
      try {
        const [{ catalog: catalogEntries }, allLists, profile, allChars, customImgs] = await Promise.all([
          getCachedLibraryAndCatalog(),
          getAllUserLists().catch(() => [] as ListInfo[]),
          getCachedUserInfo(),
          getAllCharactersLight().catch(() => [] as CharacterEntry[]),
          getCustomImagesMap().catch(() => new Map<string, FavoriteCustomImage>()),
        ]);
        if (cancelled) return;
        setCatalogMap(new Map(catalogEntries.map(e => [e.external_id, e])));
        setCharactersMap(new Map(allChars.map(c => [c.external_id, c])));
        setCustomImagesMap(customImgs);
        setUsername((profile.display_name as string | undefined)?.toLowerCase().replace(/\s+/g, '_') || 'user');
        setCustomLists(allLists.filter(l => !l.is_fav));
      } finally {
        endLoading();
      }
    })();
    return () => { cancelled = true; };
  }, [overrideLists]);

  const activeList = activeListKey ? customLists.find(l => l.key === activeListKey) : null;

  return (
    <>
    {/* Tier lists aren't in the synced public profile yet: owner view only. */}
    {!readOnly && <TierProfileSection />}
    <div className="lists-page-layout">
      <ListsGrid
        customLists={customLists}
        catalogMap={catalogMap}
        charactersMap={charactersMap}
        customImagesMap={customImagesMap}
        p={p}
        onOpen={handleOpenList}
        activeKey={activeListKey}
        readOnly={readOnly}
        onCreate={async (name, description) => {
          const key = await createUserList(username, name, description).catch(() => null);
          if (!key) return;
          setCustomLists(prev => [...prev, { key, name, description, is_fav: false, is_private: false, list_type: 'media', item_count: 0, preview_ids: [] }]);
        }}
      />
      <div className="list-detail-panel">
        {activeList ? (
          <ListDetail
            key={activeList.key}
            list={activeList}
            catalogMap={catalogMap}
            customImagesMap={customImagesMap}
            p={p}
            onBack={() => handleOpenList(null)}
            onDeleted={() => { setCustomLists(prev => prev.filter(l => l.key !== activeList.key)); handleOpenList(null); }}
            onMetaSaved={(name, description, isPrivate, listType, isRankedVal) => setCustomLists(prev => prev.map(l => l.key === activeList.key ? { ...l, name, description, is_private: isPrivate, ...(listType ? { list_type: listType } : {}), ...(isRankedVal !== undefined ? { is_ranked: isRankedVal } : {}) } : l))}
            onCountChanged={delta => setCustomLists(prev => prev.map(l => l.key === activeList.key ? { ...l, item_count: Math.max(0, l.item_count + delta) } : l))}
            readOnly={readOnly}
            fetchItems={overrideFetchItems}
          />
        ) : activeListKey && customLists.length === 0 ? (
          <div className="list-detail-panel-empty"></div>
        ) : (
          <div className="list-detail-panel-empty">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" /><rect x="9" y="3" width="6" height="4" rx="1" /></svg>
            <p>{p.lists_select_prompt}</p>
          </div>
        )}
      </div>
    </div>
    </>
  );
}
