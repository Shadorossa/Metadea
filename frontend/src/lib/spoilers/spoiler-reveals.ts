// What the user chose to see despite the shield.
//
// - A single item ("Spoiler · Reveal" on one episode, arc, stat line...) is
//   remembered for the session only: sessionStorage, so it survives page
//   navigation but not an app restart.
// - A whole franchise ("I don't care about spoilers for this saga") is
//   remembered for good: localStorage, as the franchise's member ids. Any
//   member matching counts, so a season added to the chain later is still
//   covered by an earlier reveal.
//
// Why localStorage and not a SQLite `spoiler_reveals` table: this is a
// device-level display preference exactly like every other toggle on the
// Preferences tab (which all live in localStorage), it is read synchronously
// while rendering, and it needs no Rust command, ACL entry or migration for a
// handful of ids. Losing it (a wiped webview) only means the shield comes
// back, never lost user data.
import { STORAGE_KEYS } from '../storage/storage-keys';
import { createExternalStore, type ExternalStore } from '../shared/state/external-store';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

// Upper bounds so a long-lived storage entry can't grow without limit.
const MAX_SESSION_ITEMS = 2000;
const MAX_FRANCHISE_IDS = 5000;

function readIdList(storage: StorageLike | null, key: string): string[] {
  if (!storage) return [];
  try {
    const parsed: unknown = JSON.parse(storage.getItem(key) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
  } catch {
    return [];
  }
}

function writeIdList(storage: StorageLike | null, key: string, ids: readonly string[], max: number): void {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(ids.slice(-max)));
  } catch {
    // Quota or a blocked storage: the reveal still holds for this page.
  }
}

export interface SpoilerRevealState {
  items: ReadonlySet<string>;
  franchiseIds: ReadonlySet<string>;
}

export interface SpoilerReveals {
  store: ExternalStore<SpoilerRevealState>;
  isItemRevealed: (key: string) => boolean;
  revealItem: (key: string) => void;
  /** True when any of `memberIds` was part of a franchise the user revealed. */
  isFranchiseRevealed: (memberIds: Iterable<string>) => boolean;
  revealFranchise: (memberIds: Iterable<string>) => void;
}

export function createSpoilerReveals(session: StorageLike | null, local: StorageLike | null): SpoilerReveals {
  const store = createExternalStore<SpoilerRevealState>({
    items: new Set(readIdList(session, STORAGE_KEYS.spoilerSessionReveals)),
    franchiseIds: new Set(readIdList(local, STORAGE_KEYS.spoilerFranchiseReveals)),
  });

  return {
    store,
    isItemRevealed: key => store.get().items.has(key),
    revealItem: key => {
      const current = store.get();
      if (current.items.has(key)) return;
      const items = new Set(current.items).add(key);
      writeIdList(session, STORAGE_KEYS.spoilerSessionReveals, [...items], MAX_SESSION_ITEMS);
      store.set({ ...current, items });
    },
    isFranchiseRevealed: memberIds => {
      const revealed = store.get().franchiseIds;
      for (const id of memberIds) if (revealed.has(id)) return true;
      return false;
    },
    revealFranchise: memberIds => {
      const current = store.get();
      const franchiseIds = new Set(current.franchiseIds);
      for (const id of memberIds) franchiseIds.add(id);
      if (franchiseIds.size === current.franchiseIds.size) return;
      writeIdList(local, STORAGE_KEYS.spoilerFranchiseReveals, [...franchiseIds], MAX_FRANCHISE_IDS);
      store.set({ ...current, franchiseIds });
    },
  };
}

function browserStorage(kind: 'session' | 'local'): StorageLike | null {
  try {
    if (kind === 'session') return typeof sessionStorage === 'undefined' ? null : sessionStorage;
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

let singleton: SpoilerReveals | null = null;

/** The app-wide instance (module state, shared by every island on the page). */
export function getSpoilerReveals(): SpoilerReveals {
  if (!singleton) singleton = createSpoilerReveals(browserStorage('session'), browserStorage('local'));
  return singleton;
}

// Stable keys for single-item reveals, one family per kind of hidden thing.
export const spoilerItemKey = {
  synopsis: (workId: string) => `synopsis:${workId}`,
  cover: (workId: string) => `cover:${workId}`,
  episode: (workId: string, episodeNumber: number) => `episode:${workId}:${episodeNumber}`,
  arc: (arcId: string) => `arc:${arcId}`,
  castMember: (workId: string, characterId: string) => `cast:${workId}:${characterId}`,
  /** Everything the shield hides on one character page. */
  characterPage: (characterId: string) => `character:${characterId}`,
  characterStat: (characterId: string, label: string) => `character-stat:${characterId}:${label}`,
  characterImage: (characterId: string) => `character-image:${characterId}`,
  characterBiography: (characterId: string) => `character-bio:${characterId}`,
  continueEpisode: (workId: string, episodeNumber: number) => `continue:${workId}:${episodeNumber}`,
} as const;
