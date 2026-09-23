import { useState } from 'react';
import type { MediaTheme } from '../../../lib/tauri/themes';
import { ThemePreviewCardVideo } from '../ThemePreviewCardVideo';

export function PrEditorThemeCard({ theme, fallbackUrl }: { theme: MediaTheme; fallbackUrl?: string }) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      className="media-relation-card media-relation-card--static media-theme-card"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="media-relation-bg-layer media-theme-bg-layer">
        <ThemePreviewCardVideo
          externalId={theme.external_id}
          slug={theme.slug}
          src={theme.video_url ?? undefined}
          initialPreviewUrl={theme.preview_url ?? undefined}
          fallbackUrl={fallbackUrl}
          isHovered={isHovered}
        />
      </div>
      <div className="media-relation-card-overlay" />
      <span className={`media-relation-type media-theme-badge media-theme-badge--${theme.theme_type.toLowerCase()}`}>
        {theme.theme_type}{theme.sequence}
      </span>
      <div className="media-relation-card-content">
        <div className="media-relation-info">
          <span className="media-relation-title">{theme.song_title ?? `${theme.theme_type}${theme.sequence}`}</span>
          {theme.artists && <span className="media-theme-artist">{theme.artists}</span>}
        </div>
      </div>
    </div>
  );
}
