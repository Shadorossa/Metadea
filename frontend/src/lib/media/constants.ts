import type { MediaCatalogEntry } from '../tauri/catalog';

export const STAR_PATH =
  'M12 17.75l-6.172 3.245 1.179-6.873-4.993-4.867 6.9-1.002L12 2l3.086 6.253 6.9 1.002-4.993 4.867 1.179 6.873z';

// Single source of truth for every catalog field the PR editor diffs — used by
// the PR change summary, the per-field changed dots, and hasChanges().
export const DIFF_FIELDS: ReadonlyArray<readonly [keyof MediaCatalogEntry, string]> = [
  ['title_main', 'Main Title'], ['title_romaji', 'Romaji Title'], ['title_native', 'Native Title'],
  ['type', 'Type'], ['format', 'Format'],
  ['synopsis', 'Synopsis'], ['cover_url', 'Cover URL'], ['banners_csv', 'Banner URLs'],
  ['release_year', 'Release Year'], ['release_month', 'Release Month'], ['release_day', 'Release Day'],
  ['total_count', 'Episodes/Chapters'], ['total_count_2', 'Seasons/Volumes'],
  ['genres_csv', 'Genres'], ['genres_tag_csv', 'Themes/Tags'],
  ['platforms_csv', 'Platforms'],
];

// Reciprocal edge pair written for each standalone source/episode/update
// entry attached to the nearest preceding saga group.
export const REL_TYPE_TO_PAIR: Record<'source' | 'episode' | 'update', [
  { relation_type: string; type_label: string },
  { relation_type: string; type_label: string },
]> = {
  source:  [{ relation_type: 'SOURCE', type_label: 'Source Material' }, { relation_type: 'ADAPTATION', type_label: 'Adaptation' }],
  episode: [{ relation_type: 'EPISODE', type_label: 'Episode' }, { relation_type: 'PART_OF', type_label: 'Part of' }],
  update:  [{ relation_type: 'UPDATE', type_label: 'Update' }, { relation_type: 'PART_OF', type_label: 'Part of' }],
};
