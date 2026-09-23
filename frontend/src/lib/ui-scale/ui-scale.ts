// Interface scale: the whole app is laid out for a REFERENCE_WIDTH-wide
// window and, on a narrower one, rendered as that same design shrunk (the
// WebView2 zoom factor, see ui-scale-runtime.ts) instead of a cramped reflow.
//
// Everything here is pure; the <head> bootstrap (ui-scale-bootstrap.ts)
// carries an ES5 mirror of computeUiScale() that ui-scale-bootstrap.test.ts
// checks against this one.

/** Window width (CSS px at 100 % zoom) the layout is designed for. */
export const UI_SCALE_REFERENCE_WIDTH = 1920;

/** Auto never shrinks below this, so text stays readable in an 800 px window. */
export const UI_SCALE_MIN = 0.67;

/** Auto never enlarges: wider windows get more room, not bigger text. */
export const UI_SCALE_MAX_AUTO = 1;

/** Fixed choices in Settings › Preferences › Interface scale (percent). */
export const UI_SCALE_PRESETS = [80, 90, 100, 110, 125] as const;

export type UiScalePreset = (typeof UI_SCALE_PRESETS)[number];
export type UiScalePreference = 'auto' | UiScalePreset;

/** Zoom changes smaller than this are ignored (rounding noise of innerWidth). */
export const UI_SCALE_EPSILON = 0.01;

/** Stored value → preference; anything unknown means Auto. */
export function parseUiScalePreference(raw: string | null | undefined): UiScalePreference {
  const value = Number(raw);
  return (UI_SCALE_PRESETS as readonly number[]).includes(value) ? (value as UiScalePreset) : 'auto';
}

export function serializeUiScalePreference(preference: UiScalePreference): string {
  return String(preference);
}

/**
 * Zoom factor for a window whose width at 100 % zoom is `baseWidth` CSS px
 * (window.innerWidth × the zoom currently applied). A fixed preference wins;
 * Auto is baseWidth / REFERENCE_WIDTH clamped to [MIN, MAX_AUTO].
 */
export function computeUiScale(preference: UiScalePreference, baseWidth: number): number {
  if (preference !== 'auto') return preference / 100;
  if (!Number.isFinite(baseWidth) || baseWidth <= 0) return UI_SCALE_MAX_AUTO;
  const ratio = baseWidth / UI_SCALE_REFERENCE_WIDTH;
  return Math.round(Math.min(UI_SCALE_MAX_AUTO, Math.max(UI_SCALE_MIN, ratio)) * 1000) / 1000;
}

/** True when `target` differs enough from the applied zoom to re-apply. */
export function shouldApplyUiScale(current: number, target: number): boolean {
  return Math.abs(target - current) > UI_SCALE_EPSILON;
}

/** Parses the zoom recorded for this webview (sessionStorage); 1 when absent. */
export function parseAppliedZoom(raw: string | null | undefined): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

export interface CssRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * getBoundingClientRect() → physical pixels of the window's client area.
 * `devicePixelRatio` already folds in both the monitor scale and the
 * interface zoom, so this stays right at any Interface scale.
 */
export function toPhysicalRect(rect: CssRect, devicePixelRatio: number): CssRect {
  const ratio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const left = Math.round(rect.x * ratio);
  const top = Math.round(rect.y * ratio);
  return {
    x: left,
    y: top,
    width: Math.round((rect.x + rect.width) * ratio) - left,
    height: Math.round((rect.y + rect.height) * ratio) - top,
  };
}
