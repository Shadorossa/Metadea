import React from 'react';
import { IconFolder } from '../ui/icons';
import type { NeighborInfo } from '../hooks/useMediaNeighbors';
import { bundleChildLabel, hasBundleAddon } from '../../../lib/media/bundleLabels';

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
  if (bundleChildren && bundleChildren.length > 0) {
    // Generic "Juego"/"DLC"/"Expansión"-or-Part-N category here — the
    // media editor's version-tab strip (MediaEditorModal) is where each
    // child's own real name belongs instead, since that's the menu the
    // user actually picks a specific work to track from.
    const hasExpansion = hasBundleAddon(bundleChildren);
    return (
      <div className="local-media-neighbors-row">
        <div className="local-media-neighbors-grid">
          {bundleChildren.map((child, i) => (
            <NeighborButton key={child.externalId} neighbor={child} label={bundleChildLabel(child, i, hasExpansion)} onOpen={onOpen} />
          ))}
        </div>
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
