import { useEffect, useState } from 'react';
import { getGamePlayStats, type GamePlayStats } from '../../../lib/tauri/game-launch';

// Playtime, last played and session count recorded by the Rust session
// registry (game_sessions.rs) for a library id; re-read after every library
// write ('refresh-profile-library', also fired when a session is recorded).
export function useGamePlayStats(externalId: string | null | undefined): GamePlayStats | null {
  const [stats, setStats] = useState<{ id: string; value: GamePlayStats | null } | null>(null);
  useEffect(() => {
    if (!externalId) return;
    let cancelled = false;
    const load = () => {
      getGamePlayStats(externalId)
        .then(value => { if (!cancelled) setStats({ id: externalId, value }); })
        .catch(() => {});
    };
    load();
    window.addEventListener('refresh-profile-library', load);
    return () => { cancelled = true; window.removeEventListener('refresh-profile-library', load); };
  }, [externalId]);
  return stats && stats.id === externalId ? stats.value : null;
}
