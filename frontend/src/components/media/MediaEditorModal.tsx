import React, { useReducer, useEffect, useCallback, useMemo, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { LibraryEntry } from '../../lib/tauri';
import { saveLibraryEntry, getLibraryEntry, deleteLibraryEntry, readMonthlyHistory, writeMonthlyHistory, syncFavorites, getCatalogEntry, saveImageFile } from '../../lib/tauri';
import { parseDelimitedString } from '../../lib/shared/string-utils';
import { getActiveRatingSystem } from '../../lib/media/rating-utils';
import { generateShareImage } from '../../lib/media/share-image';
import type { MediaPageData } from '../../lib/media/types';
import { RatingInput } from './RatingInput';
import { syncToAniList, fetchAniListLogData, isAniListType } from '../../lib/media/anilist-sync';
import type { Translations } from '../../i18n/index';
import {
  IconStatusPlanning, IconStatusInProgress, IconStatusCompleted,
  IconStatusPaused, IconStatusDropped,
  IconHeart, IconPlatinum, IconCheck, IconAlertCircle, IconDownload, IconTrash,
} from '../local/ui/icons';
import {
  type LogState,
  createDefaultLog, entryInit, libraryEntryToLog, entryReducer, uiReducer, createEmptyVersionEntry,
} from '../../lib/media/log-state';
import { IGDB_TYPES, pickAggregateStatus } from '../../lib/constants/media';
import { CONTAINS_RELATION_TYPES } from '../../lib/media/sagaTypes';
import { motion } from 'motion/react';
import { getRatingName2, getRating2System, getRating2Min, getRating2Max, isUnifySeasonsEnabled, type RatingSlot } from '../../lib/settings/preferences';
import { loadSagaChain } from '../../lib/media/sagaData';
import type { SagaEntry } from '../../lib/anilist/saga';
import { stripSeasonSuffix, seriesSeasonExternalId } from '../../lib/media/mapper-utils';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  externalId: string;
  data: MediaPageData;
  i18n: Translations['media'];
  onClose: () => void;
  onSaved: (entry: LibraryEntry) => void;
  onDeleted: () => void;
  initialEntry?: LibraryEntry;
  initialActiveLogId?: string;
  // Which rating this editor session edits — always 'rating' (the default,
  // app-wide-system one) except when opened from the profile library with
  // its own "doble calificación" selector on rating_2 (see LibraryCard's
  // open-profile-editor dispatch). Every other entry point (media page,
  // local library, search) always means the primary rating.
  activeRatingSlot?: RatingSlot;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Progress field(s) shown in the header — which label(s) and step apply
// depend on the media type. progLabel matches the raw type (not its
// underscore-stripped base) to preserve each edge case's original mapping.
function getProgressConfig(type: string, format: string | undefined, tm: Translations['media']): { label: string | null; label2: string | null; step: number } {
  const base = type.split('_')[0];

  let label: string | null;
  if (type === 'game' || type === 'vnovel')            label = tm.progress_hours;
  else if (type === 'anime' || type === 'series')      label = tm.progress_episodes;
  else if (type === 'manga' || type === 'lnovel')      label = tm.progress_chapters;
  // 'book' (singular) — 'books' here never matched anything real, so a
  // book's progress fell through to the generic label below and its
  // total (page count) was never wired up at all.
  else if (type === 'book')                            label = tm.progress_pages;
  else                                                 label = tm.editor.progress;

  // A movie is a single sitting, not a run of seasons — even though it's
  // still type 'anime'/'series' (format is what actually distinguishes it).
  const isMovie = format === 'MOVIE';
  const label2 =
    isMovie ? null :
    base === 'anime' || base === 'series'      ? tm.progress_seasons :
    base === 'manga' || base === 'lnovel'      ? tm.progress_volumes : null;

  const step = base === 'game' || base === 'vnovel' ? 0.5 : 1;
  return { label, label2, step };
}

// No work catalogued here predates this — anything a user types earlier
// (typo, wrong era) gets pulled up to it rather than silently accepted.
const MIN_DATE_YEAR = 1950;

function clampDateMinYear(value: string): string {
  if (!value) return value;
  const [year, month, day] = value.split('-');
  return Number(year) < MIN_DATE_YEAR ? `${MIN_DATE_YEAR}-${month}-${day}` : value;
}

// ISO YYYY-MM-DD strings compare correctly lexicographically.
function clampNotBefore(value: string, floor: string): string {
  return value && floor && value < floor ? floor : value;
}

// Relation cards link to another media page via "/media?id=<externalId>" —
// pull that id back out to look up/link the related game's own log.
function extractExternalIdFromRelationUrl(url: string | null | undefined): string | undefined {
  const match = url?.match(/id=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : undefined;
}

// Log tab labels show only what's after the title's colon (e.g. "Trails in
// the Sky: 2nd Chapter" → "2nd Chapter") — titles rarely share a common
// prefix with the base game, so diffing against it wasn't reliable. A
// remainder of 2 characters or less ("II", "S2", ":D"...) reads as noise
// rather than a real edition name, so the full title is kept instead.
function editionTabLabel(editionTitle: string, defaultLabel: string = 'Edition'): string {
  if (!editionTitle) return defaultLabel;
  const idx = editionTitle.indexOf(':');
  if (idx === -1) return editionTitle;
  const after = editionTitle.slice(idx + 1).trim();
  return after.length > 2 ? after : editionTitle;
}

// ── Small header-field building blocks ───────────────────────────────────────

function HeaderField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="me-header-field">
      <label className="me-header-field-label">{label}</label>
      {children}
    </div>
  );
}

// Playtime (game/vnovel progress) is stored as decimal hours (0.5 = 30min,
// same as before this existed) — only how it's typed/displayed changes.
// "H:MM" reads far more naturally for hours+minutes than a raw decimal, and
// a native <input type="number"> can't be typed with ":" at all (nor with
// "," as a decimal separator — Chromium's number input only accepts "."
// regardless of OS locale, so a Spanish-locale "10,3" silently failed to
// parse as anything).
function formatHoursColon(decimalHours: number): string {
  // Empty, not "0:00" — matches NumberField's own value={value || ''}: an
  // unlogged/zero entry starts blank (with "0:00" as a greyed-out
  // placeholder hint) so typing "6" or "6:45" works immediately instead of
  // first having to clear out baked-in text.
  if (!decimalHours) return '';
  let h = Math.floor(decimalHours);
  let m = Math.round((decimalHours - h) * 60);
  if (m === 60) { m = 0; h += 1; }
  return `${h}:${String(m).padStart(2, '0')}`;
}

// null = invalid (wrong shape, or minutes >= 60 — "H:90" is never accepted,
// not even clamped) — the caller reverts to the last valid display instead.
function parseHoursColonInput(raw: string): number | null {
  const match = raw.trim().match(/^(\d+)(?::(\d{1,2}))?$/);
  if (!match) return null;
  const h = parseInt(match[1], 10);
  const m = match[2] ? parseInt(match[2], 10) : 0;
  if (m > 59) return null;
  return h + m / 60;
}

function HoursField({ label, value, max, onChange }: {
  label: string; value: number; max?: number; onChange: (v: number) => void;
}) {
  const formatted = formatHoursColon(value);
  // Local draft text, not tied directly to `value` on every keystroke — a
  // controlled input re-deriving its display from the parsed number as you
  // type would reformat (and jump the cursor) mid-entry, e.g. typing "10:3"
  // toward "10:30" briefly parses as "10:03" and rewrites itself. Only
  // resynced from outside changes (switching log/version) and on blur.
  const [text, setText] = useState(formatted);
  useEffect(() => { setText(formatted); }, [formatted]);

  function commit() {
    const parsed = parseHoursColonInput(text);
    if (parsed === null) { setText(formatted); return; }
    onChange(max !== undefined && parsed > max ? max : parsed);
  }

  return (
    <HeaderField label={label}>
      <div className="me-header-field-row">
        <input type="text" inputMode="numeric" className="me-header-field-input me-header-field-input--number"
          value={text}
          onChange={e => {
            // Digits and at most one ":" — comma (or anything else) is
            // rejected right at the keystroke rather than silently eaten
            // later. Minutes >= 60 typed mid-entry (e.g. "1:9" on the way to
            // "1:59") aren't blocked here — parseHoursColonInput rejects
            // them for good on blur instead, since a bare "9" can't yet know
            // whether it'll become a valid "09" or an invalid "90".
            const next = e.target.value;
            if (/^\d*(:\d{0,2})?$/.test(next)) setText(next);
          }}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          placeholder="0:00" />
        {/* Always rendered (reserved min-width, hidden via CSS when there's
            no max) — switching to a tab whose total isn't known yet must
            never shift whatever sits after this field. */}
        <span className={`me-header-field-max${max === undefined ? ' me-header-field-max--hidden' : ''}`}>
          / {max !== undefined ? formatHoursColon(max) : ''}
        </span>
      </div>
    </HeaderField>
  );
}

