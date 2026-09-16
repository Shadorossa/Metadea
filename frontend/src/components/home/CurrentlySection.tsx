// "Actualmente" on Home — what you're currently watching/reading/playing,
// grouped by media type, capped to 5 per type so one type with 40 entries
// doesn't push everything else off-screen.
import { useEffect, useState } from 'react';
import { getCachedLibraryAndCatalog } from '../../lib/profile/library-data-cache';
import { isInProgressStatus, getTypeLabel } from '../../lib/constants/media';
import { wrapAssetUrl, saveLibraryEntry, getAllMediaRelations, getSagaNames } from '../../lib/tauri';
import type { LibraryEntry, MediaCatalogEntry } from '../../lib/tauri';
import { typeIconMap } from '../../lib/shared/icon-strings';
import { toSmallCover } from '../../lib/shared/small-cover';
import { isAniListType, syncToAniList } from '../../lib/media/anilist-sync';
import { isUnifySeasonsEnabled } from '../../lib/settings/preferences';
import { unifyAnimeSeasons } from '../profile/library-grouping';

const TYPE_ICON = typeIconMap(14);
const MAX_PER_TYPE = 5;

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
interface CurrentlyCardItem {
  linkId: string;
  trackedEntry: LibraryEntry;
  coverUrl: string | null;
  displayProgress: number;
}

interface TypeGroup {
  type:  string;
  items: CurrentlyCardItem[];
}

export function CurrentlySection() {
  const [groups, setGroups] = useState<TypeGroup[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [{ items, catalog }, relations] = await Promise.all([
        getCachedLibraryAndCatalog(),
        getAllMediaRelations().catch(() => []),
      ]);
      if (cancelled) return;
      const catalogMap = new Map(catalog.map(c => [c.external_id, c]));

      let cards: CurrentlyCardItem[];
      if (isUnifySeasonsEnabled()) {
        const sagaNames = await getSagaNames(items.map(i => i.external_id)).catch(() => ({} as Record<string, string>));
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
          ...seasonGroups.map(group => ({
            linkId: group.item.external_id,
            trackedEntry: group.statusSourceItem,
            coverUrl: catalogMap.get(group.statusSourceItem.external_id)?.cover_url
              ?? catalogMap.get(group.item.external_id)?.cover_url
              ?? null,
            displayProgress: [group.item, ...group.grouped].reduce((sum, s) => sum + (s.progress ?? 0), 0),
          })),
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
      setGroups(result);
    })();

    return () => { cancelled = true; };
  }, []);

  // Quick +/- shortcut on each cover so bumping progress doesn't require
  // opening the profile editor — not offered for games (group.type ===
  // 'game'), which don't track a chapter/episode-style progress number.
  // Updates local state immediately, then persists + AniList-syncs in the
  // background (same convention as LocalMediaDetailPanel's markWatched).
  function adjustProgress(trackedExternalId: string, delta: number) {
    setGroups(prev => {
      if (!prev) return prev;
      const current = prev.flatMap(g => g.items).find(i => i.trackedEntry.external_id === trackedExternalId);
      if (!current) return prev;
      const progress = Math.max(0, current.trackedEntry.progress + delta);
      if (progress === current.trackedEntry.progress) return prev;
      // The general/summed displayProgress moves by the SAME amount the
      // tracked season's own progress just did — only one season's count
      // changed, so its effect on the sum is identical to its own delta,
      // no need to re-sum every other season in the group from scratch.
      const appliedDelta = progress - current.trackedEntry.progress;
      const updated: LibraryEntry = { ...current.trackedEntry, progress };

      const next = prev.map(group => ({
        ...group,
        items: group.items.map(item =>
          item.trackedEntry.external_id === trackedExternalId
            ? { ...item, trackedEntry: updated, displayProgress: item.displayProgress + appliedDelta }
            : item
        ),
      }));

      saveLibraryEntry(updated).catch(err => console.error('Failed to update progress:', err));
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
      return next;
    });
  }

  if (!groups || groups.length === 0) return null;

  return (
    <div className="home-currently-groups">
      {groups.map(group => (
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
                    ? <img className="home-currently-cover" src={wrapAssetUrl(toSmallCover(item.coverUrl))} alt="" loading="lazy" />
                    : <div className="home-currently-cover home-currently-cover--empty" />}
                </a>
                {group.type !== 'game' && (
                  <div className="home-currently-progress">
                    <button
                      type="button"
                      className="home-currently-progress-btn"
                      onClick={() => adjustProgress(item.trackedEntry.external_id, -1)}
                      aria-label="Restar"
                    >
                      −
                    </button>
                    <span className="home-currently-progress-value">{item.displayProgress}</span>
                    <button
                      type="button"
                      className="home-currently-progress-btn"
                      onClick={() => adjustProgress(item.trackedEntry.external_id, 1)}
                      aria-label="Sumar"
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
