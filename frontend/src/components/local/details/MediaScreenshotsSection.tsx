import React, { useEffect, useRef, useState } from 'react';
import { getLocalScreenshots, steamGetScreenshots, wrapAssetUrl, type LocalScreenshot, type SteamAchievement } from '../../../lib/tauri';
import { getT } from '../../../i18n/client';
import { AchievementCell } from './AchievementCell';

const SCREENSHOT_ROWS_PER_PAGE = 3;
const ACHIEVEMENT_ROWS_PER_PAGE = 3;

interface MediaScreenshotsSectionProps {
  appId?: string;
  workName: string;
  achievements: { unlocked: number; total: number; list: SteamAchievement[] } | null;
  achievementsLoading: boolean;
}

export function MediaScreenshotsSection({ appId, workName, achievements, achievementsLoading }: MediaScreenshotsSectionProps) {
  const t = getT();
  const [activeTab, setActiveTab] = useState<'screenshots' | 'achievements'>('screenshots');
  const [screenshots, setScreenshots] = useState<LocalScreenshot[]>([]);
  const screenshotsGridRef = useRef<HTMLDivElement>(null);
  const achievementsGridRef = useRef<HTMLDivElement>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [screenshotEpisodeFilter, setScreenshotEpisodeFilter] = useState('all');
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
    setScreenshotEpisodeFilter('all');
    setScreenshotsPage(0);
    setAchievementsPage(0);
    setActiveTab('screenshots');
    setLoading(true);
    setFailed(false);

    const loadScreenshots = async (showLoading: boolean) => {
      if (showLoading) setLoading(true);
      const requests = [getLocalScreenshots(workName)];
      if (appId) requests.push(steamGetScreenshots(appId));
      const results = await Promise.allSettled(requests);
      if (cancelled) return;

      const loaded: LocalScreenshot[] = [];
      let succeeded = 0;
      for (const result of results) {
        if (result.status === 'fulfilled') {
          succeeded++;
          loaded.push(...result.value);
        } else {
          console.error('[Local screenshots] Failed to load captures:', result.reason);
        }
      }
      setScreenshots([...new Map(loaded.map(screenshot => [screenshot.path, screenshot])).values()]);
      setFailed(succeeded === 0);
      if (showLoading) setLoading(false);
    };

    const onFocus = () => { void loadScreenshots(false); };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void loadScreenshots(false);
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);
    void loadScreenshots(true);

    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [appId, workName]);

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

  const screenshotEpisodeCode = (path: string) => path
    .split(/[\\/]/)
    .pop()
    ?.match(/\b(S\d{2}E\d{2}|M\d{2})\b/i)?.[1]
    .toUpperCase() ?? null;
  const vlcScreenshotDetails = (path: string) => {
    const filename = path.split(/[\\/]/).pop() ?? '';
    const match = filename.match(/ - (S\d{2}E\d{2}) - (\d{2,}h\d{2}m\d{2}s\d{3})\.png$/i);
    return match ? { episode: match[1].toUpperCase(), timecode: match[2] } : null;
  };
  const screenshotEpisodeFilters = [...new Set(screenshots
    .map(screenshot => screenshotEpisodeCode(screenshot.path))
    .filter((code): code is string => code !== null))]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const filteredScreenshots = screenshotEpisodeFilter === 'all'
    ? screenshots
    : screenshots.filter(screenshot => screenshotEpisodeCode(screenshot.path) === screenshotEpisodeFilter);
  const screenshotsPerPage = screenshotColumns * SCREENSHOT_ROWS_PER_PAGE;
  const screenshotPageCount = Math.max(1, Math.ceil(filteredScreenshots.length / screenshotsPerPage));
  const visibleScreenshotsPage = Math.min(screenshotsPage, screenshotPageCount - 1);
  const achievementList = achievements?.list ?? [];
  const achievementsPerPage = achievementColumns * ACHIEVEMENT_ROWS_PER_PAGE;
  const achievementPageCount = Math.max(1, Math.ceil(achievementList.length / achievementsPerPage));
  const visibleAchievementsPage = Math.min(achievementsPage, achievementPageCount - 1);
  const visibleScreenshots = filteredScreenshots.slice(visibleScreenshotsPage * screenshotsPerPage, (visibleScreenshotsPage + 1) * screenshotsPerPage);
  const visibleAchievements = achievementList.slice(visibleAchievementsPage * achievementsPerPage, (visibleAchievementsPage + 1) * achievementsPerPage);
  const shownScreenshot = previewIndex === null ? null : filteredScreenshots[previewIndex];
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

  const screenshotFilter = screenshotEpisodeFilters.length > 0 && (
    <select
      className="local-steam-screenshots-filter"
      value={screenshotEpisodeFilter}
      aria-label={t.media.stat_episodes}
      onChange={event => {
        setScreenshotEpisodeFilter(event.target.value);
        setScreenshotsPage(0);
        setPreviewIndex(null);
      }}
    >
      <option value="all">{t.search.filter_all}</option>
      {screenshotEpisodeFilters.map(code => <option key={code} value={code}>{code}</option>)}
    </select>
  );

  return (
    <section className="local-steam-media">
      {appId ? <div className="local-steam-media-tabs" role="group" aria-label={`${t.local.screenshots} / ${t.local.stat_achievements}`}>
        <button
          type="button"
          className={`local-steam-media-tab${activeTab === 'screenshots' ? ' active' : ''}`}
          aria-pressed={activeTab === 'screenshots'}
          onClick={() => { setActiveTab('screenshots'); setPreviewIndex(null); }}
        >
          <span>{t.local.screenshots}</span>
          <span className="local-steam-media-count">{loading ? '…' : screenshots.length}</span>
        </button>
        {appId && <button
          type="button"
          className={`local-steam-media-tab${activeTab === 'achievements' ? ' active' : ''}`}
          aria-pressed={activeTab === 'achievements'}
          onClick={() => { setActiveTab('achievements'); setPreviewIndex(null); }}
        >
          <span>{t.local.stat_achievements}</span>
          <span className="local-steam-media-count">
            {achievementsLoading ? '…' : achievements ? `${achievements.unlocked}/${achievements.total}` : '0'}
          </span>
        </button>}
        {activeTab === 'screenshots' && screenshotFilter}
      </div> : (
        <div className="local-steam-screenshots-heading">
          <p className="local-steam-media-title">{t.local.screenshots}</p>
          {screenshotFilter}
        </div>
      )}

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
                      aria-label={`${t.local.screenshots} ${absoluteIndex + 1}`}
                    >
                      <img
                        src={wrapAssetUrl(screenshot.thumbnail_path)}
                        alt={`${t.local.screenshots} ${absoluteIndex + 1}`}
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
              {loading ? t.local.screenshots_loading : failed ? t.local.screenshots_error : t.local.screenshots_empty}
            </p>
          )}
        </div>
      ) : appId ? (
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
      ) : null}

      {shownScreenshot && activeTab === 'screenshots' && (
        <div className="local-steam-screenshot-viewer" role="presentation" onClick={() => setPreviewIndex(null)}>
          <div
            className="local-steam-screenshot-viewer-content"
            role="dialog"
            aria-modal="true"
            aria-label={t.local.screenshots}
            onClick={event => event.stopPropagation()}
          >
            <button type="button" className="local-steam-screenshot-close" onClick={() => setPreviewIndex(null)} aria-label={t.local.close_panel}>×</button>
            <button
              type="button"
              className="local-steam-screenshot-nav local-steam-screenshot-prev"
              onClick={() => setPreviewIndex((previewIndex! + filteredScreenshots.length - 1) % filteredScreenshots.length)}
              aria-label={t.character.pagination_prev}
            >‹</button>
            <div className="local-steam-screenshot-frame">
              {vlcScreenshotDetails(shownScreenshot.path) && (
                <div className="local-steam-screenshot-vlc-label">
                  <strong>{vlcScreenshotDetails(shownScreenshot.path)!.episode}</strong>
                  <span>{vlcScreenshotDetails(shownScreenshot.path)!.timecode}</span>
                </div>
              )}
              <img className="local-steam-screenshot-full" src={wrapAssetUrl(shownScreenshot.path)} alt={`${t.local.screenshots} ${previewIndex! + 1}`} />
            </div>
            <button
              type="button"
              className="local-steam-screenshot-nav local-steam-screenshot-next"
              onClick={() => setPreviewIndex((previewIndex! + 1) % filteredScreenshots.length)}
              aria-label={t.character.pagination_next}
            >›</button>
            <span className="local-steam-screenshot-counter">{previewIndex! + 1} / {filteredScreenshots.length}</span>
          </div>
        </div>
      )}
    </section>
  );
}
