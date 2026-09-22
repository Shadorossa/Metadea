import { createPortal } from 'react-dom';
import type { MediaEpisode, MediaTheme } from '../../../lib/tauri';
import type { SagaEntry } from '../../../lib/anilist/saga';
import type { Translations } from '../../../i18n/index';
import { formatThemeEpisodes, splitTitleAfterColon } from './media-page-format';

interface Props {
  theme: MediaTheme;
  themes: MediaTheme[];
  videoSrc: string | null;
  playerError: boolean;
  retryKey: number;
  selectedVersion: number;
  animeSeasonChain: SagaEntry[];
  episodes: MediaEpisode[];
  currentId: string;
  episodeOffset: number;
  hasEpisodes: boolean;
  t: Translations['media'];
  onClose: () => void;
  onSelectTheme: (theme: MediaTheme) => void;
  onSelectVersion: (version: number, videoUrl: string | null) => void;
  onVideoError: () => void;
  onRetry: () => void;
  onNavigateToEpisodes: (formattedEpisodes: string) => void;
}

export function ThemePlayerOverlay({
  theme: playingTheme,
  themes,
  videoSrc,
  playerError,
  retryKey,
  selectedVersion,
  animeSeasonChain,
  episodes,
  currentId,
  episodeOffset,
  hasEpisodes,
  t,
  onClose,
  onSelectTheme,
  onSelectVersion,
  onVideoError,
  onRetry,
  onNavigateToEpisodes,
}: Props) {
  const currentThemeIdx = themes.findIndex(item => item.slug === playingTheme.slug);
  const prevTheme = currentThemeIdx > 0 ? themes[currentThemeIdx - 1] : null;
  const nextTheme = currentThemeIdx !== -1 && currentThemeIdx < themes.length - 1 ? themes[currentThemeIdx + 1] : null;

  const themeVersions: Array<{ version: number; episodes: string | null; videoUrl: string | null }> = (() => {
    if (playingTheme.versions) {
      try {
        const parsed = JSON.parse(playingTheme.versions);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch {}
    }
    return [{ version: 1, episodes: playingTheme.episodes, videoUrl: playingTheme.video_url }];
  })();

  const currentVersionObj = themeVersions.find(v => v.version === selectedVersion) || themeVersions[0];
  const targetId = playingTheme.external_id || currentId;

  const themeSeason = (() => {
    if (animeSeasonChain.length > 0) {
      const idx = animeSeasonChain.findIndex(s => s.externalId === targetId);
      if (idx !== -1) {
        return {
          seasonIndex: idx + 1,
          title: animeSeasonChain[idx].title,
          cover: animeSeasonChain[idx].cover,
          externalId: animeSeasonChain[idx].externalId,
        };
      }
    }
    return null;
  })();

  const seasonOffset = (() => {
    if (!themeSeason || animeSeasonChain.length <= 1) return episodeOffset;
    const sIdx = themeSeason.seasonIndex - 1;
    if (sIdx <= 0) return episodeOffset;
    let offset = 0;
    for (let i = 0; i < sIdx; i++) {
      const sId = animeSeasonChain[i].externalId;
      const sEps = episodes.filter(e => (e.external_id || currentId) === sId && e.episode_number > 0);
      offset += sEps.length;
    }
    return offset > 0 ? offset : episodeOffset;
  })();

  const rawEps = (() => {
    if (currentVersionObj?.episodes) return currentVersionObj.episodes;
    if (playingTheme.episodes) return playingTheme.episodes;
    const seasonEps = episodes.filter(e => (e.external_id || currentId) === targetId && e.episode_number > 0);
    if (seasonEps.length > 0) {
      const minEp = seasonEps[0].episode_number;
      const maxEp = seasonEps[seasonEps.length - 1].episode_number;
      return minEp === maxEp ? String(minEp) : `${minEp}-${maxEp}`;
    }
    return null;
  })();

  const formattedEps = formatThemeEpisodes(rawEps, seasonOffset);

  return createPortal(
    <div className="theme-player-overlay" onClick={onClose}>
      <div className="theme-player-container" onClick={e => e.stopPropagation()}>
        <button
          type="button"
          className="theme-player-nav theme-player-nav--prev"
          disabled={!prevTheme}
          onClick={() => prevTheme && onSelectTheme(prevTheme)}
          aria-label={t.theme_prev}
          title={prevTheme ? (prevTheme.song_title ?? `${prevTheme.theme_type}${prevTheme.sequence}`) : undefined}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        <div className="theme-player-modal">
          <button type="button" className="theme-player-close" onClick={onClose} aria-label={t.theme_player_close}>×</button>
          <div className="theme-player-video-wrap">
            {videoSrc && (
              <video
                key={`${playingTheme.slug}-${retryKey}`}
                className="theme-player-video"
                src={videoSrc}
                controls
                autoPlay
                preload="auto"
                onError={onVideoError}
              />
            )}
            {playerError && (
              <div className="theme-player-error-overlay">
                <p className="theme-player-error-text">{t.theme_player_error}</p>
                <button
                  type="button"
                  className="theme-player-retry-btn"
                  onClick={onRetry}
                >
                  {t.theme_player_retry}
                </button>
              </div>
            )}
          </div>
          <div className="theme-player-info">
            <span className={`media-theme-badge media-theme-badge--${playingTheme.theme_type.toLowerCase()}`}>
              {playingTheme.theme_type}{playingTheme.sequence}
            </span>
            <div className="theme-player-text">
              <span className="theme-player-title">{playingTheme.song_title ?? `${playingTheme.theme_type}${playingTheme.sequence}`}</span>
              {playingTheme.artists && <span className="theme-player-artist">{playingTheme.artists}</span>}
            </div>
            {themeVersions.length > 1 && (
              <div className="theme-player-version-tabs">
                {themeVersions.map(v => (
                  <button
                    key={v.version}
                    type="button"
                    className={`theme-player-version-tab${currentVersionObj.version === v.version ? ' active' : ''}`}
                    onClick={() => onSelectVersion(v.version, v.videoUrl)}
                  >
                    {`v${v.version}`}
                  </button>
                ))}
              </div>
            )}
            {animeSeasonChain.length > 1 && themeSeason && (
              <a
                href={`/media?id=${encodeURIComponent(themeSeason.externalId)}`}
                className="theme-player-season-card"
                title={themeSeason.title}
                onClick={e => e.stopPropagation()}
              >
                {themeSeason.cover && (
                  <div className="theme-player-season-bg">
                    <img src={themeSeason.cover} alt="" />
                  </div>
                )}
                <div className="theme-player-season-overlay" />
                <span className="theme-player-season-title">{splitTitleAfterColon(themeSeason.title)}</span>
              </a>
            )}
            {formattedEps && (
              <button
                type="button"
                className={`theme-player-episodes${hasEpisodes ? ' theme-player-episodes--interactive' : ''}`}
                onClick={() => hasEpisodes && onNavigateToEpisodes(formattedEps)}
                title={hasEpisodes ? t.theme_goto_episodes : undefined}
              >
                {formattedEps.includes('-') || formattedEps.includes(',') ? `${t.theme_episodes_label} ` : `${t.theme_episode_label} `}
                {formattedEps}
              </button>
            )}
          </div>
        </div>

        <button
          type="button"
          className="theme-player-nav theme-player-nav--next"
          disabled={!nextTheme}
          onClick={() => nextTheme && onSelectTheme(nextTheme)}
          aria-label={t.theme_next}
          title={nextTheme ? (nextTheme.song_title ?? `${nextTheme.theme_type}${nextTheme.sequence}`) : undefined}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>
    </div>,
    document.body,
  );
}
