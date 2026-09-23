// "Prefer clean (textless) covers" (Settings > Preferences > Library).
//
// Display-only, same principle as cover-preferences.ts: the catalog's stored
// cover_url is never changed — a card renders its usual cover first and swaps
// the <img> src once a textless version is known (the box keeps its size).
// Where they come from (resolved + cached 30 days in src-tauri/src/textless_covers.rs):
// - movie:/series: (TMDB) — posters uploaded with no language.
// - game:/vnovel: (IGDB) — covers always carry the logo, so key art from
//   `artworks`, kind `art`: cards center-crop it to the cover box.
// - AniList anime/manga and every other provider have no textless posters, so
//   their ids are never even asked about.
//
// Precedence: manual cover (the editor's pick) > textless > original.
import { readCoverPreferences, getCoverPreference, type CoverPreferences } from './cover-preferences';
import { toMediumCover, toSmallCover } from './small-cover';
import {
  getTextlessCoverScope,
  isTextlessCoversEnabled,
  TEXTLESS_COVERS_CHANGED_EVENT,
  type TextlessCoverScope,
} from '../storage/preferences';
import { resolveTextlessCovers, type TextlessCoverKind, type TextlessCoverRow } from '../tauri/textless-covers';

export interface TextlessCover {
  url: string;
  kind: TextlessCoverKind;
}

export interface DisplayCover {
  src: string | null;
  /** True when src is the textless substitute. */
  textless: boolean;
  /** Key art that must be center-cropped to the cover box. */
  cropped: boolean;
}

const ELIGIBLE_ID_RE = /^(?:movie|series|game|vnovel):[1-9]\d*$/;

/** Ids whose provider can have a textless version (TMDB films/series, IGDB games/VNs). */
export function isTextlessEligibleId(externalId: string | null | undefined): externalId is string {
  return !!externalId && ELIGIBLE_ID_RE.test(externalId);
}

/** Whether the user's scope setting covers this work (films/series vs games/VNs). */
export function textlessScopeAllows(scope: TextlessCoverScope, externalId: string): boolean {
  if (scope === 'screen') return /^(?:movie|series):/.test(externalId);
  if (scope === 'games') return /^(?:game|vnovel):/.test(externalId);
  return true;
}

/** Pure precedence: a manual cover is never replaced (the card's own src
 *  already carries it — or the manual URL itself when it has none); then the
 *  textless version when the setting is on; else the original. */
/** The textless URL at the same display size the card asked for with its
 *  original cover (small grids use toSmallCover, detail views toMediumCover,
 *  heroes the full size) — display-only, the stored URLs are untouched. */
export function matchCoverSize(textlessUrl: string, original: string | null): string {
  if (!original) return textlessUrl;
  if (toSmallCover(original) === original && toMediumCover(original) !== original) return toSmallCover(textlessUrl);
  if (toMediumCover(original) === original && toSmallCover(original) !== original) return toMediumCover(textlessUrl);
  return textlessUrl;
}

export function selectDisplayCover(input: {
  original: string | null | undefined;
  manual: string | null | undefined;
  textless: TextlessCover | null | undefined;
  enabled: boolean;
}): DisplayCover {
  const original = input.original || null;
  if (input.manual) return { src: original ?? input.manual, textless: false, cropped: false };
  if (input.enabled && input.textless) {
    return { src: matchCoverSize(input.textless.url, original), textless: true, cropped: input.textless.kind === 'art' };
  }
  return { src: original, textless: false, cropped: false };
}

/** A resolver row → the cached answer (null = known "no textless version"). */
export function textlessFromRow(row: TextlessCoverRow): TextlessCover | null {
  return row.url && (row.kind === 'poster' || row.kind === 'art') ? { url: row.url, kind: row.kind } : null;
}

// ── Store ───────────────────────────────────────────────────────────────────

/** What a cover reads: the setting is off, not known yet, or the answer. */
export const TEXTLESS_DISABLED = Object.freeze({ disabled: true as const });
export type TextlessSnapshot = typeof TEXTLESS_DISABLED | TextlessCover | null | undefined;

/** The known textless cover in a snapshot, if any. */
export function textlessOf(snapshot: TextlessSnapshot): TextlessCover | null {
  return snapshot && 'url' in snapshot ? snapshot : null;
}

