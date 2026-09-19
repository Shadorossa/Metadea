import React from 'react';
import { useVirtualLibraryGrid } from './hooks/useVirtualLibraryGrid';

interface VirtualLibraryGridProps<T> {
  entries: T[];
  getKey: (entry: T) => string;
  renderItem: (entry: T) => React.ReactNode;
  // Same reasoning as VirtualCardGrid's own threshold — most libraries/
  // sections are nowhere near large enough for virtualizing to pay for
  // itself, so they keep the plain CSS grid (and its stretchy minmax(300px,
  // 1fr) columns) untouched.
  minToVirtualize?: number;
}

// The profile library's equivalent of Local's VirtualCardGrid — same
// row-virtualization approach, but .library-grid's cards aren't a fixed
// size: they stretch to fill the row (minmax(300px, 1fr)) above 1080px and
// switch to a fixed 5-column cover-only poster grid below it (see
// useVirtualLibraryGrid's computeLayout), so this measures and replicates
// whichever of those two modes CSS would currently be using instead of
// assuming one fixed card size.
export function VirtualLibraryGrid<T>({ entries, getKey, renderItem, minToVirtualize = 48 }: VirtualLibraryGridProps<T>) {
  const shouldVirtualize = entries.length >= minToVirtualize;
  const getItemKey = (index: number) => getKey(entries[index]);
  const { containerRef, layout, virtualizer } = useVirtualLibraryGrid(entries.length, shouldVirtualize, getItemKey);

  if (!shouldVirtualize) {
    return (
      <div key="static" className="library-grid" style={{ height: 'auto' }}>
        {entries.map(entry => <React.Fragment key={getKey(entry)}>{renderItem(entry)}</React.Fragment>)}
      </div>
    );
  }

  return (
    <div
      key="virtual"
      // directDomUpdates (see useVirtualLibraryGrid) writes this container's
      // own height directly through virtualizer.containerRef instead of a
      // style prop React would have to reconcile — containerRef (ours, for
      // the ResizeObserver that figures out `layout`) still needs to see the
      // same node too, so both refs run off this one callback.
      ref={node => { containerRef.current = node; virtualizer.containerRef(node); }}
      className="library-grid library-grid--virtual"
    >
      {virtualizer.getVirtualItems().map(vItem => {
        const entry = entries[vItem.index];
        return (
          <div
            key={vItem.key}
            ref={virtualizer.measureElement}
            data-index={vItem.index}
            style={{
              // top (not transform) deliberately — LibraryCard's hover
              // flyout (.library-card-stack-extra) escapes its own cell via
              // z-index to render over neighboring cards, and `transform`
              // on this wrapper would create a stacking context that traps
              // that z-index inside it, capping the flyout at this row
              // instead of letting it actually rise above the next one (see
              // useVirtualLibraryGrid's directDomUpdatesMode: 'position').
              // No `top` value set here either, though — directDomUpdates
              // writes it straight to this node once measureElement above
              // registers it, instead of React reconciling it every frame.
              position: 'absolute',
              left: vItem.lane * (layout.cardWidth + layout.gap),
              width: layout.cardWidth,
            }}
          >
            {renderItem(entry)}
          </div>
        );
      })}
    </div>
  );
}
