// The `is:inline` <head> script that applies the Interface scale before first
// paint (mounted by components/ui-scale/UiScaleBootstrap.astro, right after
// the locale bootstrap). It runs before any module, so it talks to the global
// Tauri API (`withGlobalTauri`) and carries computeUiScale() as ES5 source;
// ui-scale-bootstrap.test.ts evaluates this exact string against ui-scale.ts.
//
// WebView2 keeps a zoom factor for the life of the webview and across its
// navigations, and a fresh webview starts at 1. So the zoom in effect is the
// one recorded in sessionStorage (same lifetime), or 1. Only when the target
// differs is the body hidden until setZoom() lands (at startup, typically),
// so the unscaled layout never flashes. Outside Tauri it does nothing.

import {
  UI_SCALE_EPSILON,
  UI_SCALE_MAX_AUTO,
  UI_SCALE_MIN,
  UI_SCALE_PRESETS,
  UI_SCALE_REFERENCE_WIDTH,
} from './ui-scale';

/** Class on <html> while the first zoom change is pending. */
export const UI_SCALE_PENDING_CLASS = 'ui-scale-pending';

/** The body is revealed after this long even if setZoom never answers. */
export const UI_SCALE_PENDING_TIMEOUT_MS = 800;

/** ES5 mirror of computeUiScale(parseUiScalePreference(raw), baseWidth). */
export const INLINE_COMPUTE_UI_SCALE_SOURCE = `function (raw, baseWidth) {
  var presets = ${JSON.stringify(UI_SCALE_PRESETS)};
  var fixed = Number(raw);
  for (var i = 0; i < presets.length; i++) {
    if (presets[i] === fixed) return fixed / 100;
  }
  if (!isFinite(baseWidth) || baseWidth <= 0) return ${UI_SCALE_MAX_AUTO};
  var ratio = Math.min(${UI_SCALE_MAX_AUTO}, Math.max(${UI_SCALE_MIN}, baseWidth / ${UI_SCALE_REFERENCE_WIDTH}));
  return Math.round(ratio * 1000) / 1000;
}`;

export interface UiScaleBootstrapOptions {
  /** localStorage: the user's choice ('auto' or a preset percent). */
  preferenceKey: string;
  /** localStorage: zoom currently applied to the main window. */
  mainZoomKey: string;
  /** sessionStorage: zoom applied to this webview. */
  webviewZoomKey: string;
  /**
   * 'window' sizes the zoom from this window's width (main window);
   * 'follow-main' copies the main window's zoom (the player overlay, whose
   * own width is the video's, not the app's).
   */
  mode: 'window' | 'follow-main';
}

export function buildUiScaleBootstrapScript({
  preferenceKey, mainZoomKey, webviewZoomKey, mode,
}: UiScaleBootstrapOptions): string {
  const follow = mode === 'follow-main';
  const targetExpr = follow
    ? `var main = Number(localStorage.getItem(${JSON.stringify(mainZoomKey)}));
    target = main > 0 ? main : 1;`
    : `target = compute(localStorage.getItem(${JSON.stringify(preferenceKey)}), window.innerWidth * current);`;
  const recordMain = follow ? '' : `localStorage.setItem(${JSON.stringify(mainZoomKey)}, String(target));`;
  return `(function () {
  var tauri = window.__TAURI__;
  if (!tauri || !tauri.webview || !tauri.webview.getCurrentWebview) return;
  var compute = ${INLINE_COMPUTE_UI_SCALE_SOURCE};
  var current = 1;
  var target = 1;
  try {
    var recorded = Number(sessionStorage.getItem(${JSON.stringify(webviewZoomKey)}));
    if (recorded > 0) current = recorded;
    ${targetExpr}
  } catch (e) { return; }
  if (Math.abs(target - current) <= ${UI_SCALE_EPSILON}) return;
  var root = document.documentElement;
  var reveal = function () { root.classList.remove(${JSON.stringify(UI_SCALE_PENDING_CLASS)}); };
  root.classList.add(${JSON.stringify(UI_SCALE_PENDING_CLASS)});
  setTimeout(reveal, ${UI_SCALE_PENDING_TIMEOUT_MS});
  tauri.webview.getCurrentWebview().setZoom(target).then(function () {
    try {
      sessionStorage.setItem(${JSON.stringify(webviewZoomKey)}, String(target));
      ${recordMain}
    } catch (e) { /* storage unavailable */ }
    requestAnimationFrame(function () { requestAnimationFrame(reveal); });
  }, reveal);
})();`;
}
