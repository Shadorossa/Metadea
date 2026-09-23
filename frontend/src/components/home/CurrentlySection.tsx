// "Actualmente" on Home — what you're currently watching/reading/playing,
// grouped by media type, capped to 5 per type so one type with 40 entries
// doesn't push everything else off-screen. First paint comes from the Home
// snapshot (lib/home/home-snapshot.ts); the live bundle then reconciles it,
// and the +/- shortcuts only appear once that live data is in.
import { useEffect, useState } from 'react';
import { getT } from '../../i18n/runtime';
import { loadHomeData, loadHomeSagaNames } from '../../lib/home/home-data';
import { isInProgressStatus, getTypeLabel } from '../../lib/media/media-types';
import { wrapAssetUrl, saveLibraryEntry } from '../../lib/tauri';
import type { LibraryEntry } from '../../lib/tauri';
import { typeIconMap } from '../../lib/dom/icon-strings';
import { toSmallCover } from '../../lib/media/small-cover';
import { isAniListType, syncToAniList } from '../../lib/media/anilist-sync';
import { isUnifySeasonsEnabled } from '../../lib/storage/preferences';
import { unifyAnimeSeasons } from '../../lib/profile/library-grouping';
import {
  readHomeSnapshot,
  sameIds,
  updateHomeSnapshot,
  type CurrentlyCardItem,
  type CurrentlyTypeGroup as TypeGroup,
} from '../../lib/home/home-snapshot';

const TYPE_ICON = typeIconMap(14);
const MAX_PER_TYPE = 5;
// Covers in the first two groups are the first row on screen.
const EAGER_GROUPS = 2;

const groupsKey = (groups: TypeGroup[]) =>
  groups.map(g => `${g.type}:${g.items.map(i => `${i.linkId}/${i.displayProgress}/${i.coverUrl ?? ''}`).join(',')}`);

// linkId is always the earliest-release season's own id ("la primera y más
// básica" — same convention LibraryCard's fused card uses for its own
// /media link), but trackedEntry (status/cover, and what +/- persists to)
// is whichever season is actually being watched (unifyAnimeSeasons'
// statusSourceItem) — without this split, each season showed up as its own
// separate row here, so finishing one season and starting the next just
// looked like "the same card's cover keeps changing" as they replaced each
// other in the list.
//
// displayProgress is separate from trackedEntry.progress: the number shown
// here is the general work's own continuous episode count (every season's
// progress summed), same "obra general" total the media editor's unified
// tab already shows — not just however far into the *current* season alone
// you are. For anything not part of a unified group it's just that entry's
// own progress, same as trackedEntry.progress.
//
// seasonMembers (unified groups only) is every season's own log plus its
// own episode total, in release order — [group.item, ...group.grouped] is
// already sorted that way by unifyAnimeSeasons. adjustProgress uses it to
// redistribute the +/- across seasons (fill season 1 up to its own total,
// then season 2, ...) instead of just piling extra progress onto whichever
// season happened to be "active" past its own episode count.
// (CurrentlyCardItem / TypeGroup live in lib/home/home-snapshot.ts, since
// the snapshot persists them.)

