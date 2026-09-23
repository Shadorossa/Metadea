// Generic sessionStorage-backed TTL cache — the same get/set-with-expiry/
// try-catch pattern media-cache.ts already implements for MediaPageData
// (which also validates its own richer shape on read, so it stays separate),
// factored out here so other simple "cache this by id for N minutes" needs
// (see lib/anilist/friends.ts) don't hand-roll it again.

export function sessionCacheGet<T>(prefix: string, key: string | number): T | null {
  try {
    const raw = sessionStorage.getItem(`${prefix}${key}`);
    if (!raw) return null;
    const entry: { value: T; expiresAt: number } = JSON.parse(raw);
    if (entry.expiresAt <= Date.now()) {
      sessionStorage.removeItem(`${prefix}${key}`);
      return null;
    }
    return entry.value;
  } catch {
    return null;
  }
}

export function sessionCacheSet<T>(prefix: string, key: string | number, value: T, ttlMs: number): void {
  try {
    sessionStorage.setItem(`${prefix}${key}`, JSON.stringify({ value, expiresAt: Date.now() + ttlMs }));
  } catch {
    // sessionStorage full/unavailable — cache is a pure optimization, safe to skip
  }
}
