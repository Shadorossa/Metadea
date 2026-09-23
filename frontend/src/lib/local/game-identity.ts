import type { LocalGame } from '../tauri';

/**
 * The (launcher, link key) identity every local-game table keys on — the
 * same `app_id ?? install_path ?? name` scan_all_games' game_link_key
 * derives (platform_scanning/common.rs), so links, "seen" rows, hidden games
 * and React keys all agree on what "one game" is.
 */
export function gameLinkKey(game: LocalGame): string {
  return game.app_id ?? game.install_path ?? game.name;
}

export function gameIdentity(game: LocalGame): string {
  return `${game.launcher}:${gameLinkKey(game)}`;
}

// Installed beats not installed, then a catalog link, then recorded time.
function richness(game: LocalGame): [number, number, number] {
  return [game.installed === false ? 0 : 1, game.external_id ? 1 : 0, game.playtime_minutes ?? 0];
}

function isRicher(a: LocalGame, b: LocalGame): boolean {
  const [ra, rb] = [richness(a), richness(b)];
  for (let i = 0; i < ra.length; i++) {
    if (ra[i] !== rb[i]) return ra[i] > rb[i];
  }
  return false;
}

function mergeInto(kept: LocalGame, other: LocalGame): LocalGame {
  const maxOf = (a?: number, b?: number) => (a == null ? b : b == null ? a : Math.max(a, b));
  return {
    ...kept,
    external_id: kept.external_id ?? other.external_id,
    install_path: kept.install_path ?? other.install_path,
    playtime_minutes: maxOf(kept.playtime_minutes, other.playtime_minutes),
    last_played: maxOf(kept.last_played, other.last_played),
  };
}

/**
 * One entry per game identity, at the position of its first report, keeping
 * the richer entry (installed, linked, with playtime) and filling in what it
 * lacks from the other. The Rust scan already dedupes its own output; this
 * also covers what the frontend appends to it (Steam's owned-games list) and
 * keeps two cards from ever sharing one React key.
 */
export function dedupeLocalGames(games: LocalGame[]): LocalGame[] {
  const out: LocalGame[] = [];
  const indexById = new Map<string, number>();
  for (const game of games) {
    const id = gameIdentity(game);
    const idx = indexById.get(id);
    if (idx === undefined) {
      indexById.set(id, out.length);
      out.push(game);
      continue;
    }
    const current = out[idx];
    out[idx] = isRicher(game, current) ? mergeInto(game, current) : mergeInto(current, game);
  }
  return out;
}
