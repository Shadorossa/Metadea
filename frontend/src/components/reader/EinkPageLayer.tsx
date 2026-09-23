import { useState } from 'react';

// The page-side pieces of E-Ink mode that live in the light DOM: the inline
// filter definition the pages' `filter: var(--eink-filter)` points at, and
// the refresh flash. (The EPUB reader also mirrors the filter into its
// shadow root, where the book's images are — see useEpubLayout.)

/** Inline `<defs>` holding the page filter. The markup is built only from
 *  numbers by lib/reader/eink-mode.ts (serializeEinkFilter). */
export function EinkFilterDefs({ markup }: { markup: string }) {
  return (
    <svg className="eink-filter-defs" width={0} height={0} aria-hidden="true" focusable="false">
      <defs dangerouslySetInnerHTML={{ __html: markup }} />
    </svg>
  );
}

/** A brief inverted flash on every page turn, like an e-ink panel's full
 *  refresh. Pure CSS (one animation per mounted element, re-keyed on each
 *  turn); `prefers-reduced-motion` hides it in reader-eink.css. The key it
 *  first mounts with (the page the reader opens on) does not flash. */
export function EinkRefreshFlash({ turnKey, active }: { turnKey: string; active: boolean }) {
  const [openingKey] = useState(turnKey);
  if (!active || turnKey === openingKey) return null;
  return <div key={turnKey} className="eink-refresh-flash" aria-hidden="true" />;
}
