import type { LocalGame } from '../tauri';

type EditionMarker = {
  pattern: RegExp;
  role: 'current' | 'secondary';
  label: string;
};

type SteamEditionPair = {
  current: LocalGame;
  secondary: LocalGame;
  secondaryLabel: string;
};

// Recognize explicit edition qualifiers in Steam's app names. Pairing still
// requires exactly two Steam apps with the same normalized base title.
const EDITION_MARKERS: EditionMarker[] = [
  { pattern: /\s*[-–—:]?\s*\(?\s*(?:free\s+trial|trial)\s*\)?$/i, role: 'secondary', label: 'Prueba gratuita' },
  { pattern: /\s*[-–—:]?\s*\(?\s*legacy\s*\)?$/i, role: 'secondary', label: 'Legacy' },
  { pattern: /\s*[-–—:]?\s*\(?\s*(\d{4})\s*\)?$/i, role: 'secondary', label: '$1' },
  { pattern: /\s*[-–—:]?\s*\(?\s*original(?:\s+version)?\s*\)?$/i, role: 'secondary', label: 'Original' },
  { pattern: /\s*[-–—:]?\s*\(?\s*(?:hd\s+)?remaster(?:ed)?(?:\s+edition)?\s*\)?$/i, role: 'current', label: 'Original' },
  { pattern: /\s*[-–—:]?\s*\(?\s*director['’]?s\s+cut\s*\)?$/i, role: 'current', label: 'Original' },
  { pattern: /\s*[-–—:]?\s*\(?\s*(?:definitive|enhanced|ultimate)\s+edition\s*\)?$/i, role: 'current', label: 'Original' },
];

function isSteamApp(game: LocalGame): boolean {
  return game.launcher === 'steam' && !!game.app_id;
}

function normalizeTitle(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function parseEditionName(game: LocalGame): { baseTitle: string; marker: EditionMarker | null } | null {
  if (!isSteamApp(game)) return null;
  const name = game.name.trim();
  for (const marker of EDITION_MARKERS) {
    const match = name.match(marker.pattern);
    if (match) {
      const baseTitle = normalizeTitle(name.slice(0, match.index).trim());
      return baseTitle ? { baseTitle, marker: { ...marker, label: marker.label.replace('$1', match[1] ?? '') } } : null;
    }
  }
  const baseTitle = normalizeTitle(name);
  return baseTitle ? { baseTitle, marker: null } : null;
}

function findSteamEditionPairs(
  games: readonly LocalGame[],
  isRemakePair?: (current: LocalGame, secondary: LocalGame) => boolean,
): SteamEditionPair[] {
  const groups = new Map<string, LocalGame[]>();
  for (const game of games) {
    const parsed = parseEditionName(game);
    if (!parsed) continue;
    const group = groups.get(parsed.baseTitle) ?? [];
    group.push(game);
    groups.set(parsed.baseTitle, group);
  }

  const pairs: SteamEditionPair[] = [];
  for (const group of groups.values()) {
    // Ambiguous title groups (three or more entries) are deliberately left alone.
    if (group.length !== 2) continue;
    const [first, second] = group;
    const firstEdition = parseEditionName(first);
    const secondEdition = parseEditionName(second);
    if (!firstEdition || !secondEdition || (!!firstEdition.marker === !!secondEdition.marker)) continue;

    const markedGame = firstEdition.marker ? first : second;
    const baseGame = firstEdition.marker ? second : first;
    const markedEdition = firstEdition.marker ? firstEdition : secondEdition;
    const marker = markedEdition.marker!;
    const pair = marker.role === 'current'
      ? { current: markedGame, secondary: baseGame, secondaryLabel: marker.label }
      : { current: baseGame, secondary: markedGame, secondaryLabel: marker.label };
    // A remake is a distinct game identity, not a legacy launch option for
    // the original. Catalog metadata/relations can identify this even when
    // Steam's names happen to look like a year-suffixed legacy pair.
    if (isRemakePair?.(pair.current, pair.secondary)) continue;
    pairs.push(pair);
  }
  return pairs;
}

/** Finds a unique current/secondary Steam edition pair from app names. */
export function findSteamLegacyVariant(
  game: LocalGame,
  games: readonly LocalGame[],
  isRemakePair?: (current: LocalGame, secondary: LocalGame) => boolean,
): LocalGame | null {
  if (!isSteamApp(game)) return null;
  return findSteamEditionPairs(games, isRemakePair).find(pair =>
    pair.current.app_id === game.app_id && pair.current.launcher === game.launcher,
  )?.secondary ?? null;
}

/** Label inferred from the edition suffix on the secondary app's Steam name. */
export function steamLegacyVariantLabel(
  game: LocalGame,
  variant: LocalGame,
  games: readonly LocalGame[],
  isRemakePair?: (current: LocalGame, secondary: LocalGame) => boolean,
): string {
  return findSteamEditionPairs(games, isRemakePair).find(pair =>
    pair.current.app_id === game.app_id && pair.secondary.app_id === variant.app_id,
  )?.secondaryLabel ?? 'Legacy';
}

/** Keeps the inferred current release as the sole card when both apps exist. */
export function collapseSteamLegacyPairs(
  games: readonly LocalGame[],
  isRemakePair?: (current: LocalGame, secondary: LocalGame) => boolean,
): LocalGame[] {
  const secondaryIds = new Set(findSteamEditionPairs(games, isRemakePair).map(pair => pair.secondary.app_id));
  return games.filter(game => !game.app_id || !secondaryIds.has(game.app_id));
}
