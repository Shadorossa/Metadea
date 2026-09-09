import React from 'react';
import { IconFolder } from '../ui/icons';
import type { NeighborInfo } from '../hooks/useMediaNeighbors';

// Bundle children (e.g. The Great Ace Attorney Chronicles' two episodes)
// label as "Part I"/"Part II" instead of their own full title — a bundle's
// own cover/title already names it, so re-printing e.g. "The Great Ace
// Attorney 2: Resolve" in full under a 64px thumbnail just wraps into an
// unreadable mess.
const ROMAN_NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
function toRoman(n: number): string {
  return ROMAN_NUMERALS[n - 1] ?? String(n);
}

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
    return (
      <div className="local-media-neighbors-row">
        <div className="local-media-neighbors-grid">
          {bundleChildren.map((child, i) => (
            <NeighborButton key={child.externalId} neighbor={child} label={`Part ${toRoman(i + 1)}`} onOpen={onOpen} />
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
