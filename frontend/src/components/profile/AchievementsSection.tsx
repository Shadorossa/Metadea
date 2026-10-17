import { useEffect, useState } from 'react';
import { Trophy } from 'lucide-react';
import { beginGlobalLoading } from '../../lib/dom/global-loading';
import { getT } from '../../i18n/runtime';
import { mergeSteamEditionAchievements } from '../../lib/local/steam-achievements-merge';
import { toSteamAchievementsModel } from '../../lib/retro-achievements/achievement-cell-adapter';
import { AchievementIcons } from './AchievementIcons';
import { loadAchievements, type AchievementGame } from '../../lib/profile/achievement-data';

function AchievementCover({ game }: { game: AchievementGame }) {
  const sources = [game.cover, ...game.coverFallbacks].filter((source, index, all) => !!source && all.indexOf(source) === index);
  const [sourceIndex, setSourceIndex] = useState(0);

  if (sourceIndex >= sources.length) return <span>🎮</span>;
  return <img
    src={sources[sourceIndex]}
    alt=""
    loading="lazy"
    onError={() => setSourceIndex(index => index + 1)}
  />;
}

export function AchievementsSection() {
  const t = getT();
  const [games, setGames] = useState<AchievementGame[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const endLoading = beginGlobalLoading();
    loadAchievements().then(rows => { if (!cancelled) setGames(rows); })
      .catch(() => { if (!cancelled) setGames([]); })
      .finally(endLoading);
    return () => { cancelled = true; };
  }, []);

  if (!games) return null;
  if (games.length === 0) {
    return <div className="profile-empty"><span className="profile-empty-icon">🏆</span><p>{t.local.steam_achievements_empty}</p></div>;
  }

  const total = games.reduce((counts, game) => {
    const steam = mergeSteamEditionAchievements(game.steam, game.legacySteam);
    counts.unlocked += steam.unlocked + (game.retro?.unlocked ?? 0);
    counts.total += steam.total + (game.retro?.total ?? 0);
    return counts;
  }, { unlocked: 0, total: 0 });

  return (
    <section className="profile-achievements-list" aria-label={t.local.stat_achievements}>
      <div className="profile-achievements-summary" aria-label={`${t.local.stat_achievements}: ${total.unlocked}/${total.total}`}>
        <Trophy size={16} aria-hidden="true" />
        <span>{t.local.stat_achievements}</span>
        <strong>
          {total.unlocked}
          /
          {total.total}
        </strong>
      </div>
      {games.map(game => {
        const steam = mergeSteamEditionAchievements(game.steam, game.legacySteam);
        const unlocked = steam.unlocked + (game.retro?.unlocked ?? 0);
        const total = steam.total + (game.retro?.total ?? 0);
        return (
          <article className="profile-achievement-game" key={game.id}>
            <div className="profile-achievement-cover">
              <AchievementCover game={game} />
            </div>
            <div className="profile-achievement-content">
              <div className="profile-achievement-title-row">
                <h2>{game.title}</h2>
                <span className="profile-achievement-count">{unlocked}/{total}</span>
                <div className="profile-achievement-platforms">
                  {(game.steam || game.legacySteam) && <span className="profile-achievement-platform-icon profile-achievement-platform-icon--steam" role="img" aria-label="Steam" title="Steam" />}
                  {game.retro && <span className="profile-achievement-platform-icon profile-achievement-platform-icon--retro" role="img" aria-label="RetroAchievements" title="RetroAchievements" />}
                </div>
              </div>
              {(game.steam || game.legacySteam) && <AchievementIcons
                achievements={game.steam?.list ?? []}
                legacyAchievements={game.legacySteam?.list}
                identity={`steam:${game.id}`}
              />}
              {game.retro && <AchievementIcons
                achievements={toSteamAchievementsModel(game.retro, {
                  points: t.retro_achievements.points,
                  hardcore: t.retro_achievements.hardcore,
                }).list}
                identity={`retro:${game.id}`}
              />}
            </div>
          </article>
        );
      })}
    </section>
  );
}
