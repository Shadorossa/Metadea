// Drives the global bottom loading bar mounted once in BaseLayout.astro
// (#global-loading-bar). Ref-counted via window events (same pattern as the
// existing 'metadea:rate-limit-wait' global toast in BaseLayout.astro) so
// unrelated loads overlapping in time don't hide the bar prematurely.
//
// Usage: call beginGlobalLoading() when a fetch starts and the matching
// end() when it settles — always in a finally so a thrown/rejected fetch
// still releases its slot:
//
//   const end = beginGlobalLoading();
//   try { await doWork(); } finally { end(); }

const BEGIN_EVENT = 'metadea:loading-start';
const END_EVENT = 'metadea:loading-end';

export function beginGlobalLoading(): () => void {
  if (typeof window === 'undefined') return () => {};
  window.dispatchEvent(new CustomEvent(BEGIN_EVENT));
  let released = false;
  return () => {
    if (released) return;
    released = true;
    window.dispatchEvent(new CustomEvent(END_EVENT));
  };
}

/** Wraps a promise-returning call so it always begins/ends the bar, even on rejection. */
export async function withGlobalLoading<T>(work: () => Promise<T>): Promise<T> {
  const end = beginGlobalLoading();
  try {
    return await work();
  } finally {
    end();
  }
}