export function CurrentlySection() {
  const t = getT().home;
  // client:only island: the snapshot can seed the very first render.
  const [initialGroups] = useState(() => readHomeSnapshot()?.currently ?? null);
  const [groups, setGroups] = useState<TypeGroup[] | null>(initialGroups);
  const [live, setLive] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // One get_home_bundle round trip (shared with the calendar below and
      // the profile tabs) instead of the per-command chain.
      const data = await loadHomeData();
      if (cancelled) return;
      const { items, catalog, relations } = data;
      const catalogMap = new Map(catalog.map(c => [c.external_id, c]));

      let cards: CurrentlyCardItem[];
      if (isUnifySeasonsEnabled()) {
        const sagaNames = await loadHomeSagaNames(data);
        if (cancelled) return;
        const { consumedIds, groups: seasonGroups } = unifyAnimeSeasons(items, catalogMap, relations, sagaNames);
        const standalone = items.filter(i => !consumedIds.has(i.external_id));
        cards = [
          ...standalone.map(entry => ({
            linkId: entry.external_id,
            trackedEntry: entry,
            coverUrl: catalogMap.get(entry.external_id)?.cover_url ?? null,
            displayProgress: entry.progress,
          })),
          ...seasonGroups.map(group => {
            const orderedMembers = [group.item, ...group.grouped];
            return {
              linkId: group.item.external_id,
              trackedEntry: group.statusSourceItem,
              coverUrl: catalogMap.get(group.statusSourceItem.external_id)?.cover_url
                ?? catalogMap.get(group.item.external_id)?.cover_url
                ?? null,
              displayProgress: orderedMembers.reduce((sum, s) => sum + (s.progress ?? 0), 0),
              seasonMembers: orderedMembers.map(entry => ({
                entry,
                total: catalogMap.get(entry.external_id)?.total_count ?? 0,
              })),
            };
          }),
        ];
      } else {
        cards = items.map(entry => ({
          linkId: entry.external_id,
          trackedEntry: entry,
          coverUrl: catalogMap.get(entry.external_id)?.cover_url ?? null,
          displayProgress: entry.progress,
        }));
      }

      const inProgress = cards.filter(c => isInProgressStatus(c.trackedEntry.status));

      const byType = new Map<string, CurrentlyCardItem[]>();
      for (const card of inProgress) {
        const list = byType.get(card.trackedEntry.type) ?? [];
        list.push(card);
        byType.set(card.trackedEntry.type, list);
      }

      const result: TypeGroup[] = [...byType.entries()].map(([type, typeCards]) => ({
        type,
        items: typeCards
          // Most recently touched first, same "what's active right now" intent as progress.
          .sort((a, b) => (b.trackedEntry.updated_at ?? '').localeCompare(a.trackedEntry.updated_at ?? ''))
          .slice(0, MAX_PER_TYPE),
      }));
      setGroups(prev => (prev && sameIds(groupsKey(prev), groupsKey(result), k => k) ? prev : result));
      setLive(true);
    })();

    return () => { cancelled = true; };
  }, []);

  // Quick +/- shortcut on each cover so bumping progress doesn't require
  // opening the profile editor — not offered for games (group.type ===
  // 'game'), which don't track a chapter/episode-style progress number.
  // Updates local state immediately, then persists + AniList-syncs in the
  // background (same convention as LocalMediaDetailPanel's markWatched).
  // `previous` is the groups snapshot from before the optimistic update: if
  // the save fails the UI returns to it, instead of keeping a count the
  // database never accepted.
  // Keep the snapshot in step with what is on screen (live data only, so a
  // stale snapshot never writes itself back).
  useEffect(() => {
    if (live && groups) updateHomeSnapshot({ currently: groups });
  }, [live, groups]);

  function persistAndSync(updated: LibraryEntry, previous: TypeGroup[]) {
    saveLibraryEntry(updated).catch(err => {
      console.error('Failed to update progress:', err);
      setGroups(previous);
    });
    if (isAniListType(updated.type)) {
      syncToAniList({
        externalId:      updated.external_id,
        type:            updated.type,
        status:          updated.status ?? '',
        rating:          updated.rating ?? 0,
        progress:        updated.progress,
        progressVolumes: updated.progress_2 ?? 0,
        startedAt:       updated.started_at ?? '',
        finishedAt:      updated.finished_at ?? '',
        notes:           updated.notes ?? '',
      }).catch(err => console.error('Failed to sync progress to AniList:', err));
    }
  }

  // cardLinkId (not trackedEntry's own id) identifies the card, since a
  // unified group's tracked/active season can itself change as part of
  // this very adjustment (rolling over into the next season).
  function adjustProgress(cardLinkId: string, delta: number) {
    setGroups(prev => {
      if (!prev) return prev;
      const card = prev.flatMap(g => g.items).find(i => i.linkId === cardLinkId);
      if (!card) return prev;

      let updatedTracked: LibraryEntry;
      let updatedSeasonMembers: Array<{ entry: LibraryEntry; total: number }> | undefined;
      let newDisplayProgress: number;
      const changed: LibraryEntry[] = [];

      if (!card.seasonMembers) {
        const progress = Math.max(0, card.trackedEntry.progress + delta);
        if (progress === card.trackedEntry.progress) return prev;
        updatedTracked = { ...card.trackedEntry, progress };
        newDisplayProgress = progress;
        changed.push(updatedTracked);
      } else {
        // The general count moves by delta, then gets redistributed across
        // every season in release order — fill season 1 up to its own
        // total, then season 2, and so on — recomputed from scratch each
        // time so a "-1" that crosses a season boundary rolls back into
        // the previous season the same way a "+1" rolls forward.
        newDisplayProgress = Math.max(0, card.displayProgress + delta);
        let remaining = newDisplayProgress;
        updatedSeasonMembers = card.seasonMembers.map(({ entry, total }) => {
          const watched = total > 0 ? Math.min(total, remaining) : 0;
          remaining = Math.max(0, remaining - watched);
          if (watched === entry.progress) return { entry, total };
          const updated = { ...entry, progress: watched };
          changed.push(updated);
          return { entry: updated, total };
        });
        if (changed.length === 0) return prev;
        // The season that should now carry status/cover/AniList-sync duty:
        // the first one that isn't fully watched yet, or — if every season
        // is either full or the count landed exactly on a boundary — the
        // last one that actually has any progress on it.
        updatedTracked = updatedSeasonMembers.find(m => m.total > 0 && m.entry.progress < m.total)?.entry
          ?? [...updatedSeasonMembers].reverse().find(m => m.entry.progress > 0)?.entry
          ?? updatedSeasonMembers[0].entry;
      }

      const next = prev.map(group => ({
        ...group,
        items: group.items.map(item =>
          item.linkId === cardLinkId
            ? {
                ...item,
                trackedEntry: updatedTracked,
                displayProgress: newDisplayProgress,
                ...(updatedSeasonMembers ? { seasonMembers: updatedSeasonMembers } : {}),
              }
            : item
        ),
      }));

      for (const entry of changed) persistAndSync(entry, prev);
      return next;
    });
  }

  if (!groups || groups.length === 0) return null;

  return (
    <div className={`home-currently-groups${initialGroups === null ? ' home-fade-in' : ''}`}>
      {groups.map((group, groupIndex) => (
        <div className="home-currently-group" key={group.type}>
          <div className="home-currently-group-label">
            <span dangerouslySetInnerHTML={{ __html: TYPE_ICON[group.type] ?? '' }} />
            <span>{getTypeLabel(group.type)}</span>
          </div>
          <div className="home-currently-row">
            {group.items.map(item => (
              <div className="home-currently-item" key={item.linkId}>
                <a
                  className="home-currently-item-link"
                  href={`/media?id=${encodeURIComponent(item.linkId)}`}
                >
                  {item.coverUrl
                    ? <img
                        className="home-currently-cover"
                        src={wrapAssetUrl(toSmallCover(item.coverUrl))}
                        alt=""
                        width={90}
                        height={130}
                        loading={groupIndex < EAGER_GROUPS ? 'eager' : 'lazy'}
                        fetchPriority={groupIndex < EAGER_GROUPS ? 'high' : 'auto'}
                        decoding="async"
                      />
                    : <div className="home-currently-cover home-currently-cover--empty" />}
                </a>
                {live && group.type !== 'game' && (
                  <div className="home-currently-progress">
                    <button
                      type="button"
                      className="home-currently-progress-btn"
                      onClick={() => adjustProgress(item.linkId, -1)}
                      aria-label={t.progress_decrement}
                    >
                      −
                    </button>
                    <span className="home-currently-progress-value">{item.displayProgress}</span>
                    <button
                      type="button"
                      className="home-currently-progress-btn"
                      onClick={() => adjustProgress(item.linkId, 1)}
                      aria-label={t.progress_increment}
                    >
                      +
                    </button>
                  </div>
                )}
              </div>
            ))}
            {/* Keeps every row the same width (5 slots) regardless of how
                many in-progress works that type actually has right now. */}
            {Array.from({ length: MAX_PER_TYPE - group.items.length }).map((_, i) => (
              <div className="home-currently-item home-currently-item--empty" key={`empty-${i}`}>
                <div className="home-currently-cover home-currently-cover--empty" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
