// Ambient globals injected at runtime by the Tauri webview shell and the
// theme bootstrap script (see BaseLayout.astro) — not part of the standard
// DOM lib, so every call site used to redeclare them locally via `as any`.
export {};

declare global {
  interface Window {
    __TAURI__?: {
      core?: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<any> };
      path?: { appDataDir: () => Promise<string> };
      opener?: { openUrl: (url: string) => void };
    };
    __updateTheme?: (id: string) => void;
  }
}
