// Pure episode-range and grouping math behind PrEditorStoryArcsSection: how
// an arc's flat item list folds into display units (grouped works share one
// row), how a unit's episodes are numbered continuously across its works,
// and how a global episode range maps back onto each work's own range.
import type { MediaEpisode } from '../../tauri';
import type { StoryArcItem } from '../../tauri/story-arcs';

export interface StoryArcEditingItem {
  media_external_id: string;
  title: string;
  cover: string | null;
  ep_start: number | null;
  ep_end: number | null;
  group_id?: string | null;
}

export interface StoryArcDisplayUnit {
  id: string;
  isGroup: boolean;
  groupId: string | null;
  items: StoryArcEditingItem[];
}

export interface UnifiedEpisode {
  generalEpNumber: number;
  seasonEpNumber: number;
  mediaExternalId: string;
  mediaTitle: string;
  name: string | null;
  coverUrl: string | null;
}

export function formatRange(item: Pick<StoryArcItem, 'ep_start' | 'ep_end'>): string {
  if (item.ep_start != null && item.ep_end != null) return `${item.ep_start}-${item.ep_end}`;
  if (item.ep_start != null) return `${item.ep_start}+`;
  return '';
}

// Orders grouped works strictly by the prequel/sequel chain; works outside
// the chain keep their relative order after the ones inside it.
export function sortBySagaOrder<T extends { media_external_id: string }>(items: T[], sagaOrder: string[]): T[] {
  if (sagaOrder.length <= 1) return items;
  return [...items].sort((a, b) => {
    const idxA = sagaOrder.indexOf(a.media_external_id);
    const idxB = sagaOrder.indexOf(b.media_external_id);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return 0;
  });
}

export function buildDisplayUnits(items: StoryArcEditingItem[], sagaOrder: string[] = []): StoryArcDisplayUnit[] {
  const units: StoryArcDisplayUnit[] = [];
  const visited = new Set<number>();

  for (let i = 0; i < items.length; i++) {
    if (visited.has(i)) continue;
    const item = items[i];

    if (item.group_id) {
      const groupItems: StoryArcEditingItem[] = [];
      for (let j = 0; j < items.length; j++) {
        if (items[j].group_id === item.group_id) {
          visited.add(j);
          groupItems.push(items[j]);
        }
      }
      units.push({
        id: item.group_id,
        isGroup: groupItems.length > 1,
        groupId: item.group_id,
        items: sortBySagaOrder(groupItems, sagaOrder),
      });
    } else {
      visited.add(i);
      units.push({ id: item.media_external_id, isGroup: false, groupId: null, items: [item] });
    }
  }

  return units;
}

// Only works that are part of the saga chain can be grouped into one row.
export function canGroupUnits(u1: StoryArcDisplayUnit | undefined, u2: StoryArcDisplayUnit | undefined, sagaOrder: string[]): boolean {
  if (!u1 || !u2 || !sagaOrder || sagaOrder.length <= 1) return false;
  return u1.items.every(i => sagaOrder.includes(i.media_external_id)) &&
         u2.items.every(i => sagaOrder.includes(i.media_external_id));
}

// Continuous episode numbering across a unit's works: each work's episodes
// are numbered from where the previous work left off, unless the source
// already numbers them globally (then the larger of the two wins).
export function getUnifiedEpisodes(unit: StoryArcDisplayUnit, episodesMap: Record<string, MediaEpisode[]>): UnifiedEpisode[] {
  const result: UnifiedEpisode[] = [];
  let cumulativeOffset = 0;

  for (const item of unit.items) {
    const eps = (episodesMap[item.media_external_id] || []).filter(e => e.episode_number > 0);
    if (eps.length > 0) {
      eps.sort((a, b) => a.episode_number - b.episode_number);
      const baseOffset = cumulativeOffset;
      for (let i = 0; i < eps.length; i++) {
        const ep = eps[i];
        const seasonEpNumber = i + 1;
        const generalEpNumber = Math.max(Math.round(ep.episode_number), baseOffset + i + 1);

        result.push({
          generalEpNumber,
          seasonEpNumber,
          mediaExternalId: item.media_external_id,
          mediaTitle: item.title,
          name: ep.name,
          coverUrl: ep.cover_url,
        });
      }
      cumulativeOffset = result[result.length - 1].generalEpNumber;
    }
  }
  return result;
}

