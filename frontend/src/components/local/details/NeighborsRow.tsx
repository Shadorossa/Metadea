import React, { useState } from 'react';
import { IconFolder, IconChevronLeft, IconChevronRight } from '../ui/icons';
import type { NeighborInfo } from '../hooks/useMediaNeighbors';
import { bundleChildLabel, hasBundleAddon } from '../../../lib/media/bundleLabels';

// Beyond this many, the row would overflow its own layout (an 8-part bundle
// like Umineko's episodes) — paged 3-at-a-time with arrows instead of
// shrinking every cover down to fit them all at once.
const PARTS_PER_PAGE = 3;

function NeighborButton({ neighbor, label, onOpen }: { neighbor: NeighborInfo; label: string; onOpen: (externalId: string) => void }) {
  return (
    <button type="button" className="local-media-neighbor-link" title={neighbor.title} onClick={() => onOpen(neighbor.externalId)}>
      {neighbor.cover
        ? <img className="local-media-neighbor-cover" src={neighbor.cover} alt={neighbor.title} />
        : <div className="local-media-neighbor-cover local-media-neighbor-cover--fallback"><IconFolder size={20} strokeWidth={2} /></div>}
      <span className="local-media-neighbor-label">{label}</span>
    </button>
  );
}

interface NeighborsRowProps {
  prequel?:        NeighborInfo | null;
  sequel?:         NeighborInfo | null;
  bundleChildren?: NeighborInfo[];
  onOpen:          (externalId: string) => void;
}

// Shared "what comes before/after this" (or, for a bundle, "what's inside
// it") row — GameDetailPanel and LocalMediaDetailPanel used to hand-roll the
// identical .local-media-neighbors-row/.local-media-neighbors-grid markup
// twice (see useMediaNeighbors for the resolution logic feeding this).
// Renders nothing when there's no prequel/sequel/bundle to show — callers
// still need to check that themselves for their own has-neighbors layout
// class (see each panel's local-media-info-row).
export function NeighborsRow({ prequel, sequel, bundleChildren, onOpen }: NeighborsRowProps) {
  // Reset to page 0 whenever the underlying bundle changes (a different
  // work opened) — a stale page from a previous, longer bundle would
  // otherwise render out of range instead of just clamping back below.
  const [page, setPage] = useState(0);
  const bundleKey = bundleChildren?.map(c => c.externalId).join(',') ?? '';
  const [lastBundleKey, setLastBundleKey] = useState(bundleKey);
  if (bundleKey !== lastBundleKey) {
    setLastBundleKey(bundleKey);
    setPage(0);
  }

  if (bundleChildren && bundleChildren.length > 0) {
    // Generic "Juego"/"DLC"/"Expansión"-or-Part-N category here — the
    // media editor's version-tab strip (MediaEditorModal) is where each
    // child's own real name belongs instead, since that's the menu the
    // user actually picks a specific work to track from.
    const hasExpansion = hasBundleAddon(bundleChildren);
    const totalPages = Math.ceil(bundleChildren.length / PARTS_PER_PAGE);
    const clampedPage = Math.min(page, totalPages - 1);
    const start = clampedPage * PARTS_PER_PAGE;
    const visible = bundleChildren.slice(start, start + PARTS_PER_PAGE);
    return (
      <div className="local-media-neighbors-row">
        {totalPages > 1 && (
          <button
            type="button"
            className="local-media-neighbors-arrow"
            disabled={clampedPage === 0}
            onClick={() => setPage(clampedPage - 1)}
            aria-label="Partes anteriores"
          >
            <IconChevronLeft size={16} strokeWidth={2} />
          </button>
        )}
        <div className="local-media-neighbors-grid">
          {visible.map((child, i) => (
            <NeighborButton key={child.externalId} neighbor={child} label={bundleChildLabel(child, start + i, hasExpansion)} onOpen={onOpen} />
          ))}
        </div>
        {totalPages > 1 && (
          <button
            type="button"
            className="local-media-neighbors-arrow"
            disabled={clampedPage === totalPages - 1}
            onClick={() => setPage(clampedPage + 1)}
            aria-label="Siguientes partes"
          >
            <IconChevronRight size={16} strokeWidth={2} />
          </button>
        )}
      </div>
    );
  }
  if (!prequel && !sequel) return null;
  return (
    <div className="local-media-neighbors-row">
      <div className="local-media-neighbors-grid">
        {prequel && <NeighborButton neighbor={prequel} label="Precuela" onOpen={onOpen} />}
        {sequel && <NeighborButton neighbor={sequel} label="Secuela" onOpen={onOpen} />}
      </div>
    </div>
  );
}
