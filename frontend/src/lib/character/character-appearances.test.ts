import { describe, expect, it } from 'vitest';
import { es } from '../../i18n/es';
import type { AniListCharacterDetail } from '../search/providers/anilist';
import {
  APPEARANCES_PER_PAGE,
  appearancesPageSlice,
  appearancesTotalPages,
  buildAniListMediaCache,
  mergeAppearanceRows,
  resolveMergedAppearance,
  sortAppearances,
} from './character-appearances';
import { buildRoleLabels } from './character-stat-labels';

type Edge = AniListCharacterDetail['media']['edges'][number];

const edges: Edge[] = [
  { characterRole: 'MAIN', node: { id: 1, title: { userPreferred: 'One Piece' }, coverImage: { large: 'https://img/1.jpg' }, type: 'ANIME', format: 'TV', startDate: { year: 1999, month: 10, day: 20 } } },
  { characterRole: 'SUPPORTING', node: { id: 2, title: { userPreferred: 'Novel' }, coverImage: { large: 'https://img/2.jpg' }, type: 'MANGA', format: 'NOVEL', startDate: null } },
];

describe('buildAniListMediaCache', () => {
  it('keys light novels as lnovel: and keeps role/date/cover per edge', () => {
    expect(buildAniListMediaCache(edges)).toEqual({
      'anime:1': { title: 'One Piece', cover: 'https://img/1.jpg', year: 1999, month: 10, day: 20, role: 'MAIN' },
      'lnovel:2': { title: 'Novel', cover: 'https://img/2.jpg', year: null, month: null, day: null, role: 'SUPPORTING' },
    });
  });
});

describe('mergeAppearanceRows', () => {
  it('keeps local rows first and only adds AniList edges not known locally', () => {
    const { union, newFromAniList } = mergeAppearanceRows([{ media_external_id: 'anime:1', relation_type: 'CAMEO' }], edges);
    expect(newFromAniList).toEqual([
      { media_external_id: 'lnovel:2', relation_type: 'SUPPORTING', character_name: null, title: 'Novel', cover: 'https://img/2.jpg' },
    ]);
    expect(union.map(a => a.media_external_id)).toEqual(['anime:1', 'lnovel:2']);
    expect(union[0].relation_type).toBe('CAMEO');
  });
});

describe('resolveMergedAppearance', () => {
  const roleLabels = buildRoleLabels(es.character);
  const cache = buildAniListMediaCache(edges);

  it('prefers the catalog entry, then the AniList cache, then the raw id', () => {
    expect(resolveMergedAppearance(
      { media_external_id: 'anime:1', relation_type: null },
      { title_main: 'ONE PIECE', cover_url: null, release_year: 2000, release_month: null, release_day: null },
      cache['anime:1'],
      roleLabels,
    )).toEqual({ mediaId: 'anime:1', title: 'ONE PIECE', cover: 'https://img/1.jpg', year: 2000, month: 10, day: 20, roleLabel: es.character.role_main });

    expect(resolveMergedAppearance({ media_external_id: 'manga:9', relation_type: 'NARRATOR' }, null, undefined, roleLabels))
      .toEqual({ mediaId: 'manga:9', title: 'manga:9', cover: null, year: null, month: null, day: null, roleLabel: 'NARRATOR' });
  });
});

describe('sorting and pagination', () => {
  it('sorts by release date then title, undated last', () => {
    const sorted = sortAppearances([
      { mediaId: 'c', title: 'C', cover: null, year: null, month: null, day: null, roleLabel: '' },
      { mediaId: 'b', title: 'B', cover: null, year: 2001, month: 1, day: 1, roleLabel: '' },
      { mediaId: 'a', title: 'A', cover: null, year: 2001, month: 1, day: 1, roleLabel: '' },
    ]);
    expect(sorted.map(a => a.mediaId)).toEqual(['a', 'b', 'c']);
  });

  it('pages eight at a time', () => {
    const list = Array.from({ length: 17 }, (_, i) => i);
    expect(APPEARANCES_PER_PAGE).toBe(8);
    expect(appearancesTotalPages(17)).toBe(3);
    expect(appearancesTotalPages(0)).toBe(0);
    expect(appearancesPageSlice(list, 3)).toEqual([16]);
  });
});
