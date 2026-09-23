// Ambient globals injected at runtime by the Tauri webview shell and the
// theme bootstrap script (see BaseLayout.astro) — not part of the standard
// DOM lib, so every call site used to redeclare them locally via `as any`.
import type { CharacterEditorApi, PrEditorSessionController } from './lib/shared/state/editor-session-bus';

export {};

declare global {
  interface Window {
    // Editor-session bus (see lib/shared/editor-session-bus.ts): the character
    // editor and the media PR editor session publish their controls here.
    __metadeaCharacterEditor?: CharacterEditorApi;
    __metadeaPrEditorSession?: PrEditorSessionController;
    __metadeaPresenceManager?: {
      requestDiscordIdle: () => void;
      clearGamePresence: () => void;
    };
    __TAURI__?: {
      core?: {
        invoke: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
        convertFileSrc?: (filePath: string, protocol?: string) => string;
      };
      path?: { appDataDir: () => Promise<string> };
      opener?: { openUrl: (url: string) => void };
    };
    __updateTheme?: (id: string) => void;
  }
}
