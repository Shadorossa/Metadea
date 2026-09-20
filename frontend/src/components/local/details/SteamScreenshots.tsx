import React, { useEffect, useState } from 'react';
import { steamGetScreenshots, wrapAssetUrl } from '../../../lib/tauri';
import { getT } from '../../../i18n/client';

interface SteamScreenshotsProps {
  appId: string;
}

export function SteamScreenshots({ appId }: SteamScreenshotsProps) {
  const t = getT();
  const [screenshots, setScreenshots] = useState<string[]>([]);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setScreenshots([]);
    setPreviewIndex(null);
    setLoading(true);
    setFailed(false);
    steamGetScreenshots(appId)
      .then(paths => { if (!cancelled) setScreenshots(paths); })
      .catch(error => {
        console.error('[Steam screenshots] Failed to load local captures:', error);
        if (!cancelled) setFailed(true);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [appId]);

  const closePreview = () => setPreviewIndex(null);
  const shownScreenshot = previewIndex === null ? null : screenshots[previewIndex];

  return (
    <section className="local-steam-screenshots">
      <h3 className="local-steam-screenshots-title">
        <span>{t.local.steam_screenshots}</span>
        {screenshots.length > 0 && <span className="local-steam-screenshots-count">{screenshots.length}</span>}
      </h3>
      {screenshots.length > 0 ? (
        <div className="local-steam-screenshots-grid">
          {screenshots.map((path, index) => (
            <button
              key={path}
              type="button"
              className="local-steam-screenshot-thumb"
              onClick={() => setPreviewIndex(index)}
              aria-label={`${t.local.steam_screenshots} ${index + 1}`}
            >
              <img src={wrapAssetUrl(path)} alt={`${t.local.steam_screenshots} ${index + 1}`} loading="lazy" />
            </button>
          ))}
        </div>
      ) : (
        <p className="local-steam-screenshots-empty">
          {loading ? t.local.steam_screenshots_loading : failed ? t.local.steam_screenshots_error : t.local.steam_screenshots_empty}
        </p>
      )}

      {shownScreenshot && (
        <div className="local-steam-screenshot-viewer" role="presentation" onClick={closePreview}>
          <div
            className="local-steam-screenshot-viewer-content"
            role="dialog"
            aria-modal="true"
            aria-label={t.local.steam_screenshots}
            onClick={event => event.stopPropagation()}
          >
            <button type="button" className="local-steam-screenshot-close" onClick={closePreview} aria-label={t.local.close_panel}>×</button>
            <button
              type="button"
              className="local-steam-screenshot-nav local-steam-screenshot-prev"
              onClick={() => setPreviewIndex((previewIndex! + screenshots.length - 1) % screenshots.length)}
              aria-label={t.local.pagination_prev}
            >‹</button>
            <img className="local-steam-screenshot-full" src={wrapAssetUrl(shownScreenshot)} alt={`${t.local.steam_screenshots} ${previewIndex! + 1}`} />
            <button
              type="button"
              className="local-steam-screenshot-nav local-steam-screenshot-next"
              onClick={() => setPreviewIndex((previewIndex! + 1) % screenshots.length)}
              aria-label={t.local.pagination_next}
            >›</button>
            <span className="local-steam-screenshot-counter">{previewIndex! + 1} / {screenshots.length}</span>
          </div>
        </div>
      )}
    </section>
  );
}
