// Mounted once in BaseLayout (transition:persist). On app start it compares
// the running version (Tauri getVersion(), the same source Settings shows in
// `.app-curr-ver`) with the last version whose notes the user acknowledged
// (STORAGE_KEYS.lastSeenChangelogVersion) and opens the "What's new" modal
// for the unseen releases — see lib/changelog/changelog-selection.ts for the
// rules. It also opens the full history from any `[data-open-changelog]`
// element (Settings › Environment › updates) or OPEN_CHANGELOG_EVENT.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangelogRelease } from '../../lib/changelog/parse-changelog';
import { compareVersions, decideChangelogLaunch } from '../../lib/changelog/changelog-selection';
import { STORAGE_KEYS } from '../../lib/storage/storage-keys';
import { ChangelogModal, type ChangelogModalMode } from './ChangelogModal';

export const OPEN_CHANGELOG_EVENT = 'metadea:open-changelog';

// Keys any install that has been used at least once carries. Their absence
// alongside a missing last-seen version means a fresh install.
const PRIOR_DATA_KEYS = [
  STORAGE_KEYS.onboardingCompleted,
  STORAGE_KEYS.authToken,
  STORAGE_KEYS.envConfig,
  STORAGE_KEYS.localFolders,
  STORAGE_KEYS.userFavorite,
] as const;

// Lets the page settle (hydration, startup update check) before the modal.
const AUTO_OPEN_DELAY_MS = 1200;

function readStorage(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

function writeStorage(key: string, value: string): void {
  try { window.localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}

function isTauriRuntime(): boolean {
  return '__TAURI_INTERNALS__' in window || '__TAURI__' in window;
}

async function loadReleases(): Promise<readonly ChangelogRelease[]> {
  const { CHANGELOG_RELEASES } = await import('../../lib/changelog/changelog-source');
  return CHANGELOG_RELEASES;
}

interface OpenState {
  mode: ChangelogModalMode;
  releases: readonly ChangelogRelease[];
}

export function ChangelogLauncher() {
  const [state, setState] = useState<OpenState | null>(null);
  // Running version to record once the unseen notes are dismissed.
  const pendingAckRef = useRef<string | null>(null);

  const acknowledge = useCallback(() => {
    if (pendingAckRef.current) writeStorage(STORAGE_KEYS.lastSeenChangelogVersion, pendingAckRef.current);
    pendingAckRef.current = null;
  }, []);

  const openAll = useCallback(() => {
    loadReleases()
      .then(releases => setState({ mode: 'all', releases }))
      .catch(error => console.error('[changelog] load failed', error));
  }, []);

  // Start-up check (desktop app only — the browser build has no app version).
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const { getVersion } = await import('@tauri-apps/api/app');
        const runningVersion = await getVersion();
        const lastSeenVersion = readStorage(STORAGE_KEYS.lastSeenChangelogVersion);
        if (lastSeenVersion !== null && compareVersions(runningVersion, lastSeenVersion) <= 0) return;

        const releases = await loadReleases();
        const decision = decideChangelogLaunch({
          runningVersion,
          lastSeenVersion,
          hasPriorData: PRIOR_DATA_KEYS.some(key => readStorage(key) !== null),
          releases,
        });
        if (cancelled) return;
        if (decision.kind === 'store') writeStorage(STORAGE_KEYS.lastSeenChangelogVersion, runningVersion);
        if (decision.kind === 'show') {
          pendingAckRef.current = runningVersion;
          setState({ mode: 'unseen', releases: decision.releases });
        }
      } catch (error) {
        console.error('[changelog] start-up check failed', error);
      }
    }, AUTO_OPEN_DELAY_MS);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, []);

  // Manual entry points: `[data-open-changelog]` buttons and the event.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest('[data-open-changelog]') : null;
      if (!target) return;
      event.preventDefault();
      openAll();
    };
    document.addEventListener('click', onClick);
    window.addEventListener(OPEN_CHANGELOG_EVENT, openAll);
    return () => {
      document.removeEventListener('click', onClick);
      window.removeEventListener(OPEN_CHANGELOG_EVENT, openAll);
    };
  }, [openAll]);

  const close = useCallback(() => {
    acknowledge();
    setState(null);
  }, [acknowledge]);

  const viewAll = useCallback(() => {
    acknowledge();
    openAll();
  }, [acknowledge, openAll]);

  if (!state) return null;
  return (
    <ChangelogModal
      key={state.mode}
      releases={state.releases}
      mode={state.mode}
      onClose={close}
      onViewAll={viewAll}
    />
  );
}
