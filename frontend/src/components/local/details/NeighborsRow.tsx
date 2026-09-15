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

// "Part I"/"Part II" only reads right for an actually-episodic bundle —
// once one of the children is an add-on (Final Fantasy VII Remake
// Intergrade bundling the base game with its INTERmission DLC), the same
// numbering just reads as an arbitrary order instead of naming what each
// piece actually is. Falls back to the Part-numbering scheme unless at
// least one child's own format says it's an add-on, so a real episodic
// bundle (no such format present) is untouched.
const EXPANSION_FORMATS: Record<string, string> = { DLC: 'DLC', EXPANSION: 'Expansión' };

function bundleChildLabel(child: NeighborInfo, index: number, hasExpansion: boolean): string {
  if (!hasExpansion) return `Part ${toRoman(index + 1)}`;
  return (child.format && EXPANSION_FORMATS[child.format]) || 'Juego';
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
    const hasExpansion = bundleChildren.some(c => c.format && EXPANSION_FORMATS[c.format]);
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