// A stored per-work range may be in either numbering (global or the work's
// own); the first work with a start wins the start, the last with an end
// wins the end.
export function getUnitGlobalRange(unit: StoryArcDisplayUnit, unifiedEps: UnifiedEpisode[]): { globalStart: number | null; globalEnd: number | null } {
  if (unifiedEps.length === 0) return { globalStart: null, globalEnd: null };

  let globalStart: number | null = null;
  let globalEnd: number | null = null;

  for (const item of unit.items) {
    if (item.ep_start != null && globalStart == null) {
      const match = unifiedEps.find(ep => ep.mediaExternalId === item.media_external_id && (ep.generalEpNumber === item.ep_start || ep.seasonEpNumber === item.ep_start));
      if (match) globalStart = match.generalEpNumber;
    }
    if (item.ep_end != null) {
      const match = unifiedEps.find(ep => ep.mediaExternalId === item.media_external_id && (ep.generalEpNumber === item.ep_end || ep.seasonEpNumber === item.ep_end));
      if (match) globalEnd = match.generalEpNumber;
    }
  }
  return { globalStart, globalEnd };
}

// Clamps a global [start, end] onto each of the unit's works; works entirely
// outside the range are cleared. Both null clears the whole unit.
export function applyGlobalRangeToItems(
  items: StoryArcEditingItem[],
  unit: StoryArcDisplayUnit,
  unifiedEps: UnifiedEpisode[],
  startGen: number | null,
  endGen: number | null,
): StoryArcEditingItem[] {
  const unitIds = new Set(unit.items.map(i => i.media_external_id));
  if (startGen == null && endGen == null) {
    return items.map(i => unitIds.has(i.media_external_id) ? { ...i, ep_start: null, ep_end: null } : i);
  }

  const effectiveStart = startGen ?? unifiedEps[0].generalEpNumber;
  const effectiveEnd = endGen ?? startGen ?? unifiedEps[unifiedEps.length - 1].generalEpNumber;
  const minG = Math.min(effectiveStart, effectiveEnd);
  const maxG = Math.max(effectiveStart, effectiveEnd);

  return items.map(item => {
    if (!unitIds.has(item.media_external_id)) return item;
    const itemEps = unifiedEps.filter(ep => ep.mediaExternalId === item.media_external_id);
    if (itemEps.length === 0) return item;
    const itemMinG = itemEps[0].generalEpNumber;
    const itemMaxG = itemEps[itemEps.length - 1].generalEpNumber;

    if (maxG < itemMinG || minG > itemMaxG) return { ...item, ep_start: null, ep_end: null };

    return { ...item, ep_start: Math.max(minG, itemMinG), ep_end: Math.min(maxG, itemMaxG) };
  });
}

// Plain click sets the start (keeping an explicit end that still lies after
// it); Ctrl+click sets the end (pulling the start down if needed).
export function resolveEpisodeClickRange(
  clickedEp: number,
  globalStart: number | null,
  globalEnd: number | null,
  isCtrl: boolean,
): { start: number; end: number } {
  if (isCtrl) {
    const currentStart = globalStart ?? clickedEp;
    return { start: Math.min(currentStart, clickedEp), end: clickedEp };
  }
  const hasExplicitRange = globalStart != null && globalEnd != null && globalEnd > globalStart;
  const end = (hasExplicitRange && globalEnd != null && globalEnd >= clickedEp) ? globalEnd : clickedEp;
  return { start: clickedEp, end };
}

// Moves the unit at `from` to `to` (remove, then insert) and flattens back
// to the arc's item order.
export function reorderUnits(units: StoryArcDisplayUnit[], from: number, to: number): StoryArcDisplayUnit[] {
  const next = [...units];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

// Merges the dragged unit into the target's group (or the dragged one's, or
// a fresh id), ordered by the saga chain, in the target's slot. Null when
// the pair cannot be grouped.
export function groupUnits(
  units: StoryArcDisplayUnit[],
  from: number,
  to: number,
  sagaOrder: string[],
  newGroupId: () => string,
): StoryArcDisplayUnit[] | null {
  const draggedUnit = units[from];
  const targetUnit = units[to];
  if (from === to || !canGroupUnits(draggedUnit, targetUnit, sagaOrder)) return null;

  const sharedGroupId = targetUnit.groupId || draggedUnit.groupId || newGroupId();
  const mergedItems = sortBySagaOrder([...targetUnit.items, ...draggedUnit.items].map(i => ({ ...i, group_id: sharedGroupId })), sagaOrder);

  const next = units.filter((_, idx) => idx !== from && idx !== to);
  const insertAt = to > from ? to - 1 : to;
  next.splice(insertAt, 0, { id: sharedGroupId, isGroup: true, groupId: sharedGroupId, items: mergedItems });
  return next;
}

export const flattenUnits = (units: StoryArcDisplayUnit[]): StoryArcEditingItem[] => units.flatMap(u => u.items);