/** Ids per IPC call (the Rust side caps a call at 200). */
const IDS_PER_CALL = 100;

export interface TextlessCoverStore {
  snapshot: (externalId: string) => TextlessSnapshot;
  /** Queue an id for the next batch (one IPC call per render pass). No-op
   *  when off, ineligible, already known or already queued. */
  request: (externalId: string) => void;
  /** The editor's manual cover for this work, from a memoized preferences read. */
  manualCover: (externalId: string) => string | null;
  isEnabled: () => boolean;
  /** Re-read the setting / manual covers (event handlers call these). */
  refreshEnabled: () => void;
  refreshManualCovers: () => void;
  subscribe: (cb: () => void) => () => void;
}

export function createTextlessCoverStore(deps: {
  resolve: (externalIds: string[]) => Promise<TextlessCoverRow[]>;
  readEnabled: () => boolean;
  /** Which works the setting applies to (default: all eligible ones). */
  readScope?: () => TextlessCoverScope;
  readManual: () => CoverPreferences;
  schedule?: (flush: () => void) => void;
}): TextlessCoverStore {
  const schedule = deps.schedule ?? (flush => { setTimeout(flush, 0); });
  const known = new Map<string, TextlessCover | null>();
  const queued = new Set<string>();
  const inFlight = new Set<string>();
  const listeners = new Set<() => void>();
  let enabled: boolean | null = null;
  let scope: TextlessCoverScope | null = null;
  const readScope = deps.readScope ?? ((): TextlessCoverScope => 'all');
  let manual: CoverPreferences | null = null;
  let flushScheduled = false;

  const notify = () => { for (const cb of listeners) cb(); };
  const isEnabled = () => (enabled ??= deps.readEnabled());
  const appliesTo = (externalId: string) => isEnabled() && textlessScopeAllows((scope ??= readScope()), externalId);

  const settle = (ids: string[], rows: TextlessCoverRow[]) => {
    const byId = new Map(rows.map(row => [row.external_id, row]));
    for (const id of ids) {
      inFlight.delete(id);
      const row = byId.get(id);
      // An id the resolver didn't answer is remembered as "none" for this
      // session so a render loop can't keep asking for it.
      known.set(id, row ? textlessFromRow(row) : null);
    }
    notify();
  };

  const flush = () => {
    flushScheduled = false;
    if (!isEnabled()) { queued.clear(); return; }
    const ids = [...queued];
    queued.clear();
    for (let i = 0; i < ids.length; i += IDS_PER_CALL) {
      const chunk = ids.slice(i, i + IDS_PER_CALL);
      for (const id of chunk) inFlight.add(id);
      deps.resolve(chunk).then(rows => settle(chunk, rows), () => settle(chunk, []));
    }
  };

  return {
    snapshot(externalId) {
      if (!appliesTo(externalId)) return TEXTLESS_DISABLED;
      return known.get(externalId);
    },
    request(externalId) {
      if (!isTextlessEligibleId(externalId) || !appliesTo(externalId)) return;
      if (known.has(externalId) || queued.has(externalId) || inFlight.has(externalId)) return;
      queued.add(externalId);
      if (!flushScheduled) {
        flushScheduled = true;
        schedule(flush);
      }
    },
    manualCover(externalId) {
      manual ??= deps.readManual();
      return getCoverPreference(externalId, manual);
    },
    isEnabled,
    refreshEnabled() {
      const next = deps.readEnabled();
      const nextScope = readScope();
      if (next === enabled && nextScope === scope) return;
      enabled = next;
      scope = nextScope;
      notify();
    },
    refreshManualCovers() {
      manual = null;
      notify();
    },
    subscribe(cb) {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },
  };
}

export const textlessCoverStore = createTextlessCoverStore({
  resolve: resolveTextlessCovers,
  readEnabled: isTextlessCoversEnabled,
  readScope: getTextlessCoverScope,
  readManual: readCoverPreferences,
});

if (typeof window !== 'undefined') {
  window.addEventListener(TEXTLESS_COVERS_CHANGED_EVENT, () => textlessCoverStore.refreshEnabled());
  window.addEventListener('media-cover-preference-changed', () => textlessCoverStore.refreshManualCovers());
  window.addEventListener('storage', () => {
    textlessCoverStore.refreshEnabled();
    textlessCoverStore.refreshManualCovers();
  });
}
