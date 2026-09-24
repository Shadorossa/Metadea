// App-side announcements that plugins can subscribe to (event-bridge.ts
// turns them into `events` deliveries). A leaf module with no imports so the
// reader, the playback service and the game session code can emit without
// pulling the plugin runtime in.

export const SESSION_ENDED_EVENT = 'metadea:session-ended';

export type SessionKind = 'read' | 'watch' | 'play';

export interface SessionEndedDetail {
  externalId: string;
  kind: SessionKind;
}

export function emitSessionEnded(detail: SessionEndedDetail): void {
  if (typeof window === 'undefined' || !detail.externalId) return;
  window.dispatchEvent(new CustomEvent<SessionEndedDetail>(SESSION_ENDED_EVENT, { detail }));
}

/** Fired by Settings › Plugins after an install, toggle, uninstall or settings save. */
export const PLUGINS_CHANGED_EVENT = 'metadea:plugins-changed';

export interface PluginsChangedDetail {
  /** The plugin that changed; absent = reload everything. */
  pluginId?: string;
}

export function emitPluginsChanged(detail: PluginsChangedDetail = {}): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<PluginsChangedDetail>(PLUGINS_CHANGED_EVENT, { detail }));
}
