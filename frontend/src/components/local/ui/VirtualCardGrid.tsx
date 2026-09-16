import React from 'react';
import { useVirtualCardGrid, CARD_WIDTH, CARD_GAP } from '../hooks/useVirtualCardGrid';

interface VirtualCardGridProps<T> {
  entries: T[];
  getKey: (entry: T) => string | number;
  renderItem: (entry: T) => React.ReactNode;
  // Below this many cards there's nothing worth virtualizing — the whole
  // point is skipping DOM work for entries that aren't on screen, which
  // doesn't apply to a section that's a screen or less tall anyway. Most
  // sections stay under this and just render the plain CSS grid below,
  // unchanged from before this component existed.
  minToVirtualize?: number;
}

// A drop-in replacement for a plain `<div className="local-games-grid">`
// list of cards — same fixed 120px/1rem-gap layout, but past minToVirtualize
// entries it only actually mounts the rows near the viewport (see
// useVirtualCardGrid) instead of every card in the section at once. GamesGrid
// and LocalMediaSection both had their own identical `.local-games-grid`
// list; this is the shared version that adds virtualization to both without
// either needing to touch the DOM-heavy-library case itself.
export function VirtualCardGrid<T>({ entries, getKey, renderItem, minToVirtualize = 48 }: VirtualCardGridProps<T>) {
  const shouldVirtualize = entries.length >= minToVirtualize;
  const getItemKey = (index: number) => getKey(entries[index]);
  const { containerRef, virtualizer } = useVirtualCardGrid(entries.length, shouldVirtualize, getItemKey);

  if (!shouldVirtualize) {
    return (
      <div className="local-games-grid">
        {entries.map(entry => <React.Fragment key={getKey(entry)}>{renderItem(entry)}</React.Fragment>)}
      </div>
    );
  }

  return (
    <div
      // directDomUpdates (see useVirtualCardGrid) writes this container's own
      // height directly through virtualizer.containerRef instead of a style
      // prop React would have to reconcile — containerRef (ours, for the
      // ResizeObserver that figures out `columns`) still needs to see the
      // same node too, so both refs run off this one callback.
      ref={node => { containerRef.current = node; virtualizer.containerRef(node); }}
      className="local-games-grid local-games-grid--virtual"
    >
      {virtualizer.getVirtualItems().map(vItem => {
        const entry = entries[vItem.index];
        return (
          <div
            key={vItem.key}
            ref={virtualizer.measureElement}
            data-index={vItem.index}
            // No `transform` here — directDomUpdates writes each row's
            // vertical offset straight to this node's style once it's
            // registered via measureElement above, instead of React
            // reconciling it on every scroll frame for every visible card.
            style={{
              position: 'absolute',
              top: 0,
              left: vItem.lane * (CARD_WIDTH + CARD_GAP),
              width: CARD_WIDTH,
            }}
          >
            {renderItem(entry)}
          </div>
        );
      })}
    </div>
  );
}
