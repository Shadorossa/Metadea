import { useState, useEffect, useRef, useCallback } from 'react';
import type { LocalGame } from '../../../lib/tauri';
import type { PlatformId, CategoryId } from '../utils/constants';

export function useActivePlatform(games: LocalGame[], activeCategory: CategoryId, gamesState: string) {
  const [activePlatform, setActivePlatform] = useState<PlatformId | null>(null);
  const sectionRefs = useRef<Map<string, HTMLElement>>(new Map());

  useEffect(() => {
    if (activeCategory !== 'videojuegos' || gamesState !== 'done') return;
    const observer = new IntersectionObserver(
      entries => {
        const visible = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0)
          setActivePlatform(visible[0].target.id.replace('launcher-', '') as PlatformId);
      },
      { threshold: 0.25 },
    );
    sectionRefs.current.forEach(el => observer.observe(el));
    return () => observer.disconnect();
  }, [activeCategory, gamesState, games]);

  const scrollTo = useCallback((id: PlatformId) => {
    sectionRefs.current.get(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  return { activePlatform, sectionRefs, scrollTo };
}
