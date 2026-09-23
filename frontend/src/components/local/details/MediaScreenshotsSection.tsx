import React, { useEffect, useRef, useState } from 'react';
import { useKeyedState } from '../../shared/hooks/useKeyedState';

const NO_SCREENSHOTS: LocalScreenshot[] = [];
import {
  getEmulatorScreenshots, getLocalScreenshots, steamGetScreenshots, wrapAssetUrl,
  type LocalScreenshot, type SteamAchievement,
} from '../../../lib/tauri';
import { getT } from '../../../i18n/runtime';
import { AchievementCell } from './AchievementCell';

const SCREENSHOT_ROWS_PER_PAGE = 3;
const ACHIEVEMENT_ROWS_PER_PAGE = 3;

interface MediaScreenshotsSectionProps {
  appId?: string;
  workName: string;
  achievements: { unlocked: number; total: number; list: SteamAchievement[] } | null;
  achievementsLoading: boolean;
  // Achievements tab for a source other than Steam (RetroAchievements):
  // the same list shape, grid, cells and loading state, plus that source's
  // own controls in the tabs row and its own message when there is no list.
  achievementsTab?: {
    // AchievementCell's appId; irrelevant for remote icons but keyed on.
    iconAppId: string;
    // Rendered in the tabs row while the achievements tab is active.
    controls?: React.ReactNode;
    // Shown in place of the "no achievements" text (not linked, not
    // configured, error...).
    empty?: React.ReactNode;
  };
  // A scanned ROM: the emulator's own capture folder joins the list.
  emulator?: { platformId: string; romPath: string; title?: string };
}

