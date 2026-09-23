// Request hygiene for a search box, kept pure so it can be unit-tested
// without React: one AbortController per "current search" plus a sequence
// id, so a response from an older search can never overwrite a newer one —
// even when the newer one resolved instantly from the memo while the older
// request was still on the wire (the abort alone doesn't cover that
// ordering: an abort only helps when the older request is still pending
// at the moment the newer one starts).
//
// A "Load more" or an auto-chained page belongs to the current search: it
// reuses the current signal and sequence instead of cancelling anything.

export interface GuardedRequest {
  seq: number;
  signal: AbortSignal;
}

export class SearchRequestGuard {
  private seq = 0;
  private controller: AbortController | null = null;

  /** Starts a new search: cancels whatever was running and bumps the sequence. */
  begin(): GuardedRequest {
    this.controller?.abort();
    this.controller = new AbortController();
    this.seq++;
    return { seq: this.seq, signal: this.controller.signal };
  }

  /** A follow-up page of the current search — same sequence, same signal. */
  current(): GuardedRequest {
    if (!this.controller) this.controller = new AbortController();
    return { seq: this.seq, signal: this.controller.signal };
  }

  /** True while no newer search has begun since `seq` was issued. */
  isCurrent(seq: number): boolean {
    return seq === this.seq;
  }

  /** Cancels the current search without starting another (tab switch, unmount). */
  cancel(): void {
    this.controller?.abort();
    this.controller = null;
    this.seq++;
  }
}

// Trailing-edge debounce with an explicit cancel — the same shape
// components/shared/hooks/useDebouncedCallback wraps for React, exposed as
// a plain object so the timing contract (one call per quiet period of
// `delayMs`, nothing below `minChars`) is testable on its own.
export interface DebouncerTimers {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

const defaultTimers: DebouncerTimers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export const SEARCH_DEBOUNCE_MS = 300;

export class SearchDebouncer {
  private handle: unknown = null;

  constructor(
    private readonly run: (query: string) => void,
    private readonly delayMs: number = SEARCH_DEBOUNCE_MS,
    private readonly minChars = 2,
    private readonly timers: DebouncerTimers = defaultTimers,
  ) {}

  /** Schedules `run(query)` after the quiet period; a shorter query just cancels. */
  submit(query: string): void {
    this.cancel();
    if (query.trim().length < this.minChars) return;
    this.handle = this.timers.set(() => {
      this.handle = null;
      this.run(query);
    }, this.delayMs);
  }

  /** Fires immediately (Enter), dropping any pending debounced call. */
  flush(query: string): void {
    this.cancel();
    if (query.trim().length < this.minChars) return;
    this.run(query);
  }

  cancel(): void {
    if (this.handle !== null) {
      this.timers.clear(this.handle);
      this.handle = null;
    }
  }

  get isPending(): boolean {
    return this.handle !== null;
  }
}
