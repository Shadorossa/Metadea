import React, { useState } from 'react';
import '../../styles/components/retro-achievements.css';
import { RetroAchievementsLinkPicker } from './RetroAchievementsLinkPicker';
import type { RetroAchievementsState } from './hooks/useRetroAchievements';
import { awardTier, isHardcoreAward, summarizeProgress } from '../../lib/retro-achievements/progress-summary';
import { getT } from '../../i18n/runtime';

interface RetroAchievementsControlsProps {
  state: RetroAchievementsState;
  // The picker's initial query.
  title: string;
}

// The RA-only pieces of the achievements tab, rendered inside the same tabs
// row the Steam counters sit in (MediaScreenshotsSection's
// `achievementsTab.controls`): Refresh / Link manually / Unlink and the
// mastery, hardcore, manual-link and cache badges, all with the row's own
// classes. The grid itself is the Steam one, fed through
// toSteamAchievementsModel; Metadea only displays progress, unlocking
// happens in RA-enabled emulators.
export function RetroAchievementsControls({ state, title }: RetroAchievementsControlsProps) {
  const t = getT();
  const [pickerOpen, setPickerOpen] = useState(false);
  const progress = state.progress?.data ?? null;
  const summary = progress ? summarizeProgress(progress) : null;
  const tier = awardTier(progress?.highestAwardKind);
  const provenance = state.progress
    ? state.progress.stale ? t.retro_achievements.state_stale
      : state.progress.fromCache ? t.retro_achievements.state_cached
        : null
    : null;

  return (
    <>
      {summary && (
        <span className="local-steam-media-count">
          {summary.pointsUnlocked}/{summary.pointsTotal} {t.retro_achievements.points}
        </span>
      )}
      {summary?.hardcore && <span className="local-steam-media-count">{t.retro_achievements.hardcore}</span>}
      {tier && progress && (
        <span className="local-steam-media-count">
          {tier === 'mastery' ? t.retro_achievements.award_mastery : t.retro_achievements.award_beaten}
          {isHardcoreAward(progress.highestAwardKind) ? '' : ` (${t.retro_achievements.softcore})`}
        </span>
      )}
      {state.link?.matchedBy === 'manual' && <span className="local-steam-media-count">{t.retro_achievements.linked_manually}</span>}
      {provenance && <span className="local-steam-media-count">{provenance}</span>}
      {state.link && (
        <button type="button" className="local-steam-media-page-btn" onClick={() => void state.refresh(true)} disabled={state.loading}>
          {t.retro_achievements.refresh}
        </button>
      )}
      {state.status?.configured && state.consoleId && (
        <button type="button" className="local-steam-media-page-btn" onClick={() => setPickerOpen(true)} disabled={state.linking}>
          {t.retro_achievements.link_manually}
        </button>
      )}
      {state.link && (
        <button type="button" className="local-steam-media-page-btn" onClick={() => void state.unlink()}>
          {t.retro_achievements.unlink}
        </button>
      )}
      {pickerOpen && state.consoleId && (
        <RetroAchievementsLinkPicker
          consoleId={state.consoleId}
          initialQuery={title || progress?.title || ''}
          onClose={() => setPickerOpen(false)}
          onPicked={entry => { setPickerOpen(false); void state.linkManually(entry.id); }}
        />
      )}
    </>
  );
}

// What the achievements tab shows instead of a grid while RA has nothing
// to list for this entry (same empty-line class as Steam's).
export function RetroAchievementsEmpty({ state }: { state: RetroAchievementsState }) {
  const t = getT();
  if (!state.status?.configured) {
    return (
      <p className="local-steam-screenshots-empty">
        {t.retro_achievements.not_configured}{' '}
        <a href="/settings" className="ra-settings-link">{t.settings.tab_environment}</a>
      </p>
    );
  }
  const message = state.error
    ?? (state.linking ? t.retro_achievements.linking
      : !state.link ? (state.noMatch ? t.retro_achievements.no_match : t.retro_achievements.not_linked)
        : t.local.steam_achievements_empty);
  return <p className="local-steam-screenshots-empty">{message}</p>;
}
