import React, { useEffect, useRef, useState } from 'react';
import { steamGetScreenshots, wrapAssetUrl, type SteamAchievement } from '../../../lib/tauri';
import { getT } from '../../../i18n/client';
import { AchievementCell } from './AchievementCell';

const SCREENSHOT_ROWS_PER_PAGE = 3;
const ACHIEVEMENT_ROWS_PER_PAGE = 3;

interface SteamMediaSectionProps {
  appId: string;
  achievements: { unlocked: number; total: number; list: SteamAchievement[] } | null;
  achievementsLoading: boolean;
}

export function SteamMediaSection({ appId, achievements, achievementsLoading }: SteamMediaSectionProps) {
  const t = getT();
  const [activeTab, setActiveTab] = useState<'screenshots' | 'achievements'>('screenshots');
  const [screenshots, setScreenshots] = useState<Awaited<ReturnType<typeof steamGetScreenshots>>>([]);
  const screenshotsGridRef = useRef<HTMLDivElement>(null);
  const achievementsGridRef = useRef<HTMLDivElement>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [screenshotsPage, setScreenshotsPage] = useState(0);
  const [screenshotColumns, setScreenshotColumns] = useState(3);
  const [achievementsPage, setAchievementsPage] = useState(0);
  const [achievementColumns, setAchievementColumns] = useState(6);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setScreenshots([]);
    setPreviewIndex(null);
    setScreenshotsPage(0);
    setAchievementsPage(0);
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

  useEffect(() => {
    if (activeTab !== 'screenshots' || screenshots.length === 0) return;
    const grid = screenshotsGridRef.current;
    if (!grid) return;

    const updateColumnCount = () => {
      const template = window.getComputedStyle(grid).gridTemplateColumns;
      const columns = template === 'none' ? 3 : template.trim().split(/\s+/).filter(Boolean).length;
      if (columns > 0) setScreenshotColumns(columns);
    };

    updateColumnCount();
    const observer = new ResizeObserver(updateColumnCount);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [activeTab, screenshots.length]);

  useEffect(() => {
    if (activeTab !== 'achievements' || !achievements?.list.length) return;
    const grid = achievementsGridRef.current;
    if (!grid) return;

    const updateColumnCount = () => {
      const template = window.getComputedStyle(grid).gridTemplateColumns;
      const columns = template === 'none' ? 6 : template.trim().split(/\s+/).filter(Boolean).length;
      if (columns > 0) setAchievementColumns(columns);
    };

    updateColumnCount();
    const observer = new ResizeObserver(updateColumnCount);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [activeTab, achievements?.list.length]);

  const screenshotsPerPage = screenshotColumns * SCREENSHOT_ROWS_PER_PAGE;
  const screenshotPageCount = Math.max(1, Math.ceil(screenshots.length / screenshotsPerPage));
  const visibleScreenshotsPage = Math.min(screenshotsPage, screenshotPageCount - 1);
  const achievementList = achievements?.list ?? [];
  const achievementsPerPage = achievementColumns * ACHIEVEMENT_ROWS_PER_PAGE;
  const achievementPageCount = Math.max(1, Math.ceil(achievementList.length / achievementsPerPage));
  const visibleAchievementsPage = Math.min(achievementsPage, achievementPageCount - 1);
  const visibleScreenshots = screenshots.slice(visibleScreenshotsPage * screenshotsPerPage, (visibleScreenshotsPage + 1) * screenshotsPerPage);
  const visibleAchievements = achievementList.slice(visibleAchievementsPage * achievementsPerPage, (visibleAchievementsPage + 1) * achievementsPerPage);
  const shownScreenshot = previewIndex === null ? null : screenshots[previewIndex];
  const pageLabel = (page: number, total: number) => t.character.pagination_page
    .replace('{page}', String(page + 1))
    .replace('{total}', String(total));

  const pagination = (page: number, pageCount: number, setPage: (page: number) => void) => pageCount > 1 && (
    <div className="local-steam-media-pagination">
      <button type="button" className="local-steam-media-page-btn" disabled={page === 0} onClick={() => setPage(page - 1)}>
        {t.character.pagination_prev}
      </button>
      <span aria-live="polite">{pageLabel(page, pageCount)}</span>
      <button type="button" className="local-steam-media-page-btn" disabled={page + 1 >= pageCount} onClick={() => setPage(page + 1)}>
        {t.character.pagination_next}
      </button>
    </div>
  );

  return (
    <section className="local-steam-media">
      <div className="local-steam-media-tabs" role="group" aria-label={`${t.local.steam_screenshots} / ${t.local.stat_achievements}`}>
        <button
          type="button"
          className={`local-steam-media-tab${activeTab === 'screenshots' ? ' active' : ''}`}
          aria-pressed={activeTab === 'screenshots'}
          onClick={() => { setActiveTab('screenshots'); setPreviewIndex(null); }}
        >
          <span>{t.local.steam_screenshots}</span>
          <span className="local-steam-media-count">{loading ? '…' : screenshots.length}</span>
        </button>
        <button
          type="button"
          className={`local-steam-media-tab${activeTab === 'achievements' ? ' active' : ''}`}
          aria-pressed={activeTab === 'achievements'}
          onClick={() => { setActiveTab('achievements'); setPreviewIndex(null); }}
        >
          <span>{t.local.stat_achievements}</span>
          <span className="local-steam-media-count">
            {achievementsLoading ? '…' : achievements ? `${achievements.unlocked}/${achievements.total}` : '0'}
          </span>
        </button>
      </div>

      {activeTab === 'screenshots' ? (
        <div className="local-steam-media-panel" role="tabpanel">
          {screenshots.length > 0 ? (
            <>
              <div className="local-steam-screenshots-grid" ref={screenshotsGridRef}>
                {visibleScreenshots.map((screenshot, index) => {
                  const absoluteIndex = visibleScreenshotsPage * screenshotsPerPage + index;
                  return (
                    <button
                      key={screenshot.path}
                      type="button"
                      className="local-steam-screenshot-thumb"
                      onClick={() => setPreviewIndex(absoluteIndex)}
                      aria-label={`${t.local.steam_screenshots} ${absoluteIndex + 1}`}
                    >
                      <img
                        src={wrapAssetUrl(screenshot.thumbnail_path)}
                        alt={`${t.local.steam_screenshots} ${absoluteIndex + 1}`}
                        loading="lazy"
                        decoding="async"
                      />
                    </button>
                  );
                })}
              </div>
              {pagination(visibleScreenshotsPage, screenshotPageCount, setScreenshotsPage)}
            </>
          ) : (
            <p className="local-steam-screenshots-empty">
              {loading ? t.local.steam_screenshots_loading : failed ? t.local.steam_screenshots_error : t.local.steam_screenshots_empty}
            </p>
          )}
        </div>
      ) : (
        <div className="local-steam-media-panel" role="tabpanel">
          {achievementsLoading ? (
            <p className="local-steam-screenshots-empty">{t.local.steam_achievements_loading}</p>
          ) : achievementList.length > 0 ? (
            <>
              <div className="local-game-detail-achievement-grid" ref={achievementsGridRef}>
                {visibleAchievements.map(achievement => (
                  <AchievementCell key={achievement.apiname} ach={achievement} appId={appId} />
                ))}
              </div>
              {pagination(visibleAchievementsPage, achievementPageCount, setAchievementsPage)}
            </>
          ) : (
            <p className="local-steam-screenshots-empty">{t.local.steam_achievements_empty}</p>
          )}
        </div>
      )}

      {shownScreenshot && activeTab === 'screenshots' && (
        <div className="local-steam-screenshot-viewer" role="presentation" onClick={() => setPreviewIndex(null)}>
          <div
            className="local-steam-screenshot-viewer-content"
            role="dialog"
            aria-modal="true"
            aria-label={t.local.steam_screenshots}
            onClick={event => event.stopPropagation()}
          >
            <button type="button" className="local-steam-screenshot-close" onClick={() => setPreviewIndex(null)} aria-label={t.local.close_panel}>×</button>
            <button
              type="button"
              className="local-steam-screenshot-nav local-steam-screenshot-prev"
              onClick={() => setPreviewIndex((previewIndex! + screenshots.length - 1) % screenshots.length)}
              aria-label={t.character.pagination_prev}
            >‹</button>
            <img className="local-steam-screenshot-full" src={wrapAssetUrl(shownScreenshot.path)} alt={`${t.local.steam_screenshots} ${previewIndex! + 1}`} />
            <button
              type="button"
              className="local-steam-screenshot-nav local-steam-screenshot-next"
              onClick={() => setPreviewIndex((previewIndex! + 1) % screenshots.length)}
              aria-label={t.character.pagination_next}
            >›</button>
            <span className="local-steam-screenshot-counter">{previewIndex! + 1} / {screenshots.length}</span>
          </div>
        </div>
      )}
    </section>
  );
}
