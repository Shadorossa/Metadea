// Per-list display preferences, saved as JSON in tier_lists.settings.
// Unknown or malformed values fall back to the defaults field by field, so
// an older or hand-edited row never breaks the editor.

export const THUMB_SIZES = ['small', 'medium', 'large'] as const;
export type ThumbSize = typeof THUMB_SIZES[number];

/** Tile width in CSS px; tiles are 2:3 like the covers they show. */
export const THUMB_WIDTH: Record<ThumbSize, number> = { small: 56, medium: 80, large: 112 };
export const THUMB_ASPECT = 1.5;

export interface TierSettings {
  thumbSize: ThumbSize;
  showTitles: boolean;
}

export const DEFAULT_TIER_SETTINGS: TierSettings = { thumbSize: 'medium', showTitles: false };

export function parseTierSettings(raw: unknown): TierSettings {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const thumbSize = THUMB_SIZES.includes(value.thumb_size as ThumbSize) ? value.thumb_size as ThumbSize : DEFAULT_TIER_SETTINGS.thumbSize;
  const showTitles = typeof value.show_titles === 'boolean' ? value.show_titles : DEFAULT_TIER_SETTINGS.showTitles;
  return { thumbSize, showTitles };
}

export function serializeTierSettings(settings: TierSettings): Record<string, unknown> {
  return { thumb_size: settings.thumbSize, show_titles: settings.showTitles };
}
