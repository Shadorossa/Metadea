// The cover other people see — Discord Rich Presence and share-link
// previews — is always the work's main catalog cover, never the user's own
// pick (Settings/editor "custom cover", cover-preferences.ts). Catalog reads
// substitute the user's pick into cover_url, so when a work has one the
// original is read back from the raw catalog row (once, then cached).
import { getCoverPreference } from './cover-preferences';

export type RawCoverLoader = (externalId: string) => Promise<string | null>;

export interface PublicCoverResolver {
  /** The public cover for `externalId` right now: `current` when the user
   *  has no custom cover for it, the cached main cover when known, else
   *  null while it loads (onResolved then fires). */
  resolve: (externalId: string | undefined, current: string | undefined) => string | null;
}

export function createPublicCoverResolver(deps: {
  loadRaw: RawCoverLoader;
  hasCustomCover?: (externalId: string) => boolean;
  onResolved?: () => void;
}): PublicCoverResolver {
  const hasCustom = deps.hasCustomCover ?? (id => !!getCoverPreference(id));
  const known = new Map<string, string | null>();
  const loading = new Set<string>();
  return {
    resolve(externalId, current) {
      if (!externalId || !hasCustom(externalId)) return current ?? null;
      if (known.has(externalId)) return known.get(externalId) ?? null;
      if (!loading.has(externalId)) {
        loading.add(externalId);
        deps.loadRaw(externalId)
          .catch(() => null)
          .then(url => {
            loading.delete(externalId);
            known.set(externalId, url && /^https:\/\//.test(url) ? url : null);
            deps.onResolved?.();
          });
      }
      return null;
    },
  };
}