export function MediaScreenshotsSection({ appId, workName, achievements, achievementsLoading, achievementsTab, emulator }: MediaScreenshotsSectionProps) {
  const t = getT();
  const hasAchievementsTab = !!appId || !!achievementsTab;
  const achievementsIconAppId = appId ?? achievementsTab?.iconAppId ?? '';
  const emulatorPlatformId = emulator?.platformId;
  const emulatorRomPath = emulator?.romPath;
  const emulatorTitle = emulator?.title;
  // Everything below starts over for each work this section is shown for.
  const workKey = `${appId}\n${workName}\n${emulatorRomPath ?? ''}`;
  const [activeTab, setActiveTab] = useKeyedState<'screenshots' | 'achievements'>(workKey, 'screenshots');
  const [screenshots, setScreenshots] = useKeyedState<LocalScreenshot[]>(workKey, NO_SCREENSHOTS);
  // The emulator folder had nothing named after this game, so what it
  // contributed is its recent captures for the platform.
  const [emulatorUnfiltered, setEmulatorUnfiltered] = useKeyedState(workKey, false);
  const screenshotsGridRef = useRef<HTMLDivElement>(null);
  const achievementsGridRef = useRef<HTMLDivElement>(null);
  const [previewIndex, setPreviewIndex] = useKeyedState<number | null>(workKey, null);
  const [screenshotEpisodeFilter, setScreenshotEpisodeFilter] = useKeyedState(workKey, 'all');
  const [screenshotsPage, setScreenshotsPage] = useKeyedState(workKey, 0);
  const [screenshotColumns, setScreenshotColumns] = useState(3);
  const [achievementsPage, setAchievementsPage] = useKeyedState(workKey, 0);
  const [achievementColumns, setAchievementColumns] = useState(6);
  const [loading, setLoading] = useKeyedState(workKey, true);
  const [failed, setFailed] = useKeyedState(workKey, false);
  // The captures (a local folder walk, Steam's screenshot folder, the
  // emulator's capture folder) are only listed once this section has been
  // scrolled into view with its screenshots tab active — it sits below the
  // panel's summary, so a panel opened for its header alone never issues
  // them. Latched per work: once wanted, later tab switches keep the list
  // and its focus refresh instead of re-listing.
  const sectionRef = useRef<HTMLElement>(null);
  const [inView, setInView] = useKeyedState(workKey, false);
  const [screenshotsWanted, setScreenshotsWanted] = useKeyedState(workKey, false);

  useEffect(() => {
    if (inView) return;
    const section = sectionRef.current;
    if (!section || typeof IntersectionObserver === 'undefined') { setInView(true); return; }
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setInView(true); observer.disconnect(); } },
      { rootMargin: '200px' },
    );
    observer.observe(section);
    return () => observer.disconnect();
  }, [inView, setInView]);

  useEffect(() => {
    if (inView && activeTab === 'screenshots') setScreenshotsWanted(true);
  }, [inView, activeTab, setScreenshotsWanted]);

  useEffect(() => {
    if (!screenshotsWanted) return;
    let cancelled = false;

    const loadScreenshots = async (showLoading: boolean) => {
      if (showLoading) setLoading(true);
      const requests: Promise<{ screenshots: LocalScreenshot[]; filtered: boolean }>[] = [
        getLocalScreenshots(workName).then(screenshots => ({ screenshots, filtered: true })),
      ];
      if (appId) requests.push(steamGetScreenshots(appId).then(screenshots => ({ screenshots, filtered: true })));
      if (emulatorPlatformId && emulatorRomPath) {
        requests.push(getEmulatorScreenshots(emulatorPlatformId, emulatorRomPath, { title: emulatorTitle }));
      }
      const results = await Promise.allSettled(requests);
      if (cancelled) return;

      const loaded: LocalScreenshot[] = [];
      let succeeded = 0;
      let unfiltered = false;
      for (const result of results) {
        if (result.status === 'fulfilled') {
          succeeded++;
          loaded.push(...result.value.screenshots);
          if (!result.value.filtered && result.value.screenshots.length > 0) unfiltered = true;
        } else {
          console.error('[Local screenshots] Failed to load captures:', result.reason);
        }
      }
      setScreenshots([...new Map(loaded.map(screenshot => [screenshot.path, screenshot])).values()]);
      setEmulatorUnfiltered(unfiltered);
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
  }, [screenshotsWanted, appId, workName, emulatorPlatformId, emulatorRomPath, emulatorTitle, setScreenshots, setEmulatorUnfiltered, setFailed, setLoading]);

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
    <section className="local-steam-media" ref={sectionRef}>
      {hasAchievementsTab ? <div className="local-steam-media-tabs" role="group" aria-label={`${t.local.screenshots} / ${t.local.stat_achievements}`}>
        <button
          type="button"
          className={`local-steam-media-tab${activeTab === 'screenshots' ? ' active' : ''}`}
          aria-pressed={activeTab === 'screenshots'}
          onClick={() => { setActiveTab('screenshots'); setPreviewIndex(null); }}
        >
          <span>{t.local.screenshots}</span>
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
        {activeTab === 'screenshots' && screenshotFilter}
        {activeTab === 'achievements' && achievementsTab?.controls}
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
              {emulatorUnfiltered && <p className="local-steam-screenshots-empty">{t.local.emulator_screenshots_recent}</p>}
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
                        className="cover-image-fill"
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
      ) : hasAchievementsTab ? (
        <div className={`local-steam-media-panel${achievementsLoading ? ' local-steam-media-panel--reserved' : ''}`} role="tabpanel">
          {achievementsLoading ? (
            <p className="local-steam-screenshots-empty">{t.local.steam_achievements_loading}</p>
          ) : achievementList.length > 0 ? (
            <>
              <div className="local-game-detail-achievement-grid" ref={achievementsGridRef}>
                {visibleAchievements.map(achievement => (
                  <AchievementCell key={achievement.apiname} ach={achievement} appId={achievementsIconAppId} />
                ))}
              </div>
              {pagination(visibleAchievementsPage, achievementPageCount, setAchievementsPage)}
            </>
          ) : (
            achievementsTab?.empty ?? <p className="local-steam-screenshots-empty">{t.local.steam_achievements_empty}</p>
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
