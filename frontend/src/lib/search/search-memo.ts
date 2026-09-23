// In-memory memo for external search pages, shared by the /search page and
// the navbar quick-search overlay (both go through lib/search's search()):
// an exact query+type+page repeated within the TTL — retyping a query,
// "Ver todos" landing on a type the overlay already fetched, Back into the
// page — costs zero provider requests. Only exact keys hit; a page for
// "one pie" is never reused for "one piece".
//
// Two layers, both keyed the same way:
//   - settled values, LRU-evicted past `maxEntries` and expired past `ttlMs`;
//   - in-flight promises, so two callers asking for the same page at the
//     same moment (overlay + page, debounce + Enter) share one request. The
//     underlying request is only aborted once EVERY caller has aborted —
//     each caller still sees its own AbortError the moment its own signal
//     fires, so cancellation semantics are unchanged from a private fetch.
//
// Pure (no DOM, no IPC), with an injectable clock for tests.

export interface SearchMemoOptions {
  ttlMs: number;
  maxEntries: number;
  now?: () => number;
}

export const SEARCH_MEMO_TTL_MS = 10 * 60 * 1000;
export const SEARCH_MEMO_MAX_ENTRIES = 200;

interface Entry<T> { value: T; expiresAt: number }

interface InFlight<T> {
  promise: Promise<T>;
  controller: AbortController;
  subscribers: number;
}

function abortError(): DOMException {
  return new DOMException('Aborted', 'AbortError');
}

export class SearchMemo<T> {
  private readonly entries = new Map<string, Entry<T>>();
  private readonly inFlight = new Map<string, InFlight<T>>();

  constructor(private readonly opts: SearchMemoOptions) {}

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    // Re-insert so Map iteration order doubles as LRU order.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + this.opts.ttlMs });
    while (this.entries.size > this.opts.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  /** Whether a request for this key is currently running. */
  isInFlight(key: string): boolean {
    return this.inFlight.has(key);
  }

  /**
   * Memoised `run`: returns the settled value when fresh, joins a running
   * request for the same key, or starts one. Rejections are never memoised.
   */
  fetch(key: string, run: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(abortError());
    const cached = this.get(key);
    if (cached !== undefined) return Promise.resolve(cached);

    let flight = this.inFlight.get(key);
    if (!flight) {
      const controller = new AbortController();
      const started: InFlight<T> = { controller, subscribers: 0, promise: Promise.resolve() as unknown as Promise<T> };
      started.promise = run(controller.signal).then(
        value => {
          if (this.inFlight.get(key) === started) this.inFlight.delete(key);
          if (!controller.signal.aborted) this.set(key, value);
          return value;
        },
        err => {
          if (this.inFlight.get(key) === started) this.inFlight.delete(key);
          throw err;
        },
      );
      this.inFlight.set(key, started);
      flight = started;
    }
    return this.subscribe(flight, key, signal);
  }

  private subscribe(flight: InFlight<T>, key: string, signal?: AbortSignal): Promise<T> {
    flight.subscribers++;
    if (!signal) return flight.promise;

    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const onAbort = () => {
        if (settled) return;
        settled = true;
        flight.subscribers--;
        if (flight.subscribers <= 0) {
          flight.controller.abort();
          if (this.inFlight.get(key) === flight) this.inFlight.delete(key);
        }
        reject(abortError());
      };
      signal.addEventListener('abort', onAbort, { once: true });
      flight.promise.then(
        value => {
          if (settled) return;
          settled = true;
          signal.removeEventListener('abort', onAbort);
          resolve(value);
        },
        err => {
          if (settled) return;
          settled = true;
          signal.removeEventListener('abort', onAbort);
          reject(err);
        },
      );
    });
  }
}
