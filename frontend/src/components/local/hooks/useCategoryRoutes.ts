import { useState, useEffect, useCallback } from 'react';
import { readRoutes, writeRoutes, pickFolder, scanFolderContents, type LocalFolderEntry } from '../../../lib/tauri';
import type { CategoryId } from '../utils/constants';

export function useCategoryRoutes(activeCategory: CategoryId) {
  const [routes,       setRoutes]       = useState<Record<string, string>>({});
  const [folderFiles,  setFolderFiles]  = useState<LocalFolderEntry[]>([]);
  const [folderLoading, setFolderLoading] = useState(false);

  useEffect(() => {
    readRoutes().then(setRoutes).catch(() => {});
  }, []);

  useEffect(() => {
    if (activeCategory === 'videojuegos') return;
    const path = routes[activeCategory];
    if (!path) { setFolderFiles([]); return; }
    setFolderLoading(true);
    setFolderFiles([]);
    scanFolderContents(path)
      .then(setFolderFiles)
      .catch(() => setFolderFiles([]))
      .finally(() => setFolderLoading(false));
  }, [activeCategory, routes]);

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

  return { routes, folderFiles, folderLoading, setRoute, clearRoute };
}
