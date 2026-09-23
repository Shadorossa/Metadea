// Home's local reads, in one round trip. CurrentlySection, CalendarSection
// and the release-notification checker all consume the same
// library/catalog/relations bundle the profile tabs cache
// (lib/profile/library-data-cache.ts); measured on a real library, filling
// that cache through its per-command chain took twelve sequential IPC
// round trips (library ∥ catalog, then one get_media_relations_for_ids per
// closure hop — nine of them — then the catalog rows those relations
// introduced, then get_saga_names). get_home_bundle (home_bundle.rs) runs
// the same walk under one connection lock and returns the same rows, so
// this primes the shared cache with it: a Home visit costs one invoke, and
// a Profile visit afterwards costs none.
import { getHomeBundle, type HomeBundle } from '../tauri/home-bundle';
import { getSagaNames } from '../tauri/catalog';
import { primeProfileData, type ProfileData } from '../profile/library-data-cache';
import { CHAIN_RELATION_TYPES, EXCLUDED_RELATION_TYPES, MAX_EXPANSION_HOPS } from '../profile/relations-scope';

/** The profile-cache shape of a bundle — exported for tests. */
export function profileDataFromBundle(bundle: HomeBundle): ProfileData {
  return { items: bundle.library, catalog: bundle.catalog, relations: bundle.relations };
}

// Saga names ride along in the bundle; kept keyed by the very ProfileData
// object the cache hands out, so they live exactly as long as that cached
// load does (a library write replaces the object, and with it the names).
const sagaNamesByData = new WeakMap<ProfileData, Record<string, string>>();

function fetchBundle(): Promise<ProfileData | null> {
  return getHomeBundle({
    chainTypes: [...CHAIN_RELATION_TYPES],
    excludeTypes: [...EXCLUDED_RELATION_TYPES],
    maxHops: MAX_EXPANSION_HOPS,
  }).then(bundle => {
    if (!bundle) return null;
    const data = profileDataFromBundle(bundle);
    sagaNamesByData.set(data, bundle.saga_names);
    return data;
  });
}

/** The cached library/catalog/relations bundle, primed through
 *  get_home_bundle when nothing is cached yet. Never rejects: a failed load
 *  yields the same empty fallbacks the per-command chain has. */
export function loadHomeData(): Promise<ProfileData> {
  return primeProfileData(fetchBundle);
}

/** Saga name per library id for `data` (the object loadHomeData resolved
 *  to): free when that load came from the bundle, one get_saga_names
 *  otherwise. Empty on failure, as before. */
export function loadHomeSagaNames(data: ProfileData): Promise<Record<string, string>> {
  const fromBundle = sagaNamesByData.get(data);
  if (fromBundle) return Promise.resolve(fromBundle);
  return getSagaNames(data.items.map(item => item.external_id)).catch(() => ({} as Record<string, string>));
}
