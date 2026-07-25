// Running counter of every outgoing search-provider request (AniList, TMDB,
// Open Library, Comic Vine, IGDB) this session makes, printed to the
// devtools console on each call — the actual count is otherwise invisible
// short of eyeballing the Network tab, which doesn't help answer "did that
// one search really only fire the one request I expected?".
let requestCount = 0;

export function logSearchRequest(url: string): void {
  requestCount++;
  let host = url;
  try { host = new URL(url).hostname; } catch {}
  console.log(`[Search API] Request #${requestCount}: ${host}`);
}