function NumberField({ label, value, max, step, disabled, onChange }: {
  label: string; value: number; max?: number; step: number; disabled?: boolean; onChange: (v: number) => void;
}) {
  return (
    <HeaderField label={label}>
      <div className="me-header-field-row">
        <input type="number" className="me-header-field-input me-header-field-input--number" min={0}
          max={max} step={step} disabled={disabled}
          value={value || ''}
          onChange={e => {
            let v = parseFloat(e.target.value) || 0;
            if (max !== undefined && v > max) v = max;
            onChange(v);
          }}
          placeholder="0" />
        {/* Same always-rendered reserved slot as HoursField above. */}
        <span className={`me-header-field-max${max === undefined ? ' me-header-field-max--hidden' : ''}`}>
          / {max !== undefined ? max : ''}
        </span>
      </div>
    </HeaderField>
  );
}

// Same 2-character noise floor as editionTabLabel above — a colon or
// baseTitle-prefix remainder of "II"/"S2"/etc. isn't a usable label on its
// own, so the full title is kept instead of a near-blank tab.
function formatSeasonTabLabel(title: string, baseTitle?: string): string {
  if (!title) return '';
  const colonIdx = title.indexOf(':');
  if (colonIdx !== -1) {
    const after = title.slice(colonIdx + 1).trim();
    if (after.length > 2) return after;
  }
  if (baseTitle && baseTitle.trim().length > 2) {
    const normBase = baseTitle.trim().toLowerCase();
    const normTitle = title.trim().toLowerCase();
    if (normTitle.startsWith(normBase)) {
      const remainder = title.trim().slice(baseTitle.trim().length).replace(/^[\s:\-–—]+/, '').trim();
      if (remainder.length > 2) return remainder;
    }
  }
  return title;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function MediaEditorModal({ externalId, data, i18n, onClose, onSaved, onDeleted, initialEntry, initialActiveLogId, activeRatingSlot = 'rating' }: Props) {
  const t  = i18n;
  const te = t.editor;
  // rating_2's own name/system are read once at mount — this modal's whole
  // lifetime is one edit session, no need to react to a settings change
  // happening in a different window/tab mid-edit.
  const isSecondaryRating = activeRatingSlot === 'rating_2';
  const ratingLabel = isSecondaryRating ? getRatingName2(te.score) : te.score;
  const rating2System = useMemo(() => getRating2System(), []);
  // Custom range only matters for '10-dec'/'10' — getRating2Min/Max default
  // to 0/10 anyway, so passing them unconditionally for every system is
  // harmless (5-star/3-emoji never read these props).
  const rating2Min = useMemo(() => getRating2Min(), []);
  const rating2Max = useMemo(() => getRating2Max(), []);
  // Any work whose whole "total" is a single unit (a movie, an anime movie,
  // an OVA/special with just one episode, etc.) gets the same one-shot
  // "viewing date" field as a movie instead of a started/finished range —
  // a range makes no sense when there's nothing to span.
  const isMovie = data.type === 'movie' || (data.type === 'anime' && data.format === 'MOVIE') || data.totalCount === 1;

  const [entry, dispatchEntry] = useReducer(entryReducer, externalId, id => ({ ...entryInit, activeLogId: initialActiveLogId || id }));
  const [ui,    dispatchUi]    = useReducer(uiReducer, {
    // If we already have the entry from the caller, skip loading state entirely
    loading: !initialEntry, saving: false, isClosing: false,
    tagInput: '', anilistStatus: 'idle', anilistError: null,
    anilistImportStatus: 'idle', anilistImportError: null,
  });

  // Cover/title lookup for whichever media occupies each month slot in the
  // history grid, so a blocked (or one's own) month shows *which* entry it
  // belongs to instead of just a bare "taken" state.
  const [monthMediaInfo, setMonthMediaInfo] = useState<Record<string, { title: string; cover: string }>>({});
  useEffect(() => {
    const ids = new Set<string>();
    for (const occupants of Object.values(entry.monthlyHistory)) {
      for (const id of occupants) ids.add(id);
    }
    const missing = [...ids].filter(id => !(id in monthMediaInfo));
    if (missing.length === 0) return;
    Promise.all(missing.map(id => getCatalogEntry(id).then(e => [id, e] as const))).then(results => {
      setMonthMediaInfo(prev => {
        const next = { ...prev };
        for (const [id, e] of results) next[id] = { title: e?.title_main ?? id, cover: e?.cover_url ?? '' };
        return next;
      });
    });
  }, [entry.monthlyHistory]); // eslint-disable-line react-hooks/exhaustive-deps

  // The single source of truth for whatever log tab is currently active —
  // everything in the form reads/writes through this instead of a mirrored
  // copy on EntryState.
  const activeLog = useMemo(
    () => entry.logs[entry.activeLogId] || createDefaultLog(),
    [entry.logs, entry.activeLogId],
  );

  const baseId = data.parentGame?.externalId || externalId;
  const baseSelectedVersion = entry.logs[baseId]?.selectedVersion || '';

  // "Unificar temporadas" (Settings > Preferencias) — every other season in
  // the chain gets its own tab here too, same as the edition/version tabs
  // below, so a status/rating/progress can be logged per season without
  // closing this editor and reopening it on each season's own page. Reuses
  // loadSagaChain (sagaData.ts), same source MediaPage.tsx's own Temporadas
  // tab reads, so this is normally an instant cache hit.
  const [animeSeasonChain, setAnimeSeasonChain] = useState<SagaEntry[]>([]);
  const [seasonMetaMap, setSeasonMetaMap] = useState<Record<string, { title: string; cover?: string; totalCount?: number | null }>>({});

  const isUnifiedAnime = data.type === 'anime' && isUnifySeasonsEnabled() && animeSeasonChain.length > 1;
  const GENERAL_LOG_ID = isUnifiedAnime && animeSeasonChain[0] ? `general:${animeSeasonChain[0].externalId}` : '';
  const isGeneralTab = isUnifiedAnime && entry.activeLogId === GENERAL_LOG_ID;

  useEffect(() => {
    if (data.type !== 'anime' || !isUnifySeasonsEnabled()) {
      setAnimeSeasonChain([]);
      return;
    }
    let cancelled = false;
    loadSagaChain(externalId).then(chain => {
      if (!cancelled) setAnimeSeasonChain(chain.ok && chain.entries.length > 1 ? chain.entries : []);
    }).catch(() => { if (!cancelled) setAnimeSeasonChain([]); });
    return () => { cancelled = true; };
  }, [data.type, externalId]);

  useEffect(() => {
    if (animeSeasonChain.length === 0) return;
    let cancelled = false;
    Promise.all(animeSeasonChain.map(async s => {
      const [lib, cat] = await Promise.all([
        getLibraryEntry(s.externalId).catch(() => null),
        getCatalogEntry(s.externalId).catch(() => null),
      ]);
      return { id: s.externalId, lib, cat, s };
    })).then(results => {
      if (cancelled) return;
      const meta: Record<string, { title: string; cover?: string; totalCount?: number | null }> = {};
      results.forEach(r => {
        meta[r.id] = {
          title: r.cat?.title_main || r.s.title,
          cover: r.cat?.cover_url || r.s.cover || undefined,
          totalCount: r.cat?.total_count ?? null,
        };
        if (r.lib) {
          dispatchEntry({ type: 'LOAD_LOG', id: r.id, entry: r.lib });
        } else {
          dispatchEntry({ type: 'LOAD_LOG', id: r.id, entry: createEmptyVersionEntry(r.id, 'anime') });
        }
      });
      setSeasonMetaMap(meta);

      if (animeSeasonChain[0]) {
        const gId = `general:${animeSeasonChain[0].externalId}`;
        const savedGenRating = localStorage.getItem(`general_rating:${animeSeasonChain[0].externalId}`);
        const initialRating = savedGenRating ? parseFloat(savedGenRating) : 0;
        const emptyGen = createEmptyVersionEntry(gId, 'anime');
        if (initialRating > 0) {
          emptyGen.rating = initialRating;
        }
        dispatchEntry({ type: 'LOAD_LOG', id: gId, entry: emptyGen });
      }
    });
    return () => { cancelled = true; };
  }, [animeSeasonChain]);

  // Same "Unificar temporadas" toggle, for TMDB series — but unlike anime,
  // a series' own base entry already covers "the whole show" exactly like
  // it always has (its own real, independently-editable status/rating/
  // progress — see the general-tab question this was built to answer), so
  // there's no derived/aggregate general tab to build here. Season tabs are
  // the only new thing: each gets its own synthetic per-season log
  // (seriesSeasonExternalId) since a series has no per-season catalog row to
  // key a real one off of. data.seasons is already fetched (TMDB's own
  // detail response), so unlike anime this needs no extra chain lookup.
  const isUnifiedSeries = data.type === 'series' && isUnifySeasonsEnabled() && (data.seasons?.length ?? 0) > 0;
  const seriesSeasons = isUnifiedSeries ? data.seasons ?? [] : [];

  useEffect(() => {
    if (!isUnifiedSeries) return;
    let cancelled = false;
    Promise.all(seriesSeasons.map(async s => {
      const id = seriesSeasonExternalId(externalId, s.seasonNumber);
      const lib = await getLibraryEntry(id).catch(() => null);
      return { id, lib };
    })).then(results => {
      if (cancelled) return;
      results.forEach(r => {
        dispatchEntry({ type: 'LOAD_LOG', id: r.id, entry: r.lib ?? createEmptyVersionEntry(r.id, 'series') });
      });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isUnifiedSeries, externalId]);

  // Load base game and edition logs
  useEffect(() => {
    const loadAllVersions = async (bId: string) => {
      try {
        // 1. Load the base game
        const baseEntry = await getLibraryEntry(bId);
        if (baseEntry) {
          dispatchEntry({ type: 'LOAD_LOG', id: bId, entry: baseEntry });
        }

        // 2. Gather related-id candidates (remakes, remasters, etc.) to look up saved logs for
        const candidates = new Set<string>();
        if (data.parentGame) {
          candidates.add(data.parentGame.externalId);
        }
        for (const rel of (data.relations || [])) {
          const relExternalId = extractExternalIdFromRelationUrl(rel.url);
          if (relExternalId && relExternalId !== bId) {
            candidates.add(relExternalId);
          }
        }

        // 3. Load existing logs for the candidates — in parallel, not one
        // Tauri IPC round-trip at a time.
        await Promise.all([...candidates].map(async candId => {
          const ev = await getLibraryEntry(candId);
          if (ev) {
            dispatchEntry({ type: 'LOAD_LOG', id: candId, entry: ev });
          }
        }));

        // 4. If the base game has versions explicitly linked via
        // selected_version that weren't already loaded as candidates,
        // initialize them empty — also in parallel.
        if (baseEntry && baseEntry.selected_version) {
          await Promise.all(parseDelimitedString(baseEntry.selected_version).map(async versionId => {
            const ev = await getLibraryEntry(versionId);
            dispatchEntry({ type: 'LOAD_LOG', id: versionId, entry: ev ?? createEmptyVersionEntry(versionId) });
          }));
        }
        if (initialActiveLogId) {
          dispatchEntry({ type: 'SWITCH_LOG', id: initialActiveLogId });
        }
      } catch (err) {
        console.error('Failed to load base and versions', err);
      } finally {
        dispatchUi({ type: 'SET_LOADING', value: false });
      }
    };

    if (initialEntry) dispatchEntry({ type: 'LOAD_LOG', id: externalId, entry: initialEntry });
    loadAllVersions(baseId);

    readMonthlyHistory()
      .then(history => {
        let foundKey: string | null = null;
        for (const [key, ids] of Object.entries(history)) {
          if (ids.includes(externalId)) { foundKey = key; break; }
        }
        dispatchEntry({ type: 'LOAD_HISTORY', history, foundKey });
      })
      .catch(() => {});
  }, [externalId, data.parentGame, data.type, data.relations]); // eslint-disable-line react-hooks/exhaustive-deps

  // Kept in sync every render so the effect below can check "is this id
  // already loaded" without listing entry.logs as a dependency — that would
  // re-run the effect (and refetch every linked version over IPC) on every
  // single log edit, not just when a new version gets linked.
  const logsRef = useRef(entry.logs);
  logsRef.current = entry.logs;

  // Dynamically load newly selected edition. The tab-switch click handler
  // already seeds a synchronous LOAD_LOG for the version it just linked, so
  // this only needs to fetch ids that aren't in entry.logs yet — refetching
  // every already-loaded version on each edit to `selectedVersion` (its
  // whole CSV string changes identity whenever one more id is appended) was
  // a redundant Tauri IPC round-trip per tab switch, and the perceptible
  // source of "tarda un pelín" lag reported after the earlier flicker fix.
  useEffect(() => {
    if (!baseSelectedVersion) return;
    for (const versionId of baseSelectedVersion.split(',').filter(Boolean)) {
      if (logsRef.current[versionId]) continue;
      getLibraryEntry(versionId)
        .then(ev => dispatchEntry({ type: 'LOAD_LOG', id: versionId, entry: ev ?? createEmptyVersionEntry(versionId) }));
    }
  }, [baseSelectedVersion]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleImportFromAniList = useCallback(async () => {
    dispatchUi({ type: 'SET_ANILIST_IMPORT', status: 'syncing' });

    if (isGeneralTab && animeSeasonChain.length > 0) {
      try {
        const results = await Promise.all(
          animeSeasonChain.map(s => fetchAniListLogData(s.externalId, data.type))
        );
        const updatesById: Record<string, Partial<LogState>> = {};
        let anySuccess = false;
        results.forEach((res, idx) => {
          if (res.ok && res.data) {
            anySuccess = true;
            const { status, rating, progress, progressVolumes, startedAt, finishedAt, notes } = res.data;
            updatesById[animeSeasonChain[idx].externalId] = {
              status, rating, progress, progressCount2: progressVolumes, startedAt, finishedAt, notes,
            };
          }
        });

        if (!anySuccess) {
          const firstError = results.find(r => !r.ok)?.error;
          dispatchUi({ type: 'SET_ANILIST_IMPORT', status: 'error', error: firstError });
          return;
        }

        dispatchEntry({ type: 'UPDATE_LOGS_BULK', updatesById });
        dispatchUi({ type: 'SET_ANILIST_IMPORT', status: 'ok' });
        setTimeout(() => dispatchUi({ type: 'SET_ANILIST_IMPORT', status: 'idle' }), 3000);
      } catch (err) {
        dispatchUi({ type: 'SET_ANILIST_IMPORT', status: 'error', error: String(err) });
      }
      return;
    }

    const targetId = entry.activeLogId && !entry.activeLogId.startsWith('general:')
      ? entry.activeLogId
      : externalId;

    const result = await fetchAniListLogData(targetId, data.type);
    if (!result.ok || !result.data) {
      dispatchUi({ type: 'SET_ANILIST_IMPORT', status: 'error', error: result.error });
      return;
    }
    const { status, rating, progress, progressVolumes, startedAt, finishedAt, notes } = result.data;
    // UPDATE_LOGS_BULK (keyed explicitly by targetId) instead of UPDATE_LOG
    // (which always writes to whatever state.activeLogId is AT DISPATCH
    // TIME) — this fetch is async, so if the user switches tabs while it's
    // in flight, UPDATE_LOG would silently write this response onto
    // whichever OTHER tab they'd switched to by the time it resolved,
    // instead of the one it was actually fetched for.
    dispatchEntry({
      type: 'UPDATE_LOGS_BULK',
      updatesById: { [targetId]: { status, rating, progress, progressCount2: progressVolumes, startedAt, finishedAt, notes } },
    });
    dispatchUi({ type: 'SET_ANILIST_IMPORT', status: 'ok' });
    setTimeout(() => dispatchUi({ type: 'SET_ANILIST_IMPORT', status: 'idle' }), 3000);
  }, [isGeneralTab, animeSeasonChain, data.type, entry.activeLogId, externalId]);

  const handleSave = useCallback(async () => {
    dispatchUi({ type: 'SET_SAVING', value: true });
    try {
      const baseId = data.parentGame?.externalId || externalId;

      // Editing a version's own page IS the intent to link it to its base —
      // don't require the user to have clicked through the Log tab switcher
      // for that link to actually get persisted.
      let logsToSave = entry.logs;
      if (data.parentGame && externalId !== baseId) {
        const baseLog = logsToSave[baseId] || createDefaultLog();
        const linkedIds = baseLog.selectedVersion ? baseLog.selectedVersion.split(',') : [];
        if (!linkedIds.includes(externalId)) {
          const nextSelectedVersion = [...linkedIds, externalId].join(',');
          logsToSave = { ...logsToSave, [baseId]: { ...baseLog, selectedVersion: nextSelectedVersion } };
        }
      }

      let primarySaved: LibraryEntry | null = null;

      for (const [logId, entryLog] of Object.entries(logsToSave)) {
        if (logId.startsWith('general:')) {
          const rootId = animeSeasonChain[0]?.externalId;
          if (rootId) {
            if (entryLog.rating > 0) {
              localStorage.setItem(`general_rating:${rootId}`, String(entryLog.rating));
            } else {
              localStorage.removeItem(`general_rating:${rootId}`);
            }
          }
          continue;
        }

        const isBase = logId === baseId;
        const hasLink = isBase && !!entryLog.selectedVersion;

        const isEmpty =
          !entryLog.status &&
          entryLog.rating === 0 &&
          entryLog.rating2 === 0 &&
          entryLog.progress === 0 &&
          !entryLog.notes &&
          !entryLog.isFavorite &&
          !entryLog.isPlatinum &&
          entryLog.tags.length === 0 &&
          !entryLog.platform &&
          !entryLog.startedAt &&
          !entryLog.finishedAt &&
          !hasLink;

        if (isEmpty && !entryLog.existing) continue;

        const saved = await saveLibraryEntry({
          id:               entryLog.existing?.id ?? '',
          user_id:          'local',
          external_id:      logId,
          // data.type is this MODAL's own media (the one actually open) —
          // correct for logId === baseId/externalId, but wrong for any other
          // log in this same save loop, like a cross-type related work
          // (e.g. a manga's anime adaptation) whose own entry got loaded
          // into `logs` via loadAllVersions' unfiltered relations scan. Its
          // own already-saved type is the source of truth for it; only a
          // genuinely new log (no `existing` row yet — in practice always
          // logId === baseId, since loadAllVersions only ever loads logs
          // for relations that already had a saved entry) falls back to
          // data.type.
          type:             entryLog.existing?.type ?? data.type,
          status:           entryLog.status || null,
          rating:           entryLog.rating > 0 ? entryLog.rating : null,
          rating_2:         entryLog.rating2 > 0 ? entryLog.rating2 : null,
          progress:         entryLog.progress,
          progress_2:       entryLog.progressCount2,
          minutes_spent:    entryLog.progress * 60,
          is_favorite:      entryLog.isFavorite ? 1 : 0,
          is_platinum:      entryLog.isPlatinum ? 1 : 0,
          tags:             entryLog.tags.length > 0 ? entryLog.tags : null,
          notes:            entryLog.notes.trim() || null,
          added_at:         entryLog.existing?.added_at ?? null,
          updated_at:       null,
          selected_platform: entryLog.platform || null,
          selected_version:  isBase ? (entryLog.selectedVersion || null) : null,
          started_at:       entryLog.startedAt || null,
          finished_at:      entryLog.finishedAt || null,
        });

        if (logId === externalId) {
          primarySaved = saved;
        }
      }

      await writeMonthlyHistory(entry.monthlyHistory);
      await syncFavorites(data.type, externalId, activeLog.isFavorite)
        .catch(e => console.error('Failed to sync favorites', e));

      try {
        const { logJourneyEvent } = await import('../../lib/profile/journey');
        if (primarySaved) {
          await logJourneyEvent(activeLog.existing, primarySaved, data.type, data.totalCount ?? undefined);
        }
      } catch (e) {
        console.error('Failed to log journey event', e);
      }

      if (primarySaved) {
        onSaved(primarySaved);
      }

      if (isAniListType(data.type)) {
        dispatchUi({ type: 'SET_ANILIST', status: 'syncing' });
        syncToAniList({
          // Must be the active tab's own id, not the modal's base externalId
          // — a season tab (isSeasonTab) is its own independent AniList
          // entry (e.g. Bleach TYBW vs. base Bleach 2004), and activeLog's
          // values already belong to whichever tab is open, so syncing them
          // against the wrong mediaId would silently write this season's
          // progress onto the base work's AniList list entry instead.
          externalId: entry.activeLogId || externalId, type: data.type,
          status:          activeLog.status,
          rating:          activeLog.rating,
          progress:        activeLog.progress,
          progressVolumes: activeLog.progressCount2,
          startedAt:       activeLog.startedAt,
          finishedAt:      activeLog.finishedAt,
          notes:           activeLog.notes,
        }).then(result => {
          if (result.ok) {
            if (!result.skipped) {
              dispatchUi({ type: 'SET_ANILIST', status: 'ok' });
              setTimeout(() => dispatchUi({ type: 'SET_ANILIST', status: 'idle' }), 3000);
            } else {
              dispatchUi({ type: 'SET_ANILIST', status: 'idle' });
            }
          } else {
            dispatchUi({ type: 'SET_ANILIST', status: 'error', error: result.error });
          }
        });
      }

      handleClose();
    } catch (e) {
      console.error('save_library_entry error', e);
    } finally {
      dispatchUi({ type: 'SET_SAVING', value: false });
    }
  }, [entry, activeLog, externalId, data.type, data.parentGame, data.totalCount, onSaved, handleClose]);

  const handleDelete = useCallback(async () => {
    const activeId = entry.activeLogId || externalId;
    const existing = entry.logs[activeId]?.existing;
    if (!existing) { onClose(); return; }
    try {
      await deleteLibraryEntry(activeId);
      await syncFavorites(data.type, activeId, false)
        .catch(e => console.error('Failed to sync favorites', e));
      onDeleted();
    } catch (e) {
      console.error('delete_library_entry error', e);
    }
    onClose();
  }, [entry.logs, entry.activeLogId, externalId, data.type, onDeleted, onClose]);

  // No API lets a desktop app post directly to Instagram Stories (that's
  // mobile-only, Business account, Meta app review) — this generates the
  // Letterboxd-style share image and puts up a save dialog so the user
  // shares it themselves. Only enabled once finished/rated (see the button
  // below) since "just started watching" has nothing worth sharing yet.
  const [sharing, setSharing] = useState(false);
  const handleShare = useCallback(async () => {
    setSharing(true);
    try {
      const dataUrl = await generateShareImage({
        title:        data.titleMain,
        cover:        data.cover ?? null,
        rating:       activeLog.rating,
        ratingSystem: getActiveRatingSystem(),
        year:         data.releaseYear,
      });
      const fileName = `${data.titleMain.replace(/[\\/:*?"<>|]/g, '')}.png`;
      await saveImageFile(dataUrl, fileName);
    } catch (e) {
      console.error('Failed to generate share image', e);
    } finally {
      setSharing(false);
    }
  }, [data.titleMain, data.cover, activeLog.rating]);

  const handleTagKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const tag = ui.tagInput.trim();
      if (tag) {
        if (activeLog.tags.length < 5 && !activeLog.tags.includes(tag)) {
          dispatchEntry({ type: 'UPDATE_LOG', updates: { tags: [...activeLog.tags, tag] } });
        }
        dispatchUi({ type: 'SET_TAG_INPUT', value: '' });
      }
    } else if (e.key === 'Backspace' && !ui.tagInput && activeLog.tags.length > 0) {
      dispatchEntry({ type: 'UPDATE_LOG', updates: { tags: activeLog.tags.slice(0, -1) } });
    }
  }, [ui.tagInput, activeLog.tags]);

  const statusButtons = useMemo(() => [
    { value: 'planning',          label: te.status_planning,    Icon: IconStatusPlanning    },
    { value: data.progressStatus, label: te.status_in_progress, Icon: IconStatusInProgress  },
    { value: 'completed',         label: te.status_completed,   Icon: IconStatusCompleted   },
    { value: 'paused',            label: te.status_paused,      Icon: IconStatusPaused      },
    { value: 'dropped',           label: te.status_dropped,     Icon: IconStatusDropped     },
  ], [te, data.progressStatus]);

  const { label: progLabel, label2, step: progStep } = useMemo(
    () => getProgressConfig(data.type, data.format, t),
    [data.type, data.format, t],
  );

  // Editions/versions this entry could be linked to (base game + expanded editions
  // from the IGDB relation list) grouped by relation type.
  const editionGroups = useMemo(() => {
    // vnovel is its own `type` value (see IGDB_TYPES), not a variant of
    // 'game' — excluding it here meant visual novels never got the version-
    // log tabs at all, even though they go through the exact same IGDB
    // edition/relation machinery as games.
    if (!IGDB_TYPES.includes(data.type as typeof IGDB_TYPES[number])) {
      return [] as { label: string; options: { externalId: string; label: string; cover?: string }[] }[];
    }

    const groupsMap: Record<string, { externalId: string; label: string; cover?: string }[]> = {};

    if (data.parentGame) {
      groupsMap['Original'] = [{ externalId: data.parentGame.externalId, label: data.parentGame.title, cover: data.parentGame.cover }];
    }

    // Every "full edition" relation type (see IS_FULL_EDITION_TYPE in
    // igdb-mapper.ts) belongs here, not just Expanded Edition/Remaster —
    // Remake and Fork are equally their own trackable version. Matched by
    // relationType (a stable canonical key), never typeLabel — the latter is
    // re-derived in the UI's *current* locale on every reload
    // (sortRelationsForDisplay), so a hardcoded English label like "Expanded
    // Edition" only ever matched by coincidence, and never at all once the
    // UI language wasn't English (e.g. Spanish's "Edición expandida").
    const EDITION_RELATION_TYPES = new Set(['EXPANDED_GAME', 'REMASTER', 'REMAKE', 'FORK', 'PORT']);
    for (const rel of (data.relations || [])) {
      if (!rel.relationType || !EDITION_RELATION_TYPES.has(rel.relationType)) continue;
      const relExternalId = extractExternalIdFromRelationUrl(rel.url);
      if (relExternalId) {
        const groupLabel = rel.typeLabel || 'Others';
        if (!groupsMap[groupLabel]) {
          groupsMap[groupLabel] = [];
        }
        groupsMap[groupLabel].push({ externalId: relExternalId, label: rel.title, cover: rel.cover });
      }
    }

    return Object.entries(groupsMap).map(([label, options]) => ({ label, options }));
  }, [data.type, data.parentGame, data.relations]);

  const allAvailableEditions = useMemo(() => {
    const list: { externalId: string; label: string; cover?: string; relationType?: string; isBundleChild?: boolean; isSeasonTab?: boolean }[] = [];
    for (const rel of (data.relations || [])) {
      if (rel.relationType && ['EXPANDED_GAME', 'REMASTER', 'REMAKE', 'FORK', 'PORT'].includes(rel.relationType)) {
        const relExternalId = rel.relatedExternalId ?? extractExternalIdFromRelationUrl(rel.url);
        if (relExternalId && relExternalId !== baseId && !list.some(item => item.externalId === relExternalId)) {
          list.push({ externalId: relExternalId, label: rel.title, cover: rel.cover, relationType: rel.relationType });
        }
      }
    }
    // A bundle's own "editar" should let the user track each contained work
    // separately — Final Fantasy VII Remake Intergrade's base game AND its
    // INTERmission DLC — instead of only the bundle as one lump. Labeled by
    // its own real title, same as every other edition tab above (the
    // generic Juego/DLC/Part-N shorthand belongs to NeighborsRow's compact
    // thumbnail row instead — see bundleLabels.ts).
    const bundleRels = (data.relations || []).filter(rel => rel.relationType && CONTAINS_RELATION_TYPES.includes(rel.relationType));
    bundleRels.forEach(rel => {
      const relExternalId = rel.relatedExternalId ?? extractExternalIdFromRelationUrl(rel.url);
      if (relExternalId && relExternalId !== baseId && !list.some(item => item.externalId === relExternalId)) {
        list.push({ externalId: relExternalId, label: rel.title, cover: rel.cover, relationType: rel.relationType, isBundleChild: true });
      }
    });
    // Viewing a version's own page: IGDB relations aren't symmetric, so this
    // version rarely lists its own siblings back — add its own tab explicitly
    // so the log switcher looks the same as it does from the base's page.
    if (data.parentGame && !list.some(item => item.externalId === externalId)) {
      list.push({ externalId, label: data.titleMain, cover: data.cover });
    }
    // Every OTHER season in the chain — "T{n}" (not the season's own title:
    // it's usually just "Título 2nd Season", already redundant once labeled
    // by position, see stripSeasonSuffix) matching Temporadas' own badges,
    // numbered by real chain position so it still reads correctly regardless
    // of which season this editor happens to be open on. The one this editor
    // IS already open on is the "Original" tab (baseId === externalId here,
    // since anime has no parentGame), so it's excluded from this list.
    if (!isUnifiedAnime) {
      animeSeasonChain.forEach((seasonEntry, i) => {
        if (seasonEntry.externalId === baseId || seasonEntry.externalId === externalId) return;
        list.push({ externalId: seasonEntry.externalId, label: `T${i + 1}`, cover: seasonEntry.cover ?? undefined, isSeasonTab: true });
      });
    }
    return list;
  }, [baseId, data.parentGame, externalId, data.titleMain, data.cover, data.relations, animeSeasonChain, isUnifiedAnime]);

  // A bundle (Final Fantasy VII Remake Intergrade) is never itself
  // trackable — there's no meaningful "progress" on the bundle as a lump,
  // only on what it actually contains — so its own "Original" tab never
  // renders (see the tab bar below) and, if this editor was opened directly
  // on one and hasn't already been steered to a specific content tab, this
  // jumps straight to the first one instead of leaving the user stuck on a
  // tab that doesn't exist. Only fires while activeLogId is still sitting on
  // baseId/externalId — a user who already switched tabs (or a reopen that
  // remembers a previous selection) is left alone.
  const isBundle = allAvailableEditions.some(ed => ed.isBundleChild);
  useEffect(() => {
    if (!isBundle) return;
    if (entry.activeLogId !== baseId && entry.activeLogId !== externalId) return;
    const firstChild = allAvailableEditions.find(ed => ed.isBundleChild);
    if (!firstChild) return;
    if (!entry.logs[firstChild.externalId]) {
      dispatchEntry({ type: 'LOAD_LOG', id: firstChild.externalId, entry: createEmptyVersionEntry(firstChild.externalId) });
    }
    dispatchEntry({ type: 'SWITCH_LOG', id: firstChild.externalId });
    // entry.activeLogId/entry.logs intentionally excluded — re-read fresh
    // above on every run this WOULD fire on, and including them would refire
    // this every time the user's own tab switch changes activeLogId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBundle, allAvailableEditions, baseId, externalId]);

  // Every id that represents "this same game" for monthly-history purposes —
  // the base game, whichever edition's page is currently open, and every
  // other known sibling edition. A month assigned from any one of these
  // must be recognized (and removable) from all the others.
  const sameGameIds = useMemo(
    () => new Set([baseId, externalId, ...allAvailableEditions.map(e => e.externalId)]),
    [baseId, externalId, allAvailableEditions],
  );

  // Derived instead of stored: recomputing from monthlyHistory + sameGameIds
  // on every render means it self-corrects once allAvailableEditions loads
  // (async, slightly after mount), instead of freezing on whatever the
  // initial exact-externalId-only search found.
  const selectedMonthKey = useMemo(() => {
    for (const [key, ids] of Object.entries(entry.monthlyHistory)) {
      if (ids.some(id => sameGameIds.has(id))) return key;
    }
    return null;
  }, [entry.monthlyHistory, sameGameIds]);

  const handleMonthClick = useCallback((monthIndex: number) => {
    const targetKey = `${entry.selectedYear}-${String(monthIndex).padStart(2, '0')}`;
    const newKey = selectedMonthKey === targetKey ? null : targetKey;
    dispatchEntry({ type: 'SET_MONTH', ids: [...sameGameIds], primaryId: baseId, key: newKey, year: entry.selectedYear });
  }, [sameGameIds, baseId, entry.selectedYear, selectedMonthKey]);

  // Which season (if any) the currently active tab is — undefined on the
  // series' own general tab or when the season tabs aren't active at all.
  const activeSeriesSeasonInfo = useMemo(() => {
    if (!isUnifiedSeries) return undefined;
    return seriesSeasons.find(s => seriesSeasonExternalId(externalId, s.seasonNumber) === entry.activeLogId);
  }, [isUnifiedSeries, seriesSeasons, externalId, entry.activeLogId]);

  // Same "which season (if any) is the active tab" lookup as
  // activeSeriesSeasonInfo above, for anime's own unified season tabs —
  // animeSeasonChain's own SagaEntry already carries its own year/month/day
  // (unlike seasonMetaMap, which only has title/cover/totalCount), so no
  // extra fetch is needed to know a specific season's own release date.
  const activeAnimeSeasonEntry = useMemo(() => {
    if (!isUnifiedAnime) return undefined;
    return animeSeasonChain.find(s => s.externalId === entry.activeLogId);
  }, [isUnifiedAnime, animeSeasonChain, entry.activeLogId]);

  function isFutureDate(year: number | null | undefined, month: number | null | undefined, day: number | null | undefined): boolean {
    if (!year) return false;
    const releaseDate = new Date(year, (month ?? 1) - 1, day ?? 1);
    return releaseDate.getTime() > Date.now();
  }

  // Nothing not yet out can honestly be completed/dropped/paused/in-progress
  // — checked per *active tab*, not just the modal's own top-level data:
  // opening the editor from a season that hasn't aired must not also lock
  // every OTHER season's tab (already released) out of its own real status.
  // data.status is the canonical, already-cross-provider-normalized signal
  // (media-status.ts's CanonicalStatus) for the base/general case — checked
  // first since it accounts for things a bare date can't (e.g. TMDB's "In
  // Production" with no date at all yet); the release-date check is a
  // fallback/belt-and-braces for a catalog row whose status hasn't been
  // resynced recently but whose date clearly hasn't arrived.
  const isUpcoming = useMemo(() => {
    if (activeAnimeSeasonEntry) {
      return isFutureDate(activeAnimeSeasonEntry.year, activeAnimeSeasonEntry.month, activeAnimeSeasonEntry.day);
    }
    if (activeSeriesSeasonInfo) {
      if (!activeSeriesSeasonInfo.airDate) return false;
      const d = new Date(activeSeriesSeasonInfo.airDate);
      return !isNaN(d.getTime()) && d.getTime() > Date.now();
    }
    return data.status === 'NOT_YET_RELEASED' || isFutureDate(data.releaseYear, data.releaseMonth, data.releaseDay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAnimeSeasonEntry, activeSeriesSeasonInfo, data.status, data.releaseYear, data.releaseMonth, data.releaseDay]);

  const generalBaseTitle = useMemo(() => {
    return stripSeasonSuffix(animeSeasonChain[0]?.title || data.titleMain);
  }, [animeSeasonChain, data.titleMain]);

  const generalTotalCount = useMemo(() => {
    if (!isUnifiedAnime) return data.totalCount;
    return animeSeasonChain.reduce((sum, s) => sum + (seasonMetaMap[s.externalId]?.totalCount ?? 0), 0);
  }, [isUnifiedAnime, animeSeasonChain, seasonMetaMap, data.totalCount]);

  const generalProgress = useMemo(() => {
    if (!isUnifiedAnime) return activeLog.progress;
    return animeSeasonChain.reduce((sum, s) => sum + (entry.logs[s.externalId]?.progress ?? 0), 0);
  }, [isUnifiedAnime, animeSeasonChain, entry.logs, activeLog.progress]);

  // The general tab's own "seasons watched" count — auto-derived from how
  // many chain members are actually marked completed, same read-only
  // aggregate treatment as generalProgress/generalStatus above. AniList
  // gives no "this show has N seasons" field the way TMDB does for series
  // (data.totalCount_2 stays empty for anime), so animeSeasonChain.length
  // is the real total here instead.
  const generalSeasonsCompleted = useMemo(() => {
    if (!isUnifiedAnime) return 0;
    return animeSeasonChain.filter(s => entry.logs[s.externalId]?.status === 'completed').length;
  }, [isUnifiedAnime, animeSeasonChain, entry.logs]);

  const activeTotalCount = useMemo(() => {
    if (isUnifiedAnime) {
      if (isGeneralTab) return (generalTotalCount ?? 0) > 0 ? generalTotalCount : null;
      return seasonMetaMap[entry.activeLogId]?.totalCount ?? null;
    }
    // A series' general tab keeps using data.totalCount exactly as before
    // (its own real total, not derived) — only a season tab needs its own
    // episodeCount instead.
    if (activeSeriesSeasonInfo) return activeSeriesSeasonInfo.episodeCount ?? null;
    return data.totalCount;
  }, [isUnifiedAnime, isGeneralTab, generalTotalCount, seasonMetaMap, entry.activeLogId, data.totalCount, activeSeriesSeasonInfo]);

  const generalStartDate = useMemo(() => {
    if (!isUnifiedAnime) return '';
    const s1 = entry.logs[animeSeasonChain[0]?.externalId]?.startedAt;
    if (s1) return s1;
    const allStarted = animeSeasonChain.map(s => entry.logs[s.externalId]?.startedAt).filter(Boolean) as string[];
    return allStarted.sort()[0] || '';
  }, [isUnifiedAnime, animeSeasonChain, entry.logs]);

  const generalEndDate = useMemo(() => {
    if (!isUnifiedAnime) return '';
    const lastSeason = animeSeasonChain[animeSeasonChain.length - 1];
    const sLast = entry.logs[lastSeason?.externalId]?.finishedAt;
    if (sLast) return sLast;
    const allFinished = animeSeasonChain.map(s => entry.logs[s.externalId]?.finishedAt).filter(Boolean) as string[];
    return allFinished.sort().reverse()[0] || '';
  }, [isUnifiedAnime, animeSeasonChain, entry.logs]);

  const generalAverageRating = useMemo(() => {
    const ratings = animeSeasonChain
      .map(s => entry.logs[s.externalId]?.rating)
      .filter((r): r is number => typeof r === 'number' && r > 0);
    if (ratings.length === 0) return 0;
    return ratings.reduce((a, b) => a + b, 0) / ratings.length;
  }, [animeSeasonChain, entry.logs]);

  const generalAverageRating2 = useMemo(() => {
    const ratings = animeSeasonChain
      .map(s => entry.logs[s.externalId]?.rating2)
      .filter((r): r is number => typeof r === 'number' && r > 0);
    if (ratings.length === 0) return 0;
    return ratings.reduce((a, b) => a + b, 0) / ratings.length;
  }, [animeSeasonChain, entry.logs]);

  // Auto-derived, never persisted onto any single season's own row — a
  // season's real status stays whatever the user actually set it to (you may
  // have completed season 1 and dropped season 3, and that must survive
  // toggling this view off again). Only exception: manually marking the
  // general tab "completed" is a genuine bulk action (see the status button
  // handler below), because "I finished the whole thing" really does mean
  // every season is done.
  const generalStatus = useMemo(() => {
    if (!isUnifiedAnime) return '';
    return pickAggregateStatus(animeSeasonChain.map(s => entry.logs[s.externalId]?.status));
  }, [isUnifiedAnime, animeSeasonChain, entry.logs]);

  // Header cover/title follow whichever log tab is active — the base game's
  // own title/cover, the current version's, or another linked edition's.
  const activeLogDisplay = useMemo(() => {
    if (isGeneralTab) {
      return {
        title: generalBaseTitle,
        cover: animeSeasonChain[0]?.cover || data.cover,
      };
    }
    if (isUnifiedAnime && seasonMetaMap[entry.activeLogId]) {
      const meta = seasonMetaMap[entry.activeLogId];
      return {
        title: meta.title,
        cover: meta.cover || data.cover,
      };
    }
    if (activeSeriesSeasonInfo) {
      return {
        title: activeSeriesSeasonInfo.name || `T${activeSeriesSeasonInfo.seasonNumber}`,
        cover: activeSeriesSeasonInfo.coverUrl || data.cover,
      };
    }
    if (entry.activeLogId === baseId) {
      return {
        title: data.parentGame ? data.parentGame.title : data.titleMain,
        cover: data.parentGame ? data.parentGame.cover : data.cover,
      };
    }
    const found = allAvailableEditions.find(ed => ed.externalId === entry.activeLogId);
    return found
      ? { title: found.label, cover: found.cover }
      : { title: data.titleMain, cover: data.cover };
  }, [isGeneralTab, isUnifiedAnime, generalBaseTitle, animeSeasonChain, data.cover, seasonMetaMap, entry.activeLogId, baseId, data.parentGame, data.titleMain, allAvailableEditions, activeSeriesSeasonInfo]);

  const modal = (
    <motion.div
      className="me-overlay"
      onClick={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
    >
      <motion.div
        className="me-modal"
        onClick={e => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.97, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 14 }}
        transition={{ duration: 0.22, ease: [0.25, 0, 0.15, 1] }}
      >

        {/* Header */}
        <div className="me-header">
          <div className="me-header-left">
            {/* Always reserves its slot (even with no cover yet for this
                tab/season) — switching to a tab whose cover hasn't loaded
                must never shift the title text sideways. */}
            <div className="me-header-cover-slot">
              {activeLogDisplay.cover && <img src={activeLogDisplay.cover} alt="" className="me-header-cover" />}
            </div>
            <div className="me-header-col">
              <span className="me-header-title">{activeLogDisplay.title}</span>
              <div className="me-header-bottom-row">
                <div className="me-header-status-row">
                  {statusButtons.map(({ value, label, Icon }) => (
                    <button
                      key={value}
                      type="button"
                      className={`me-header-status-icon${(isGeneralTab ? generalStatus : activeLog.status) === value ? ' active' : ''}`}
                      // The general tab's status is always the auto-derived
                      // aggregate (see generalStatus) — every button except
                      // "completed" is inert there, since only "I finished
                      // the whole thing" is a real bulk action; the other
                      // four states already come from whichever season
                      // actually has them, so clicking them here would have
                      // nothing real to write.
                      //
                      // Nothing not yet released can honestly be completed/
                      // dropped/paused/in-progress — only "planning" (queued
                      // up for whenever it comes out) makes sense.
                      disabled={(isGeneralTab && value !== 'completed') || (isUpcoming && value !== 'planning')}
                      onClick={() => {
                        if (isGeneralTab) {
                          if (value !== 'completed') return;
                          const updatesById: Record<string, Partial<LogState>> = {};
                          for (const s of animeSeasonChain) {
                            const seasonTotal = seasonMetaMap[s.externalId]?.totalCount;
                            const su: Partial<LogState> = { status: 'completed' };
                            if (seasonTotal && seasonTotal > 0) su.progress = seasonTotal;
                            updatesById[s.externalId] = su;
                          }
                          dispatchEntry({ type: 'UPDATE_LOGS_BULK', updatesById });
                          return;
                        }
                        const next = activeLog.status === value ? '' : value;
                        const updates: Partial<LogState> = { status: next };
                        if (value === 'completed' && next === 'completed') {
                          if (activeTotalCount && activeTotalCount > 0) updates.progress = activeTotalCount;
                          if (data.totalCount_2 && data.totalCount_2 > 0) updates.progressCount2 = data.totalCount_2;
                        }
                        dispatchEntry({ type: 'UPDATE_LOG', updates });
                      }}
                      title={label}
                    >
                      <Icon />
                    </button>
                  ))}
                </div>

                {/* Progress input — game/vnovel is hours logged as "H:MM"
                    (see HoursField), every other type is a plain count. */}
                {progLabel && (
                  <div className="me-header-progress-pair">
                    {data.type === 'game' || data.type === 'vnovel' ? (
                      <HoursField label={progLabel} value={activeLog.progress}
                        max={activeTotalCount && activeTotalCount > 0 ? activeTotalCount : undefined}
                        onChange={v => {
                          const updates: Partial<LogState> = { progress: v };
                          if (!isUpcoming && activeTotalCount && activeTotalCount > 0 && v >= activeTotalCount && activeLog.status !== 'completed') {
                            updates.status = 'completed';
                          }
                          dispatchEntry({ type: 'UPDATE_LOG', updates });
                        }} />
                    ) : (
                    <NumberField label={progLabel} value={isGeneralTab ? generalProgress : activeLog.progress} step={progStep}
                      max={activeTotalCount && activeTotalCount > 0 ? activeTotalCount : undefined}
                      disabled={isGeneralTab}
                      onChange={v => {
                        const updates: Partial<LogState> = { progress: v };
                        if (!isUpcoming && activeTotalCount && activeTotalCount > 0 && v >= activeTotalCount && activeLog.status !== 'completed') {
                          updates.status = 'completed';
                        }
                        dispatchEntry({ type: 'UPDATE_LOG', updates });

                        // A series' general tab is the real, continuously-
                        // numbered episode count across every season (unlike
                        // anime's, this one isn't auto-derived) — so moving
                        // it has to redistribute into each season's own log
                        // too: fill season 1 up to its own episode count,
                        // then season 2, and so on, recomputed from scratch
                        // every time so decreasing the count shrinks seasons
                        // back down the same way.
                        if (isUnifiedSeries && entry.activeLogId === baseId) {
                          const updatesById: Record<string, Partial<LogState>> = {};
                          let remaining = v;
                          for (const season of seriesSeasons) {
                            const seasonId = seriesSeasonExternalId(externalId, season.seasonNumber);
                            const seasonTotal = season.episodeCount ?? 0;
                            const watched = seasonTotal > 0 ? Math.max(0, Math.min(seasonTotal, remaining)) : 0;
                            remaining = Math.max(0, remaining - watched);
                            const su: Partial<LogState> = { progress: watched };
                            const seasonReleased = !season.airDate || new Date(season.airDate).getTime() <= Date.now();
                            if (seasonReleased && seasonTotal > 0 && watched >= seasonTotal) su.status = 'completed';
                            updatesById[seasonId] = su;
                          }
                          dispatchEntry({ type: 'UPDATE_LOGS_BULK', updatesById });
                        }
                      }} />
                    )}
                    {/* Anime's general tab shows the chain's own season
                        count here instead of data.totalCount_2 (AniList has
                        no such field), auto-equal to however many seasons
                        are actually marked completed — same read-only
                        aggregate treatment as episodes/status above. Never
                        shown while rating one specific series season: "how
                        many seasons" makes no sense from inside just one of
                        them, only from the series' own general entry. */}
                    {label2 && !activeSeriesSeasonInfo && (
                      isGeneralTab
                        ? animeSeasonChain.length > 0
                        : (data.totalCount_2 !== undefined && data.totalCount_2 !== null && data.totalCount_2 > 0)
                    ) && (
                      <NumberField label={label2}
                        value={isGeneralTab ? generalSeasonsCompleted : activeLog.progressCount2}
                        step={1}
                        max={isGeneralTab ? animeSeasonChain.length : (data.totalCount_2 ?? undefined)}
                        disabled={isGeneralTab}
                        onChange={v => dispatchEntry({ type: 'UPDATE_LOG', updates: { progressCount2: v } })} />
                    )}
                  </div>
                )}

                {/* Rating — rating_2 (its own name/system) only when this
                    session was opened from the profile library with that
                    slot selected; every other entry point always edits the
                    primary rating. */}
                <HeaderField label={ratingLabel}>
                  {isSecondaryRating ? (
                    <RatingInput rating={isGeneralTab ? (activeLog.rating2 > 0 ? activeLog.rating2 : generalAverageRating2) : activeLog.rating2} system={rating2System} min={rating2Min} max={rating2Max}
                      onChange={v => dispatchEntry({ type: 'UPDATE_LOG', updates: { rating2: v } })} />
                  ) : (
                    <RatingInput rating={isGeneralTab ? (activeLog.rating > 0 ? activeLog.rating : generalAverageRating) : activeLog.rating}
                      onChange={v => dispatchEntry({ type: 'UPDATE_LOG', updates: { rating: v } })} />
                  )}
                </HeaderField>

                {/* Dates */}
                {isMovie ? (
                  <HeaderField label={te.view_date || 'Fecha de visionado'}>
                    <input type="date" className="me-header-field-input me-header-field-input--date"
                      min={`${MIN_DATE_YEAR}-01-01`}
                      value={activeLog.startedAt || activeLog.finishedAt}
                      onChange={e => {
                        const val = e.target.value;
                        const updates: Partial<LogState> = { startedAt: val, finishedAt: val };
                        if (val && !isUpcoming) {
                          updates.status = 'completed';
                          if (activeTotalCount && activeTotalCount > 0) updates.progress = activeTotalCount;
                          if (data.totalCount_2 && data.totalCount_2 > 0) updates.progressCount2 = data.totalCount_2;
                        }
                        dispatchEntry({ type: 'UPDATE_LOG', updates });
                      }}
                      onBlur={e => {
                        const val = clampDateMinYear(e.target.value);
                        if (val !== e.target.value) dispatchEntry({ type: 'UPDATE_LOG', updates: { startedAt: val, finishedAt: val } });
                      }} />
                  </HeaderField>
                ) : (
                  <>
                    <HeaderField label={te.started}>
                      <input type="date" className="me-header-field-input me-header-field-input--date"
                        min={`${MIN_DATE_YEAR}-01-01`}
                        max={activeLog.finishedAt || undefined}
                        disabled={isGeneralTab}
                        value={isGeneralTab ? generalStartDate : activeLog.startedAt}
                        onChange={e => dispatchEntry({ type: 'UPDATE_LOG', updates: { startedAt: e.target.value } })}
                        onBlur={e => {
                          const val = clampDateMinYear(e.target.value);
                          const updates: Partial<LogState> = {};
                          if (val !== e.target.value) updates.startedAt = val;
                          if (activeLog.finishedAt && val > activeLog.finishedAt) updates.finishedAt = val;
                          if (Object.keys(updates).length > 0) dispatchEntry({ type: 'UPDATE_LOG', updates });
                        }} />
                    </HeaderField>
                    <HeaderField label={te.ended}>
                      <input type="date" className="me-header-field-input me-header-field-input--date"
                        min={activeLog.startedAt || `${MIN_DATE_YEAR}-01-01`}
                        disabled={isGeneralTab}
                        value={isGeneralTab ? generalEndDate : activeLog.finishedAt}
                        onChange={e => {
                          const val = e.target.value;
                          const updates: Partial<LogState> = { finishedAt: val };
                          if (val && !isUpcoming) {
                            updates.status = 'completed';
                            if (activeTotalCount && activeTotalCount > 0) updates.progress = activeTotalCount;
                            if (data.totalCount_2 && data.totalCount_2 > 0) updates.progressCount2 = data.totalCount_2;
                          }
                          dispatchEntry({ type: 'UPDATE_LOG', updates });
                        }}
                        onBlur={e => {
                          const val = clampNotBefore(clampDateMinYear(e.target.value), activeLog.startedAt);
                          if (val !== e.target.value) dispatchEntry({ type: 'UPDATE_LOG', updates: { finishedAt: val } });
                        }} />
                    </HeaderField>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="me-header-right">
            <button type="button"
              className={`me-header-icon-btn${activeLog.isFavorite ? ' active' : ''}`}
              onClick={() => dispatchEntry({ type: 'UPDATE_LOG', updates: { isFavorite: !activeLog.isFavorite } })}
              title={te.favorite}>
              <IconHeart filled={activeLog.isFavorite} size={18} />
            </button>
            {(data.type === 'game' || data.type === 'vnovel') && (
              <button type="button"
                className={`me-header-icon-btn${activeLog.isPlatinum ? ' active' : ''}`}
                onClick={() => dispatchEntry({ type: 'UPDATE_LOG', updates: { isPlatinum: !activeLog.isPlatinum } })}
                title={te.platinum}>
                <IconPlatinum filled={activeLog.isPlatinum} size={18} />
              </button>
            )}
            {isAniListType(data.type) && (
              <button type="button"
                className={`me-header-icon-btn${ui.anilistImportStatus === 'error' ? ' me-header-icon-btn--error' : ''}${ui.anilistImportStatus === 'syncing' ? ' me-header-icon-btn--spinning' : ''}`}
                onClick={handleImportFromAniList}
                disabled={ui.anilistImportStatus === 'syncing'}
                title={ui.anilistImportStatus === 'error' ? (ui.anilistImportError ?? te.anilist_error) : te.import_from_anilist}>
                {ui.anilistImportStatus === 'ok' ? <IconCheck size={16} strokeWidth={2.5} /> : <IconDownload />}
              </button>
            )}
          </div>
        </div>

        {(isUnifiedAnime || isUnifiedSeries || data.parentGame || allAvailableEditions.length > 0) && (
          <div className="me-versions-tabs">
            {isUnifiedAnime ? (
              <>
                <button
                  type="button"
                  className={`me-version-tab-btn${entry.activeLogId === GENERAL_LOG_ID ? ' active' : ''}`}
                  title={generalBaseTitle}
                  onClick={() => dispatchEntry({ type: 'SWITCH_LOG', id: GENERAL_LOG_ID })}
                >
                  {generalBaseTitle}
                </button>
                <span className="me-version-tab-separator">|</span>
                {animeSeasonChain.map(seasonEntry => {
                  const isActive = entry.activeLogId === seasonEntry.externalId;
                  const sTitle = seasonMetaMap[seasonEntry.externalId]?.title || seasonEntry.title;
                  const label = formatSeasonTabLabel(sTitle, generalBaseTitle);
                  return (
                    <button
                      key={seasonEntry.externalId}
                      type="button"
                      className={`me-version-tab-btn${isActive ? ' active' : ''}`}
                      title={sTitle}
                      onClick={() => {
                        if (!entry.logs[seasonEntry.externalId]) {
                          dispatchEntry({ type: 'LOAD_LOG', id: seasonEntry.externalId, entry: createEmptyVersionEntry(seasonEntry.externalId, 'anime') });
                        }
                        dispatchEntry({ type: 'SWITCH_LOG', id: seasonEntry.externalId });
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </>
            ) : isUnifiedSeries ? (
              <>
                {/* Unlike anime's general tab, this one is the series' own
                    real entry — fully editable as it's always been, not a
                    derived read-mostly aggregate — so it's just baseId/
                    externalId under a friendlier label, same identity the
                    plain (non-tabbed) form below already edits. */}
                <button
                  type="button"
                  className={`me-version-tab-btn${entry.activeLogId === baseId ? ' active' : ''}`}
                  title={data.titleMain}
                  onClick={() => dispatchEntry({ type: 'SWITCH_LOG', id: baseId })}
                >
                  {data.titleMain}
                </button>
                <span className="me-version-tab-separator">|</span>
                {seriesSeasons.map(season => {
                  const seasonId = seriesSeasonExternalId(externalId, season.seasonNumber);
                  const isActive = entry.activeLogId === seasonId;
                  const label = `T${season.seasonNumber}`;
                  return (
                    <button
                      key={seasonId}
                      type="button"
                      className={`me-version-tab-btn${isActive ? ' active' : ''}`}
                      title={season.name || label}
                      onClick={() => {
                        if (!entry.logs[seasonId]) {
                          dispatchEntry({ type: 'LOAD_LOG', id: seasonId, entry: createEmptyVersionEntry(seasonId, 'series') });
                        }
                        dispatchEntry({ type: 'SWITCH_LOG', id: seasonId });
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </>
            ) : (
              <>
                {/* A bundle is never itself trackable (see isBundle's own
                    comment above) — no "Original" tab for it, only its contents. */}
                {!isBundle && (
                  <button
                    type="button"
                    className={`me-version-tab-btn${entry.activeLogId === baseId ? ' active' : ''}`}
                    onClick={() => dispatchEntry({ type: 'SWITCH_LOG', id: baseId })}
                  >
                    {te.original}
                  </button>
                )}
                {allAvailableEditions.map(ed => {
                  const isActive = entry.activeLogId === ed.externalId;
                  // ed.label is already each edition's (bundle child included)
                  // own real title — editionTabLabel just shortens it to
                  // whatever follows a colon, same treatment for all of them.
                  let tabLabel = editionTabLabel(ed.label, te.edition_default);

                  // If it's a REMAKE with the same suffix as the original, label it "Remake"
                  if (ed.relationType === 'REMAKE') {
                    const getLastPart = (title: string) => {
                      const idx = title.lastIndexOf(':');
                      return idx === -1 ? '' : title.substring(idx);
                    };
                    const originalTitle = data.parentGame?.title || data.titleMain;
                    const originalLast = getLastPart(originalTitle);
                    const editionLast = getLastPart(ed.label);
                    if (originalLast && editionLast && originalLast === editionLast) {
                      tabLabel = te.remake;
                    }
                  }

                  return (
                    <button
                      key={ed.externalId}
                      type="button"
                      className={`me-version-tab-btn${isActive ? ' active' : ''}`}
                      title={ed.label}
                      onClick={() => {
                        if (!ed.isBundleChild && !ed.isSeasonTab) {
                          const baseLogVal = entry.logs[baseId] || createDefaultLog();
                          const currentVersions = baseLogVal.selectedVersion
                            ? baseLogVal.selectedVersion.split(',')
                            : [];
                          if (!currentVersions.includes(ed.externalId)) {
                            const nextVersions = [...currentVersions, ed.externalId].join(',');
                            dispatchEntry({ type: 'SET_VERSION', value: nextVersions, baseId });
                          }
                        }
                        if (!entry.logs[ed.externalId]) {
                          dispatchEntry({ type: 'LOAD_LOG', id: ed.externalId, entry: createEmptyVersionEntry(ed.externalId, ed.isSeasonTab ? 'anime' : 'game') });
                        }
                        dispatchEntry({ type: 'SWITCH_LOG', id: ed.externalId });
                      }}
                    >
                      {tabLabel}
                    </button>
                  );
                })}
              </>
            )}
          </div>
        )}

        {ui.loading ? (
          <div className="me-loading"><div className="spinner" /></div>
        ) : (
          <div className="me-body">
            <div className="me-content-wrapper">
              <div className="me-main-box">
                <div className="me-grid">
                  <div className="me-col">
                    <div className="me-section">
                      <span className="me-label">
                        {te.tags}
                        <span className="me-label-hint">{activeLog.tags.length}/5</span>
                      </span>
                      <div className="me-tags-box">
                        {activeLog.tags.map(tag => (
                          <span key={tag} className="me-tag">
                            {tag}
                            <button type="button" className="me-tag-remove"
                              onClick={() => dispatchEntry({ type: 'UPDATE_LOG', updates: { tags: activeLog.tags.filter(t => t !== tag) } })}>×</button>
                          </span>
                        ))}
                        {activeLog.tags.length < 5 && (
                          <input type="text" className="me-tag-input"
                            placeholder={te.add_tag}
                            value={ui.tagInput}
                            onChange={e => dispatchUi({ type: 'SET_TAG_INPUT', value: e.target.value })}
                            onKeyDown={handleTagKeyDown} />
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="me-notes-box-side">
                <span className="me-label">{te.notes}</span>
                <textarea className="me-textarea" rows={12}
                  placeholder={te.notes_ph}
                  value={activeLog.notes}
                  onChange={e => dispatchEntry({ type: 'UPDATE_LOG', updates: { notes: e.target.value } })} />

                <div className="me-month-selector-section">
                  <div className="me-month-header">
                    <span className="me-label">{te.history_month}</span>
                    <div className="me-year-selector">
                      <button type="button" className="me-year-arrow"
                        onClick={() => dispatchEntry({ type: 'SET_YEAR', delta: -1 })}>&lt;</button>
                      <span className="me-year-val">{entry.selectedYear}</span>
                      <button type="button" className="me-year-arrow"
                        onClick={() => dispatchEntry({ type: 'SET_YEAR', delta: 1 })}>&gt;</button>
                    </div>
                  </div>
                  <div className="me-month-grid">
                    {te.months.map((mName, idx) => {
                      const mNumber = idx + 1;
                      const key = `${entry.selectedYear}-${String(mNumber).padStart(2, '0')}`;
                      const isSelected = selectedMonthKey === key;
                      // Only 1 game per month across the whole library — a
                      // month already claimed by a genuinely *different* game
                      // is blocked here instead of letting SET_MONTH silently
                      // pile more than one id into the same slot. Any id that
                      // belongs to *this* game (base or any known edition)
                      // never counts as taken, so the month stays freely
                      // toggleable regardless of which edition tab set it.
                      const monthIds = entry.monthlyHistory[key] ?? [];
                      const takenBy = monthIds.find(id => !sameGameIds.has(id));
                      const occupantId = takenBy ?? monthIds.find(id => sameGameIds.has(id));
                      const occupant = occupantId ? monthMediaInfo[occupantId] : undefined;
                      return (
                        <button key={key} type="button"
                          className={`me-month-btn${isSelected ? ' active' : ''}${takenBy ? ' me-month-btn--taken' : ''}${occupant?.cover ? ' me-month-btn--has-cover' : ''}`}
                          disabled={!!takenBy}
                          title={takenBy ? `${te.month_taken}${occupant ? `: ${occupant.title}` : ''}` : undefined}
                          onClick={() => handleMonthClick(mNumber)}>
                          {occupant?.cover && (
                            <>
                              {/* Blurred, cover-cropped backdrop fills the whole
                                  card (no dead space) — the sharp <img> on top,
                                  sized with object-fit:contain, shows the full
                                  poster undistorted instead of a hard crop,
                                  since posters are portrait and this card is a
                                  short rectangle. */}
                              <div className="me-month-btn-backdrop" style={{ backgroundImage: `url('${occupant.cover}')` }} />
                              <img className="me-month-btn-cover-img" src={occupant.cover} alt="" />
                            </>
                          )}
                          <span className="me-month-btn-label">{mName}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="me-button-stack-side">
                <button type="button" className="me-btn me-btn--save"
                  onClick={handleSave} disabled={ui.saving}>
                  {ui.saving ? te.saving : te.save}
                </button>
                {/* Always rendered (reserved slot, hidden via CSS when this
                    tab's log has never been saved) — switching between a
                    logged and an unlogged season must never shift Share
                    (and the AniList status line below it) up or down. */}
                <button type="button"
                  className={`me-btn me-btn--delete${!activeLog.existing ? ' me-btn--hidden' : ''}`}
                  onClick={handleDelete} disabled={!activeLog.existing}
                  tabIndex={activeLog.existing ? 0 : -1}
                  title={te.delete}>
                  <IconTrash size={15} strokeWidth={2.5} />
                </button>
                <button type="button" className="me-btn me-btn--share"
                  onClick={handleShare} disabled={activeLog.status !== 'completed' || sharing}
                  title={activeLog.status !== 'completed' ? 'Termínalo para poder compartirlo' : 'Compartir'}>
                  {sharing ? (
                    <span className="spinner spinner--sm" />
                  ) : (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="18" cy="5" r="3"></circle>
                      <circle cx="6" cy="12" r="3"></circle>
                      <circle cx="18" cy="19" r="3"></circle>
                      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
                      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
                    </svg>
                  )}
                </button>
                {isAniListType(data.type) && ui.anilistStatus !== 'idle' && (
                  <div className={`me-anilist-status me-anilist-status--${ui.anilistStatus}`}>
                    {ui.anilistStatus === 'syncing' && (
                      <><span className="me-anilist-spinner" /><span>AniList…</span></>
                    )}
                    {ui.anilistStatus === 'ok' && (
                      <><IconCheck size={12} strokeWidth={2.5} /><span>AniList</span></>
                    )}
                    {ui.anilistStatus === 'error' && (
                      <><IconAlertCircle size={12} strokeWidth={2.5} /><span title={ui.anilistError ?? ''}>{te.anilist_error}</span></>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  );

  return typeof document !== 'undefined'
    ? createPortal(modal, document.body)
    : null;
}
