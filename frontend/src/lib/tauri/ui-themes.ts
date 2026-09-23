// IPC surface of src-tauri/src/ui_themes.rs — user-made UI themes / skins
// (a folder of theme.json + CSS under <app data>/ui_themes/<id>/). Not to be
// confused with ./themes.ts, which is anime OP/ED songs (media_themes).
import { invoke, tauriCmd } from './bridge';

export type UiThemeTier = 'variables' | 'full';

export interface UiThemeManifest {
  id: string;
  name: string;
  author: string;
  version: string;
  description?: string;
  homepage?: string;
  minAppVersion?: string;
  /** Design-token overrides, keys normalised to `--name` by Rust. */
  variables: Record<string, string>;
  /** CSS files relative to the theme folder, concatenated in order. */
  css: string[];
  preview?: string;
}

export interface UiThemeSummary {
  id: string;
  /** Absolute path of the theme folder. */
  folder: string;
  manifest: UiThemeManifest | null;
  tier: UiThemeTier | null;
  /** Absolute path of the preview image (wrap with wrapAssetUrl), if any. */
  previewPath: string | null;
  /** `E_UI_THEME_*` code (with detail) when the folder cannot be loaded. */
  error: string | null;
}

export interface UiThemeCss {
  id: string;
  tier: UiThemeTier;
  variables: Record<string, string>;
  /** Sanitised CSS ('' for a variables-only theme). */
  css: string;
  /** Newest mtime (ms) across manifest + CSS files; changes ⇒ re-inject. */
  mtime: number;
}

export function listUiThemes(): Promise<UiThemeSummary[]> {
  return tauriCmd<UiThemeSummary[]>('list_ui_themes', []);
}

export function readUiThemeCss(id: string): Promise<UiThemeCss> {
  return invoke<UiThemeCss>('read_ui_theme_css', { id });
}

export function getActiveUiTheme(): Promise<string | null> {
  return tauriCmd<string | null>('get_active_ui_theme', null);
}

/** `null` deactivates. */
export function setActiveUiTheme(id: string | null): Promise<void> {
  return invoke<void>('set_active_ui_theme', { id });
}

export function openUiThemesFolder(): Promise<void> {
  return invoke<void>('open_ui_themes_folder');
}

/** Copies the bundled example theme into the folder; resolves to its id. */
export function exportUiThemeStarter(): Promise<string> {
  return invoke<string>('export_ui_theme_starter');
}
