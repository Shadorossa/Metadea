import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { SteamAchievement } from '../../lib/tauri';
import { getT } from '../../i18n/runtime';
import { mergeSteamEditionAchievements } from '../../lib/local/steam-achievements-merge';
import { AchievementCell } from '../local/details/AchievementCell';
export function AchievementIcons({ achievements, legacyAchievements, identity }: {
  achievements: SteamAchievement[];
  legacyAchievements?: SteamAchievement[];
  identity: string;
}) {
  const t = getT();
  const gridRef = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(1);
  const [page, setPage] = useState(0);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const observer = new ResizeObserver(([entry]) => {
      const cellSize = 38;
      const gap = 8;
      const nextColumns = Math.max(1, Math.floor((entry.contentRect.width + gap) / (cellSize + gap)));
      setColumns(current => current === nextColumns ? current : nextColumns);
    });
    observer.observe(grid);
    return () => observer.disconnect();
  }, []);

  const merged = mergeSteamEditionAchievements(
    { unlocked: achievements.filter(achievement => achievement.achieved > 0).length, total: achievements.length, list: achievements },
    legacyAchievements ? {
      unlocked: legacyAchievements.filter(achievement => achievement.achieved > 0).length,
      total: legacyAchievements.length,
      list: legacyAchievements,
    } : null,
  );
  if (!merged.list.length) return null;
  const capacity = columns * 2;
  const hasPagination = merged.list.length > capacity;
  const pageSize = hasPagination ? Math.max(1, capacity - 2) : capacity;
  const pageCount = hasPagination ? Math.ceil(merged.list.length / pageSize) : 1;
  const visiblePage = Math.min(page, pageCount - 1);
  const visibleAchievements = merged.list.slice(visiblePage * pageSize, (visiblePage + 1) * pageSize);

  return (
    <div className="profile-achievement-source">
      <div
        ref={gridRef}
        className="profile-achievement-icons"
        style={{ gridTemplateColumns: `repeat(${columns}, 38px)` }}
      >
        {visiblePage > 0 && <button
          type="button"
          className="profile-achievement-page-button"
          aria-label={t.reader.prev_page_aria}
          title={t.reader.prev_page_aria}
          onClick={() => setPage(current => Math.max(0, Math.min(current, pageCount - 1) - 1))}
        ><ChevronLeft size={19} aria-hidden="true" /></button>}
        {visibleAchievements.map(({ achievement, legacy }) => <AchievementCell
          key={`${identity}:${achievement.apiname}:${legacy ? 'legacy' : 'current'}`}
          ach={achievement}
          appId={identity}
          legacy={legacy}
        />)}
        {hasPagination && visiblePage < pageCount - 1 && <button
          type="button"
          className="profile-achievement-page-button"
          aria-label={t.reader.next_page_aria}
          title={t.reader.next_page_aria}
          onClick={() => setPage(current => Math.min(pageCount - 1, Math.min(current, pageCount - 1) + 1))}
        ><ChevronRight size={19} aria-hidden="true" /></button>}
      </div>
    </div>
  );
}

