import { describe, expect, it } from 'vitest';
import { parseCsvRows, parseToolkittdCsv, slugFromBackloggdUrl } from './toolkittd-csv';

// Header exactly as Toolkittd's csv.ts writes it.
const HEADER = 'ID,Game Name,Played,Currently Playing,In Backlog,In Wishlist,Liked,Rating,Mastered,Start Date,Finish Date,'
  + 'Total Hours,Total Minutes,Playthrough Hours,Playthrough Minutes,Playthrough Hours to Finish,Playthrough Minutes to Finish,'
  + 'Playthrough Hours to Master,Playthrough Minutes to Master,Replay,Review,Review Contains Spoilers,Backloggd URL';

describe('parseCsvRows', () => {
  it('handles quotes, escaped quotes, embedded newlines, CRLF and a BOM', () => {
    expect(parseCsvRows('﻿a,"b, c","say ""hi""\r\nbye"\r\n\r\nx,,z')).toEqual([
      ['a', 'b, c', 'say "hi"\r\nbye'],
      ['x', '', 'z'],
    ]);
  });
});

describe('slugFromBackloggdUrl', () => {
  it.each([
    ['https://backloggd.com/games/the-witcher-3-wild-hunt/', 'the-witcher-3-wild-hunt'],
    ['https://backloggd.com/games/hades--1/', 'hades--1'],
    ['https://backloggd.com/games/celeste/?ref=x', 'celeste'],
    ['https://backloggd.com/u/someone/', null],
    ['', null],
  ])('%s', (url, slug) => {
    expect(slugFromBackloggdUrl(url)).toBe(slug);
  });
});

describe('parseToolkittdCsv', () => {
  it('reads every field a row carries', () => {
    const csv = [
      HEADER,
      '12,The Witcher 3: Wild Hunt,true,false,false,false,true,9,true,2024-01-02,2024-03-04,95,30,90,0,80,0,95,30,false,'
        + '"Great, really.",false,https://backloggd.com/games/the-witcher-3-wild-hunt/',
      '13,Hollow Knight,false,false,true,false,false,,,,,0,0,,,,,,,,,,https://backloggd.com/games/hollow-knight/',
    ].join('\n');
    expect(parseToolkittdCsv(csv)).toEqual([
      {
        name: 'The Witcher 3: Wild Hunt', slug: 'the-witcher-3-wild-hunt', played: true, playing: false, backlog: false,
        wishlist: false, liked: true, mastered: true, rating: 9, startDate: '2024-01-02', finishDate: '2024-03-04',
        minutes: 95 * 60 + 30, review: 'Great, really.',
      },
      {
        name: 'Hollow Knight', slug: 'hollow-knight', played: false, playing: false, backlog: true, wishlist: false,
        liked: false, mastered: false, rating: null, startDate: null, finishDate: null, minutes: 0, review: null,
      },
    ]);
  });

  it('rejects a file that is not a Toolkittd export', () => {
    expect(parseToolkittdCsv('title,score\nZelda,10')).toBeNull();
    expect(parseToolkittdCsv('')).toBeNull();
  });
});
