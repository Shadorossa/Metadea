import { useState, useEffect, useCallback } from 'react';
import { readRoutes, writeRoutes, pickFolder, type LocalFolderEntry } from '../../../lib/tauri';
import { readLocalFolderContents, invalidateLocalFolderReads } from '../../../lib/local/local-read-cache';
import type { CategoryId } from '../../../lib/local/platforms';

export function useCategoryRoutes(activeCategory: CategoryId) {
  const [routes,       setRoutes]       = useState<Record<string, string>>({});
  const [folderFiles,  setFolderFiles]  = useState<LocalFolderEntry[]>([]);
  const [folderLoading, setFolderLoading] = useState(false);

  useEffect(() => {
    readRoutes().then(setRoutes).catch(() => {});
  }, []);

  // The root listing is memoised for the visit (see local-read-cache.ts):
  // switching to a category and back re-shows the same listing instead of
  // re-reading the folder each time. refetchFolder below drops that memo
  // first, so a listing taken after a rename is a real one.
  const rescan = useCallback((path: string, silent = false) => {
    if (!silent) { setFolderLoading(true); setFolderFiles([]); }
    return readLocalFolderContents(path)
      .then(setFolderFiles)
      .catch(() => setFolderFiles([]))
      .finally(() => { if (!silent) setFolderLoading(false); });
  }, []);

  useEffect(() => {
    if (activeCategory === 'videojuegos') return;
    const path = routes[activeCategory];
    if (!path) { setFolderFiles([]); return; }
    rescan(path);
  }, [activeCategory, routes, rescan]);

  // Re-reads the active category's root folder without flashing the loading
  // placeholder — used after the "Localizar" rename flow (LocalMediaDetailPanel)
  // so the freshly-renamed folder/files show up without switching tabs.
  const refetchFolder = useCallback(() => {
    const path = routes[activeCategory];
    if (!path) return Promise.resolve();
    invalidateLocalFolderReads();
    return rescan(path, true);
  }, [routes, activeCategory, rescan]);

  const setRoute = useCallback(async (category: CategoryId) => {
    const path = await pickFolder().catch(() => null);
    if (!path) return;
    const updated = { ...routes, [category]: path };
    setRoutes(updated);
    await writeRoutes(updated).catch(() => {});
  }, [routes]);

  const clearRoute = useCallback(async (category: CategoryId) => {
    const updated = { ...routes };
    delete updated[category];
    setRoutes(updated);
    setFolderFiles([]);
    await writeRoutes(updated).catch(() => {});
  }, [routes]);

  return { routes, folderFiles, folderLoading, setRoute, clearRoute, refetchFolder };
}
