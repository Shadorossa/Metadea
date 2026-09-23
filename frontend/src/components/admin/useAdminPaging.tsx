import { useCallback, useMemo, useState } from 'react';
import { Pagination } from '../media/Pagination';

// Fifteen columns × three rows keeps each catalog page compact.
const ADMIN_PAGE_SIZE = 45;

// One page counter per list key ('local-media', 'sagas-github', ...), owned by
// the panel so a tab switch can reset every list at once; each tab resets on
// its own filter changes.
export function useAdminPaging() {
  const [pages, setPages] = useState<Record<string, number>>({});

  const pageItems = useCallback(<T,>(key: string, items: T[]) => {
    const totalPages = Math.max(1, Math.ceil(items.length / ADMIN_PAGE_SIZE));
    const currentPage = Math.min(Math.max(pages[key] ?? 1, 1), totalPages);
    return {
      currentPage,
      totalPages,
      items: items.slice((currentPage - 1) * ADMIN_PAGE_SIZE, currentPage * ADMIN_PAGE_SIZE),
    };
  }, [pages]);

  const renderPagination = useCallback((key: string, totalPages: number, currentPage: number) => (
    <Pagination
      currentPage={currentPage}
      totalPages={totalPages}
      onChange={page => setPages(previous => ({ ...previous, [key]: page }))}
    />
  ), []);

  const resetPages = useCallback(() => setPages({}), []);

  return useMemo(() => ({ pageItems, renderPagination, resetPages }), [pageItems, renderPagination, resetPages]);
}

export type AdminPaging = ReturnType<typeof useAdminPaging>;
