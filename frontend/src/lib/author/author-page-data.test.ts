import { describe, expect, it } from 'vitest';
import type { AniListStaffDetail } from '../search/providers/anilist';
import { aniListStaffToRenderData, authorRoleLabel, buildAniListStaffWorks, openLibraryAuthorToRenderData, yearOfPublishDate } from './author-page-data';

type StaffEdge = AniListStaffDetail['staffMedia']['edges'][number];

function edge(id: number, staffRole: string, overrides: Partial<StaffEdge['node']> = {}): StaffEdge {
  return {
    staffRole,
    node: { id, type: 'MANGA', format: 'MANGA', title: { romaji: `Romaji ${id}`, english: null }, coverImage: { medium: `https://img/${id}.jpg` }, ...overrides },
  };
}

function staff(edges: StaffEdge[]): AniListStaffDetail {
  return { name: { full: 'Eiichiro Oda', native: '尾田栄一郎', alternative: ['Oda-sensei'] }, image: { large: 'https://img/oda.jpg' }, description: '<p>Bio</p>', staffMedia: { edges } };
}

describe('buildAniListStaffWorks', () => {
  it('drops music-only credits, picks the preferred real role and groups duplicate edges per media', () => {
    const works = buildAniListStaffWorks(staff([
      edge(1, 'Insert Song Lyrics ("We Are!"), Theme Song Performance'),
      edge(2, 'Chief Supervisor, Insert Song Lyrics'),
      edge(2, 'Original Creator'),
      edge(3, 'Story & Art', { type: 'MANGA', format: 'NOVEL', title: { romaji: null, english: 'Novel EN' }, coverImage: null }),
      edge(4, '', { title: { romaji: null, english: null } }),
    ]));
    expect(works).toEqual([
      { url: '/media?id=manga:2', title: 'Romaji 2', cover: 'https://img/2.jpg', role: 'Original Creator, Chief Supervisor' },
      { url: '/media?id=lnovel:3', title: 'Novel EN', cover: null, role: 'Story & Art' },
    ]);
  });

  it('prefers the english title and falls back to romaji, then empty (the view shows a placeholder)', () => {
    const works = buildAniListStaffWorks(staff([
      edge(5, 'Story', { title: { romaji: 'R', english: 'E' } }),
      edge(6, 'Art', { title: { romaji: null, english: null } }),
    ]));
    expect(works.map(w => w.title)).toEqual(['E', '']);
  });
});

describe('aniListStaffToRenderData', () => {
  it('maps the profile fields and leaves dates empty', () => {
    expect(aniListStaffToRenderData(staff([]))).toEqual({
      name: 'Eiichiro Oda',
      nameNative: '尾田栄一郎',
      aliases: ['Oda-sensei'],
      image: 'https://img/oda.jpg',
      biography: '<p>Bio</p>',
      birthDate: null,
      deathDate: null,
      works: [],
    });
  });
});

describe('openLibraryAuthorToRenderData', () => {
  it('ignores the -1 photo sentinel, unwraps an object bio and builds book cards', () => {
    expect(openLibraryAuthorToRenderData({
      name: 'J. R. R. Tolkien',
      birth_date: '3 January 1892',
      death_date: '2 September 1973',
      bio: { type: '/type/text', value: 'Philologist.' },
      photos: [-1, 6643],
      works: [
        { title: 'The Hobbit', key: '/works/OL262758W', covers: [8406786, 1] },
        { title: 'Letters', key: '/works/OL1W', covers: [] },
      ],
    })).toEqual({
      name: 'J. R. R. Tolkien',
      nameNative: null,
      aliases: [],
      image: 'https://covers.openlibrary.org/a/id/6643-L.jpg',
      biography: 'Philologist.',
      birthDate: '3 January 1892',
      deathDate: '2 September 1973',
      works: [
        { url: '/media?id=book:OL262758W', title: 'The Hobbit', cover: 'https://covers.openlibrary.org/b/id/8406786-M.jpg', role: 'AUTHOR' },
        { url: '/media?id=book:OL1W', title: 'Letters', cover: null, role: 'AUTHOR' },
      ],
    });
  });

  it('treats an all-sentinel photo list and a string bio like their plain forms', () => {
    const data = openLibraryAuthorToRenderData({ name: 'X', bio: 'Plain', photos: [-1], works: [] });
    expect(data.image).toBeNull();
    expect(data.biography).toBe('Plain');
    expect(data.birthDate).toBeNull();
  });
});

describe('authorRoleLabel', () => {
  const labels = {
    author: 'Autor', original_creator: 'Creador original', story_and_art: 'Historia y arte',
    story: 'Historia', art: 'Arte', original_story: 'Historia original', director: 'Director/a',
  };

  it('translates known credits and keeps provider-only roles verbatim', () => {
    expect(authorRoleLabel('AUTHOR', labels)).toBe('Autor');
    expect(authorRoleLabel('Original Creator, Chief Supervisor', labels)).toBe('Creador original, Chief Supervisor');
    expect(authorRoleLabel('Story & Art', labels)).toBe('Historia y arte');
    expect(authorRoleLabel('Art (eps 1-3)', labels)).toBe('Art (eps 1-3)');
  });
});

describe('timeline fields', () => {
  it('carries the AniList start year and score on the 0–10 scale', () => {
    const works = buildAniListStaffWorks(staff([edge(8, 'Story & Art', { startDate: { year: 1997 }, averageScore: 88 }), edge(9, 'Art')]));
    expect(works[0].year).toBe(1997);
    expect(works[0].score).toBe(8.8);
    expect(works[1].year).toBeUndefined();
    expect(works[1].score).toBeUndefined();
  });

  it('reads the year out of an Open Library publish date', () => {
    expect(yearOfPublishDate('September 21, 1937')).toBe(1937);
    expect(yearOfPublishDate('1954')).toBe(1954);
    expect(yearOfPublishDate('unknown')).toBeUndefined();
    expect(yearOfPublishDate(undefined)).toBeUndefined();
  });
});
