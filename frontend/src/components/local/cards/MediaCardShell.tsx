import React from 'react';

interface MediaCardShellProps {
  title:   string;
  // Resolved src, or null to show the placeholder icon instead — callers
  // own how (or whether) they resolve a cover; this only renders the result.
  cover:   string | null;
  placeholderIcon: React.ReactNode;
  // Videojuegos' own status badge (LocalMediaCard only) — GameCard has none.
  badge?:  React.ReactNode;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  // GameCard's cover is already known synchronously from coverCache (no
  // deferred fetch), so its <img> can use native lazy-loading. LocalMediaCard
  // defers src itself instead (see its own effect) — stacking native lazy
  // loading on top of an already-deferred src used to make the WebView
  // (Chromium/WebView2) sometimes never repaint the image at all after an F5
  // reload, until something else forced a reflow.
  lazyImage?: boolean;
}

// Shared shell for every "cover + placeholder-on-missing + title" card in
// Local — GameCard (Steam/GOG-scanned games) and LocalMediaCard (catalog
// "pendiente"/"en progreso" entries) used to hand-roll the identical
// .local-game-card/.local-game-cover/.local-game-name structure twice,
// diverging only in how each resolves its own cover and whether a status
// badge is shown. This is the one shared version; cover resolution and
// click/selection behavior still live entirely in each caller.
export const MediaCardShell = React.forwardRef<HTMLDivElement, MediaCardShellProps>(
  function MediaCardShell({ title, cover, placeholderIcon, badge, onClick, onContextMenu, lazyImage }, ref) {
    return (
      <div
        ref={ref}
        className="local-game-card"
        onClick={onClick}
        onContextMenu={onContextMenu}
        role="button"
        tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && onClick()}
      >
        <div className="local-game-cover">
          {cover
            ? (
              <img
                src={cover}
                alt={title}
                loading={lazyImage ? 'lazy' : undefined}
                decoding="async"
                onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            )
            : <div className="local-game-cover-placeholder">{placeholderIcon}</div>}
          {badge}
        </div>
        <p className="local-game-name">{title}</p>
      </div>
    );
  },
);
