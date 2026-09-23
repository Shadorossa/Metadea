import { useCallback, useEffect, useRef, useState } from 'react';
import { useKeyedState } from '../../shared/hooks/useKeyedState';
import {
  raConsoleForPlatform, raGetGameProgress, raGetLink, raLookupByHash, raMatchByName, raRemoveLink,
  raSetLink, raStatus,
  type RaCached, type RaGameProgress, type RaLink, type RaMatchedBy, type RaStatus,
} from '../../../lib/tauri/retro-achievements';
import { listenGameSessionEnded } from '../../../lib/tauri/game-launch';
import { diffUnlocks, formatUnlockToast } from '../../../lib/retro-achievements/progress-summary';
import { formatAppError, parseAppError } from '../../../lib/errors/format-error';
import { showToast } from '../../../lib/dom/toast';
import { getT } from '../../../i18n/runtime';

// What the panel needs to know about the library entry it sits under. The
// ROM detail panel (agent A's area) passes its game link; every field but
// externalId is optional and only widens what auto-linking can try.
export interface RetroAchievementsTarget {
  externalId: string;
  // The ROM file, for hash matching (the reliable path).
  romPath?: string | null;
  // The emulator platform id ("ds", "ps2", ...) and/or the IGDB platform id,
  // either of which resolves the RA console.
  romPlatform?: string | null;
  igdbPlatformId?: number | null;
  // A clean title, for name matching when the hash finds nothing.
  title?: string | null;
}

export interface RetroAchievementsState {
  // null while the first status read is in flight.
  status: RaStatus | null;
  // null = RA has no set for this system (the panel hides itself).
  consoleId: number | null | undefined;
  link: RaLink | null;
  progress: RaCached<RaGameProgress> | null;
  loading: boolean;
  linking: boolean;
  // Translated message for a failed read/link, if any.
  error: string | null;
  // true when auto-linking ran and found nothing.
  noMatch: boolean;
  refresh: (force?: boolean) => Promise<void>;
  autoLink: () => Promise<void>;
  linkManually: (raGameId: number) => Promise<void>;
  unlink: () => Promise<void>;
}

function formatError(err: unknown): string {
  return formatAppError(err, getT());
}

