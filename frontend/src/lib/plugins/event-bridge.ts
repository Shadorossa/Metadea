// Turns the app's own window events into the read-only plugin `events`
// (docs/PLUGINS.md, "events"). Payloads are deliberately minimal: ids and
// numbers, never library notes or account data. Registered once per page
// context from BaseLayout; workers only start for plugins that subscribe.
import { getPluginRuntime } from './runtime-instance';
import { SESSION_ENDED_EVENT, type SessionEndedDetail } from './host-events';
import type { PluginEventName } from './manifest';

const LIBRARY_DEBOUNCE_MS = 1_000;

function typeOf(externalId: string): string {
  return externalId.split(':')[0] ?? '';
}

let installed = false;

export function initPluginEventBridge(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const emit = (name: PluginEventName, payload: Record<string, unknown>) => {
    getPluginRuntime().emit(name, payload).catch(() => {});
  };

  // 'refresh-profile-library' fires after every library write, often in
  // bursts (an import saves hundreds of rows): one event per quiet second.
  let libraryTimer: ReturnType<typeof setTimeout> | null = null;
  window.addEventListener('refresh-profile-library', () => {
    if (libraryTimer) clearTimeout(libraryTimer);
    libraryTimer = setTimeout(() => {
      libraryTimer = null;
      emit('library.changed', {});
    }, LIBRARY_DEBOUNCE_MS);
  });

  window.addEventListener('metadea:episode-marked', event => {
    const detail = (event as CustomEvent<{ externalId?: unknown; episodeNumber?: unknown }>).detail;
    if (typeof detail?.externalId !== 'string' || typeof detail.episodeNumber !== 'number') return;
    emit('progress.changed', { externalId: detail.externalId, type: typeOf(detail.externalId), number: detail.episodeNumber });
  });

  window.addEventListener(SESSION_ENDED_EVENT, event => {
    const detail = (event as CustomEvent<SessionEndedDetail>).detail;
    if (!detail?.externalId) return;
    emit('session.ended', { externalId: detail.externalId, type: typeOf(detail.externalId), kind: detail.kind });
  });
}
