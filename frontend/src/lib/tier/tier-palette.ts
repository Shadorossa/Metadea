// TierMaker's label colours and default board. Colours are user data (they
// are saved with each row), not theme tokens — the export image and every
// theme show the same red → green ramp the user picked.
import type { TierDef } from '../tauri/tier-lists';

export const TIER_PALETTE = [
  '#ff7f7f', '#ffbf7f', '#ffdf7f', '#ffff7f', '#bfff7f', '#7fff7f', '#7fffff', '#7fbfff',
  '#7f7fff', '#ff7fff', '#bf7fbf', '#3b3b3b', '#858585', '#cfcfcf', '#f7f7f7',
] as const;

// Mirrors DEFAULT_TIERS_JSON in src-tauri/src/tier_lists.rs.
export const DEFAULT_TIER_ROWS: readonly TierDef[] = [
  { id: 's', label: 'S', color: '#ff7f7f' },
  { id: 'a', label: 'A', color: '#ffbf7f' },
  { id: 'b', label: 'B', color: '#ffdf7f' },
  { id: 'c', label: 'C', color: '#ffff7f' },
  { id: 'd', label: 'D', color: '#bfff7f' },
  { id: 'f', label: 'F', color: '#7fff7f' },
];

export const TIER_LABEL_MAX_LENGTH = 32;

const HEX_RE = /^#[0-9a-f]{6}$/i;

export function isHexColor(value: string): boolean {
  return HEX_RE.test(value);
}

/** Next palette colour after the last row's, so "add row" continues the ramp. */
export function nextRowColor(previous: string | undefined): string {
  const index = previous ? TIER_PALETTE.indexOf(previous.toLowerCase() as typeof TIER_PALETTE[number]) : -1;
  return TIER_PALETTE[(index + 1) % TIER_PALETTE.length];
}

/** Dark or light label text for a background, by relative luminance. */
export function labelTextColor(background: string): '#111111' | '#f7f7f7' {
  if (!isHexColor(background)) return '#111111';
  const channel = (offset: number) => {
    const c = parseInt(background.slice(offset, offset + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return luminance > 0.36 ? '#111111' : '#f7f7f7';
}

export function newRowId(existing: readonly string[], random: () => number = Math.random): string {
  for (let attempt = 0; attempt < 20; attempt++) {
    const id = `r${Math.floor(random() * 36 ** 6).toString(36)}`;
    if (!existing.includes(id)) return id;
  }
  let n = existing.length;
  while (existing.includes(`r${n}`)) n++;
  return `r${n}`;
}