export function useRetroAchievements(target: RetroAchievementsTarget | null): RetroAchievementsState {
  const externalId = target?.externalId ?? null;
  const romPath = target?.romPath ?? null;
  const romPlatform = target?.romPlatform ?? null;
  const igdbPlatformId = target?.igdbPlatformId ?? null;
  const title = target?.title ?? null;

  const [status, setStatus] = useState<RaStatus | null>(null);
  // Everything below is per entry: keyed on externalId so it resets during
  // render when the panel moves to another game, with no effect-time writes.
  const [consoleId, setConsoleId] = useKeyedState<number | null | undefined>(externalId, undefined);
  const [link, setLink] = useKeyedState<RaLink | null>(externalId, null);
  const [progress, setProgress] = useKeyedState<RaCached<RaGameProgress> | null>(externalId, null);
  const [loading, setLoading] = useKeyedState(externalId, true);
  const [linking, setLinking] = useKeyedState(externalId, false);
  const [error, setError] = useKeyedState<string | null>(externalId, null);
  const [noMatch, setNoMatch] = useKeyedState(externalId, false);
  // The last progress seen, for the post-session unlock diff.
  const lastProgressRef = useRef<RaGameProgress | null>(null);
  const linkRef = useRef<RaLink | null>(null);
  const autoLinkedRef = useRef<string | null>(null);

  const loadProgress = useCallback(async (raGameId: number, force: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const fresh = await raGetGameProgress(raGameId, force);
      setProgress(fresh);
      lastProgressRef.current = fresh.data;
    } catch (err) {
      setError(formatError(err));
    } finally {
      setLoading(false);
    }
  }, [setLoading, setError, setProgress]);

  const saveLink = useCallback(async (raGameId: number, matchedBy: RaMatchedBy, romHash?: string | null) => {
    if (!externalId) return;
    const saved = await raSetLink(externalId, raGameId, matchedBy, romHash);
    linkRef.current = saved;
    setLink(saved);
    setNoMatch(false);
    await loadProgress(saved.raGameId, false);
  }, [externalId, loadProgress, setLink, setNoMatch]);

  // Hash first (reliable, offline once the console's list is cached), then
  // the console's game list by title. Only the last failure is surfaced.
  const autoLink = useCallback(async () => {
    if (!externalId || !consoleId) return;
    setLinking(true);
    setError(null);
    let romHash: string | null = null;
    try {
      if (romPath) {
        try {
          const lookup = await raLookupByHash(romPath, consoleId);
          romHash = lookup.hash;
          if (lookup.gameId) {
            await saveLink(lookup.gameId, 'hash', romHash);
            return;
          }
        } catch (err) {
          // A build without the hasher or a file rc_hash rejects: the name
          // path below still applies, so only report when it fails too.
          if (parseAppError(String(err))?.code === 'E_RA_NOT_CONFIGURED') throw err;
        }
      }
      if (title) {
        const match = await raMatchByName(title, consoleId);
        if (match) {
          await saveLink(match.id, 'name', romHash);
          return;
        }
      }
      setNoMatch(true);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setLinking(false);
    }
  }, [externalId, consoleId, romPath, title, saveLink, setLinking, setError, setNoMatch]);

  const linkManually = useCallback(async (raGameId: number) => {
    setLinking(true);
    setError(null);
    try {
      await saveLink(raGameId, 'manual');
    } catch (err) {
      setError(formatError(err));
    } finally {
      setLinking(false);
    }
  }, [saveLink, setLinking, setError]);

  const unlink = useCallback(async () => {
    if (!externalId) return;
    try {
      await raRemoveLink(externalId);
      linkRef.current = null;
      lastProgressRef.current = null;
      setLink(null);
      setProgress(null);
      setNoMatch(false);
    } catch (err) {
      setError(formatError(err));
    }
  }, [externalId, setLink, setProgress, setNoMatch, setError]);

  const refresh = useCallback(async (force = true) => {
    const current = linkRef.current;
    if (current) await loadProgress(current.raGameId, force);
  }, [loadProgress]);

  // Status + console + existing link for the current entry.
  useEffect(() => {
    let cancelled = false;
    linkRef.current = null;
    lastProgressRef.current = null;
    if (!externalId) return;
    (async () => {
      const [nextStatus, nextConsole, existing] = await Promise.all([
        raStatus(),
        raConsoleForPlatform(igdbPlatformId, romPlatform),
        raGetLink(externalId),
      ]);
      if (cancelled) return;
      setStatus(nextStatus);
      setConsoleId(nextConsole);
      linkRef.current = existing;
      setLink(existing);
      if (existing && nextStatus.configured) {
        await loadProgress(existing.raGameId, false);
      } else {
        setLoading(false);
      }
    })().catch(err => {
      if (cancelled) return;
      setError(formatError(err));
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [externalId, igdbPlatformId, romPlatform, loadProgress, setConsoleId, setLink, setLoading, setError]);

  // First time an entry with no link shows up on a supported console with
  // RA configured: try to link it once, automatically.
  useEffect(() => {
    if (!externalId || !status?.configured || !consoleId || link || loading || linking) return;
    if (autoLinkedRef.current === externalId) return;
    autoLinkedRef.current = externalId;
    void autoLink();
  }, [externalId, status, consoleId, link, loading, linking, autoLink]);

  // After the game's own session ends, re-read progress and announce what
  // the session unlocked.
  useEffect(() => {
    if (!externalId) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    listenGameSessionEnded(({ external_id }) => {
      if (external_id !== externalId || !linkRef.current) return;
      const before = lastProgressRef.current;
      raGetGameProgress(linkRef.current.raGameId, true).then(fresh => {
        if (cancelled) return;
        setProgress(fresh);
        lastProgressRef.current = fresh.data;
        const t = getT().retro_achievements;
        const message = formatUnlockToast(diffUnlocks(before, fresh.data).count, {
          one: t.unlocked_toast_one,
          many: t.unlocked_toast_many,
        });
        if (message) showToast(message, 'success');
      }).catch(err => {
        if (!cancelled) setError(formatError(err));
      });
    }).then(fn => { if (cancelled) fn(); else unlisten = fn; });
    return () => { cancelled = true; unlisten?.(); };
  }, [externalId, setProgress, setError]);

  return { status, consoleId, link, progress, loading, linking, error, noMatch, refresh, autoLink, linkManually, unlink };
}
