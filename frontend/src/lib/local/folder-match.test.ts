import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LocalFolderEntry } from '../tauri';
import {
  normalizeForMatch,
  isRedundantEpisodeName,
  extractTitleSeason,
  encodeExternalIdForFilename,
  findMatchingFolder,
  MEDIA_EXTENSIONS,
  hasMediaFiles,
  soleMediaFile,
  findMatchingFile,
  formatEpisodeLabel,
  cleanFilenameForDisplay,
  extractEpisodeInfo,
  findMatchingEpisodeFile,
  sanitizeForFilename,
  dirname,
  buildLocateRenamePlan,
  findTaggedPathRecursive,
  matchRelationsToFiles,
} from './folder-match';

const scanFolderContentsMock = vi.hoisted(() => vi.fn());

vi.mock('../tauri', () => ({
  scanFolderContents: scanFolderContentsMock,
}));

function file(name: string): LocalFolderEntry {
  return { name, is_dir: false, size: 1 };
}

function dir(name: string): LocalFolderEntry {
  return { name, is_dir: true, size: 0 };
}

describe('normalizeForMatch', () => {
  it('lowercases and collapses separators into single spaces', () => {
    expect(normalizeForMatch('Attack on Titan')).toBe('attack on titan');
    expect(normalizeForMatch('attack-on-titan_S1')).toBe('attack on titan s1');
    expect(normalizeForMatch('Title...')).toBe('title');
  });

  it('strips accents', () => {
    expect(normalizeForMatch('Pokémon: Édition')).toBe('pokemon edition');
  });

  it('drops non-latin text entirely', () => {
    expect(normalizeForMatch('エースをねらえ！')).toBe('');
  });

  it('returns an empty string for blank input', () => {
    expect(normalizeForMatch('')).toBe('');
    expect(normalizeForMatch('   ')).toBe('');
  });
});

describe('isRedundantEpisodeName', () => {
  it('treats an empty name as redundant', () => {
    expect(isRedundantEpisodeName('', 'Anything')).toBe(true);
    expect(isRedundantEpisodeName('!!!', 'Anything')).toBe(true);
  });

  it('matches by substring in either direction', () => {
    expect(isRedundantEpisodeName('The Big O', 'THE Big O (2003)')).toBe(true);
    expect(isRedundantEpisodeName('THE Big O (2003)', 'The Big O')).toBe(true);
  });

  it('is not redundant when no reference title overlaps', () => {
    expect(isRedundantEpisodeName('Section-9', 'Ghost in the Shell')).toBe(false);
  });

  it('ignores null, undefined and blank reference titles', () => {
    expect(isRedundantEpisodeName('Big O', null, undefined, '')).toBe(false);
    expect(isRedundantEpisodeName('Big O', null, 'The Big O')).toBe(true);
  });
});

describe('extractTitleSeason', () => {
  it('returns null for empty input', () => {
    expect(extractTitleSeason(null)).toBeNull();
    expect(extractTitleSeason(undefined)).toBeNull();
    expect(extractTitleSeason('')).toBeNull();
  });

  it('reads ordinal season and gig markers', () => {
    expect(extractTitleSeason('Ghost in the Shell: Stand Alone Complex 2nd GIG')).toBe(2);
    expect(extractTitleSeason('Attack on Titan 3rd Season')).toBe(3);
    expect(extractTitleSeason('Attack on Titan Season 4')).toBe(4);
  });

  it('reads a bare S-number marker', () => {
    expect(extractTitleSeason('Title S2')).toBe(2);
  });

  it('does not read an SxxExx episode marker as a season', () => {
    expect(extractTitleSeason('Title S01E05')).toBeNull();
  });

  it('reads a trailing installment number, including full-width digits', () => {
    expect(extractTitleSeason('Uchouten Kazoku 2')).toBe(2);
    expect(extractTitleSeason('エースをねらえ！２')).toBe(2);
    expect(extractTitleSeason('Title - 12')).toBe(12);
  });

  it('ignores trailing numbers longer than two digits', () => {
    expect(extractTitleSeason('Mob Psycho 100')).toBeNull();
    expect(extractTitleSeason('Blade Runner 2049')).toBeNull();
  });

  it('never returns zero', () => {
    expect(extractTitleSeason('Season 0')).toBeNull();
  });

  it('returns null when there is no marker at all', () => {
    expect(extractTitleSeason('Stand Alone Complex')).toBeNull();
    expect(extractTitleSeason('The Big O II')).toBeNull();
  });
});

describe('encodeExternalIdForFilename', () => {
  it('replaces every colon with a dash', () => {
    expect(encodeExternalIdForFilename('anime:123')).toBe('anime-123');
    expect(encodeExternalIdForFilename('a:b:c')).toBe('a-b-c');
    expect(encodeExternalIdForFilename('plain')).toBe('plain');
  });
});

describe('findMatchingFolder', () => {
  it('returns null when no usable title is given', () => {
    expect(findMatchingFolder([dir('Akira')], [])).toBeNull();
    expect(findMatchingFolder([dir('Akira')], ['', '!!!'])).toBeNull();
  });

  it('picks a tagged folder first regardless of its title', () => {
    const tagged = dir('whatever [anime-123]');
    expect(findMatchingFolder([dir('Akira'), tagged], ['Akira'], null, 'anime:123')).toBe(tagged);
  });

  it('ignores a tag on a file', () => {
    const entries = [file('Akira [anime-123].mkv'), dir('Akira')];
    expect(findMatchingFolder(entries, ['Akira'], null, 'anime:123')).toBe(entries[1]);
  });

  it('ignores files and prefers an exact match over a partial one', () => {
    const entries = [file('Akira'), dir('Akira 1988'), dir('Akira')];
    expect(findMatchingFolder(entries, ['Akira'])).toBe(entries[2]);
  });

  it('matches through separator and accent differences', () => {
    const entries = [dir('attack-on-titan')];
    expect(findMatchingFolder(entries, ['Attack on Titan'])).toBe(entries[0]);
  });

  it('prefers the most specific partial match so a season-1 prefix folder loses to the real season-2 one', () => {
    const entries = [dir('Stand Alone Complex'), dir('Stand Alone Complex 2nd GIG')];
    expect(findMatchingFolder(entries, ['Ghost in the Shell: Stand Alone Complex 2nd GIG'])).toBe(entries[1]);
  });

  it('favors a folder whose season marker matches the item season', () => {
    const entries = [dir('Uchouten Kazoku'), dir('Uchouten Kazoku 2')];
    expect(findMatchingFolder(entries, ['Uchouten Kazoku 2'], 2)).toBe(entries[1]);
    expect(findMatchingFolder(entries, ['Uchouten Kazoku'], 1)).toBe(entries[0]);
  });

  // The season penalty lowers the score but never rejects — when every
  // candidate conflicts, the least-bad one still comes back.
  it('still returns a conflicting-season folder when it is the only candidate', () => {
    const entries = [dir('Uchouten Kazoku 2'), dir('Uchouten Kazoku S3')];
    expect(findMatchingFolder(entries, ['Uchouten Kazoku'], 1)).toBe(entries[0]);
  });

  it('returns null when nothing overlaps', () => {
    expect(findMatchingFolder([dir('Cowboy Bebop')], ['Akira'])).toBeNull();
  });

  it('tries every candidate title', () => {
    const entries = [dir('Shingeki no Kyojin')];
    expect(findMatchingFolder(entries, ['Attack on Titan', 'Shingeki no Kyojin'])).toBe(entries[0]);
  });
});

describe('MEDIA_EXTENSIONS / hasMediaFiles / soleMediaFile', () => {
  it('recognizes video, audio, ebook and comic extensions case-insensitively', () => {
    expect(MEDIA_EXTENSIONS.test('a.mkv')).toBe(true);
    expect(MEDIA_EXTENSIONS.test('a.MKV')).toBe(true);
    expect(MEDIA_EXTENSIONS.test('a.cbz')).toBe(true);
    expect(MEDIA_EXTENSIONS.test('a.epub')).toBe(true);
    expect(MEDIA_EXTENSIONS.test('a.flac')).toBe(true);
    expect(MEDIA_EXTENSIONS.test('a.txt')).toBe(false);
    expect(MEDIA_EXTENSIONS.test('a.mkv.part')).toBe(false);
  });

  it('hasMediaFiles ignores directories even when named like media', () => {
    expect(hasMediaFiles([dir('a.mkv')])).toBe(false);
    expect(hasMediaFiles([dir('a.mkv'), file('b.txt'), file('c.mp4')])).toBe(true);
    expect(hasMediaFiles([])).toBe(false);
  });

  it('soleMediaFile returns the file only when exactly one media file exists', () => {
    const only = file('Akira.mkv');
    expect(soleMediaFile([dir('extras'), file('readme.txt'), only])).toBe(only);
    expect(soleMediaFile([only, file('Akira.mp4')])).toBeNull();
    expect(soleMediaFile([file('readme.txt')])).toBeNull();
  });
});

describe('findMatchingFile', () => {
  it('returns null when no usable title is given', () => {
    expect(findMatchingFile([file('Akira.mkv')], [])).toBeNull();
  });

  it('picks a tagged media file first, but not a tagged non-media file', () => {
    const entries = [file('Akira [anime-1].nfo'), file('Akira [anime-1].mkv'), file('Akira.mkv')];
    expect(findMatchingFile(entries, ['Nothing'], 'anime:1')).toBe(entries[1]);
  });

  it('matches a release-group filename containing the title', () => {
    const entries = [file('[Group] Akira (1988) [1080p].mkv')];
    expect(findMatchingFile(entries, ['Akira'])).toBe(entries[0]);
  });

  it('prefers the file with the least extra text', () => {
    const entries = [file('Akira - Making Of.mkv'), file('Akira.mkv')];
    expect(findMatchingFile(entries, ['Akira'])).toBe(entries[1]);
  });

  // Only "filename contains title" is checked, never the reverse.
  it('does not match when the title is longer than the filename', () => {
    expect(findMatchingFile([file('Akira.mkv')], ['Akira 1988 Remastered'])).toBeNull();
  });

  it('skips directories and non-media files', () => {
    expect(findMatchingFile([dir('Akira.mkv'), file('Akira.txt')], ['Akira'])).toBeNull();
  });
});

describe('formatEpisodeLabel', () => {
  it('defaults the season to 1 and zero-pads both numbers', () => {
    expect(formatEpisodeLabel(null, 5)).toBe('S01E05');
    expect(formatEpisodeLabel(2, 12)).toBe('S02E12');
    expect(formatEpisodeLabel(1, 123)).toBe('S01E123');
  });

  it('uses volume labels for books, manga and light novels', () => {
    expect(formatEpisodeLabel(null, 3, 'manga')).toBe('Vol.03');
    expect(formatEpisodeLabel(null, 3, 'lnovel')).toBe('Vol.03');
    expect(formatEpisodeLabel(null, 3, 'book')).toBe('Vol.03');
  });

  it('uses issue numbers for comics', () => {
    expect(formatEpisodeLabel(null, 7, 'comic')).toBe('No.07');
  });

  it('returns an empty label for movies', () => {
    expect(formatEpisodeLabel(null, 1, 'movie')).toBe('');
  });

  it('falls back to SxxExx for any other media type', () => {
    expect(formatEpisodeLabel(null, 1, 'anime')).toBe('S01E01');
    expect(formatEpisodeLabel(3, 1, 'tv')).toBe('S03E01');
  });
});

describe('cleanFilenameForDisplay', () => {
  it('drops bracketed groups, extension and trailing separators', () => {
    expect(cleanFilenameForDisplay('[Group] Title - 03 (1080p).mkv')).toBe('Title - 03');
  });

  it('cuts everything from the first quality tag onward', () => {
    expect(cleanFilenameForDisplay('Title.2019.1080p.BluRay.x264.mkv')).toBe('Title.2019');
  });

  it('strips a leading bare number', () => {
    expect(cleanFilenameForDisplay('01 - Eizouken - S01E01 1080p x264.mkv')).toBe('Eizouken - S01E01');
  });

  it('strips a leading episode, volume, issue or tomo marker', () => {
    expect(cleanFilenameForDisplay('S01E01 - Title.mkv')).toBe('Title');
    expect(cleanFilenameForDisplay('Vol. 3 - Title.cbz')).toBe('Title');
    expect(cleanFilenameForDisplay('No.12 Title.cbr')).toBe('Title');
    expect(cleanFilenameForDisplay('Tomo 2_Title.cbz')).toBe('Title');
  });

  it('handles trailing dots and empty input', () => {
    expect(cleanFilenameForDisplay('Title...')).toBe('Title');
    expect(cleanFilenameForDisplay('')).toBe('');
  });
});

describe('extractEpisodeInfo', () => {
  it('returns null when nothing numeric is present', () => {
    expect(extractEpisodeInfo('')).toBeNull();
    expect(extractEpisodeInfo('Akira.mkv')).toBeNull();
    expect(extractEpisodeInfo('Movie [1080p].mkv')).toBeNull();
  });

  it('reads a bare trailing number from a release-group filename', () => {
    expect(extractEpisodeInfo('[Group] Title - 03 (1080p).mkv')).toEqual({ season: null, episode: 3, episodeTitle: 'Title' });
  });

  it('reads SxxExx and NxNN season markers', () => {
    expect(extractEpisodeInfo('Title S02E05.mkv')).toEqual({ season: 2, episode: 5, episodeTitle: 'Title' });
    expect(extractEpisodeInfo('Title 1x05.mkv')).toEqual({ season: 1, episode: 5, episodeTitle: 'Title' });
  });

  it('uses the text after the marker as the episode title', () => {
    expect(extractEpisodeInfo('Ghost in the Shell (S.A.C) - S01 E01 - SA - Section-9 (1080p - DUAL Audio).mkv'))
      .toEqual({ season: 1, episode: 1, episodeTitle: 'SA - Section-9' });
  });

  it('strips a leading bare number from the before-text fallback', () => {
    expect(extractEpisodeInfo('1 - Eizouken ni wa Te wo Dasu na! - S01E01.mkv'))
      .toEqual({ season: 1, episode: 1, episodeTitle: 'Eizouken ni wa Te wo Dasu na!' });
  });

  it('drops a release revision marker before parsing', () => {
    expect(extractEpisodeInfo('Title - S01E04v2.mkv')).toEqual({ season: 1, episode: 4, episodeTitle: 'Title' });
  });

  it('keeps a standalone bracketed number as the episode', () => {
    expect(extractEpisodeInfo('[Shin Ace o Nerae!][01][BDRIP][1080p].mkv')).toEqual({ season: null, episode: 1, episodeTitle: null });
  });

  it('reads explicit episode, capitulo, chapter and volume markers', () => {
    expect(extractEpisodeInfo('Title - Episode 12.mkv')).toEqual({ season: null, episode: 12, episodeTitle: 'Title' });
    expect(extractEpisodeInfo('Title - Capitulo 4.mkv')).toEqual({ season: null, episode: 4, episodeTitle: 'Title' });
    expect(extractEpisodeInfo('Title Vol.3 Ch.12.cbz')).toEqual({ season: null, episode: 12, episodeTitle: 'Title Vol.3' });
    expect(extractEpisodeInfo('Title v03.cbz')).toEqual({ season: null, episode: 3, episodeTitle: 'Title' });
    expect(extractEpisodeInfo('Title Tomo 5.cbz')).toEqual({ season: null, episode: 5, episodeTitle: 'Title' });
    expect(extractEpisodeInfo('Title No.8.cbr')).toEqual({ season: null, episode: 8, episodeTitle: 'Title' });
  });

  // Markers only allow ONE separator between keyword and number, so
  // "Vol. 3" / "Ch. 12" / "No. 8" (dot + space) are not recognized as such.
  it('falls back to the last standalone number when marker separators are doubled', () => {
    expect(extractEpisodeInfo('Title Vol. 3 Ch. 12.cbz')).toEqual({ season: null, episode: 12, episodeTitle: 'Title Vol. 3 Ch' });
    expect(extractEpisodeInfo('Title No. 8.cbr')).toEqual({ season: null, episode: 8, episodeTitle: 'Title No' });
  });

  it('does not recognize a bare "c" chapter prefix', () => {
    expect(extractEpisodeInfo('Title c012.cbz')).toBeNull();
  });

  it('reads OVA, SP and decimal special markers', () => {
    expect(extractEpisodeInfo('Title OVA 2.mkv')).toEqual({ season: null, episode: 2, episodeTitle: 'Title' });
    expect(extractEpisodeInfo('Title SP1.mkv')).toEqual({ season: null, episode: 1, episodeTitle: 'Title' });
    expect(extractEpisodeInfo('Title #0.8.mkv')).toEqual({ season: null, episode: 0.8, episodeTitle: 'Title' });
  });

  it('never treats the trailing "e" of a title word as an episode marker', () => {
    expect(extractEpisodeInfo('Title 03.mkv')).toEqual({ season: null, episode: 3, episodeTitle: 'Title' });
    expect(extractEpisodeInfo('One Piece 1015.mkv')).toEqual({ season: null, episode: 1015, episodeTitle: 'One Piece' });
  });

  it('never treats a title ending in ch/cap/sp/ova as an episode marker', () => {
    expect(extractEpisodeInfo('Bleach 3.mkv')).toEqual({ season: null, episode: 3, episodeTitle: 'Bleach' });
    expect(extractEpisodeInfo('Handicap 2.mkv')).toEqual({ season: null, episode: 2, episodeTitle: 'Handicap' });
    expect(extractEpisodeInfo('Wasp 4.mkv')).toEqual({ season: null, episode: 4, episodeTitle: 'Wasp' });
    expect(extractEpisodeInfo('Nova 5.mkv')).toEqual({ season: null, episode: 5, episodeTitle: 'Nova' });
    expect(extractEpisodeInfo('Bleach ch03.mkv')).toEqual({ season: null, episode: 3, episodeTitle: 'Bleach' });
  });

  it('still reads the E marker as a standalone token', () => {
    expect(extractEpisodeInfo('Title E01.mkv')).toEqual({ season: null, episode: 1, episodeTitle: 'Title' });
    expect(extractEpisodeInfo('Title - E1.mkv')).toEqual({ season: null, episode: 1, episodeTitle: 'Title' });
    expect(extractEpisodeInfo('Title.E07.mkv')).toEqual({ season: null, episode: 7, episodeTitle: 'Title' });
    expect(extractEpisodeInfo('E12.mkv')).toEqual({ season: null, episode: 12, episodeTitle: null });
  });

  it('never reads digits glued to letters as an episode', () => {
    expect(extractEpisodeInfo('Title NCED1.mkv')).toBeNull();
  });

  it('prefers a non-resolution number in the last-resort scan', () => {
    expect(extractEpisodeInfo('Akira - 1988 - 1080p.mkv')).toEqual({ season: null, episode: 1988, episodeTitle: null });
    expect(extractEpisodeInfo('Akira 1080 1988 x.mkv')).toEqual({ season: null, episode: 1988, episodeTitle: null });
  });

  it('falls back to a resolution number when it is the only standalone one', () => {
    expect(extractEpisodeInfo('Show 720 x264.mkv')).toEqual({ season: null, episode: 720, episodeTitle: null });
  });

  it('ignores a resolution number glued to its unit', () => {
    expect(extractEpisodeInfo('Show 720p.mkv')).toBeNull();
  });

  it('keeps quality tags after the marker as the episode title', () => {
    expect(extractEpisodeInfo('Title.S01E05.720p.mkv')).toEqual({ season: 1, episode: 5, episodeTitle: '720p' });
  });
});

describe('findMatchingEpisodeFile', () => {
  const s1 = (n: number) => file(`Title - S01E${String(n).padStart(2, '0')}.mkv`);
  const s2 = (n: number) => file(`Title - S02E${String(n).padStart(2, '0')}.mkv`);
  const bare = (n: number) => file(`Title - ${String(n).padStart(2, '0')}.mkv`);

  it('finds a bare-numbered episode', () => {
    const entries = [bare(1), bare(2), file('readme.txt'), dir('03')];
    expect(findMatchingEpisodeFile(entries, 2)).toBe(entries[1]);
    expect(findMatchingEpisodeFile(entries, 3)).toBeNull();
  });

  it('picks the file whose season marker matches the item season', () => {
    const entries = [s1(1), s2(1)];
    expect(findMatchingEpisodeFile(entries, 1, 2)).toBe(entries[1]);
    expect(findMatchingEpisodeFile(entries, 1, 1)).toBe(entries[0]);
  });

  it('rejects a season-marked folder that lacks the wanted season', () => {
    expect(findMatchingEpisodeFile([s1(1), s1(2)], 1, 2)).toBeNull();
  });

  it('accepts an unmarked file for season 1 when the folder has markers', () => {
    const entries = [s1(2), bare(3)];
    expect(findMatchingEpisodeFile(entries, 3, 1)).toBe(entries[1]);
    expect(findMatchingEpisodeFile(entries, 3, 2)).toBeNull();
  });

  it('ignores the item season entirely for a bare continuously-numbered folder', () => {
    const entries = [bare(13), bare(14)];
    expect(findMatchingEpisodeFile(entries, 14, 2)).toBe(entries[1]);
  });

  it('translates an absolute number across season sizes when no season is given', () => {
    const entries = [s1(1), s1(2), s1(3), s2(1), s2(2)];
    expect(findMatchingEpisodeFile(entries, 5)).toBe(entries[4]);
    expect(findMatchingEpisodeFile(entries, 2)).toBe(entries[1]);
    expect(findMatchingEpisodeFile(entries, 9)).toBeNull();
  });

  it('falls back to any direct match when the season chain has a gap', () => {
    const entries = [file('Title S03E02.mkv')];
    expect(findMatchingEpisodeFile(entries, 2)).toBe(entries[0]);
  });
});

describe('sanitizeForFilename', () => {
  it('removes filesystem-illegal characters and brackets, collapsing whitespace', () => {
    expect(sanitizeForFilename('Re:Zero [2016] "Test"?')).toBe('ReZero 2016 Test');
    expect(sanitizeForFilename('a / b \\ c * d | e < f > g')).toBe('a b c d e f g');
  });

  it('keeps punctuation that is legal on Windows', () => {
    expect(sanitizeForFilename("Eizouken ni wa Te wo Dasu na! - Part 1's")).toBe("Eizouken ni wa Te wo Dasu na! - Part 1's");
  });
});

describe('dirname', () => {
  it('removes the last segment for either slash style', () => {
    expect(dirname('C:/a/b/c')).toBe('C:/a/b');
    expect(dirname('C:\\a\\b\\c')).toBe('C:\\a\\b');
    expect(dirname('/home/user/x')).toBe('/home/user');
  });

  it('ignores trailing slashes', () => {
    expect(dirname('C:/a/b/')).toBe('C:/a');
    expect(dirname('C:\\a\\b\\\\')).toBe('C:\\a');
  });

  it('returns an empty string when there is no separator', () => {
    expect(dirname('file')).toBe('');
    expect(dirname('')).toBe('');
  });
});

describe('buildLocateRenamePlan', () => {
  it('renames each numbered media file to SxxExx - Title and tags the folder', () => {
    const entries = [file('Title - 01.mkv'), file('Title - 02.mkv'), file('readme.txt'), dir('extras')];
    const plan = buildLocateRenamePlan(entries, 'Title', 'anime:1', null);
    expect(plan.fileRenames).toEqual([
      { entry: entries[0], newName: 'S01E01 - Title.mkv' },
      { entry: entries[1], newName: 'S01E02 - Title.mkv' },
    ]);
    expect(plan.folderNewName).toBe('Title [anime-1]');
  });

  it('uses the caller-resolved season for unmarked files', () => {
    const plan = buildLocateRenamePlan([file('Title - 01.mkv')], 'Title', 'anime:1', 2);
    expect(plan.fileRenames[0].newName).toBe('S02E01 - Title.mkv');
  });

  it('sorts files naturally so 2 comes before 10', () => {
    const entries = [file('Title - 10.mkv'), file('Title - 2.mkv')];
    const plan = buildLocateRenamePlan(entries, 'Title', 'anime:1', null);
    expect(plan.fileRenames.map(r => r.newName)).toEqual(['S01E02 - Title.mkv', 'S01E10 - Title.mkv']);
  });

  it('skips openings, endings and files with no episode number', () => {
    const entries = [
      file('Title NCOP1.mkv'), file('Title - OP.mkv'), file('Title Ending.mkv'), file('Title NCED.mkv'),
      file('Title - PV.mkv'), file('Title - 01.mkv'),
    ];
    const plan = buildLocateRenamePlan(entries, 'Title', 'anime:1', null);
    expect(plan.fileRenames.map(r => r.entry.name)).toEqual(['Title - 01.mkv']);
  });

  it('keeps an episode title found in the filename', () => {
    const plan = buildLocateRenamePlan([file('Title - S01E01 - Pilot.mkv')], 'Title', 'anime:1', 1);
    expect(plan.fileRenames[0].newName).toBe('S01E01 - Pilot - Title.mkv');
  });

  it('prefers a fetched episode name over the filename text and sanitizes it', () => {
    const names = { 'anime:1': new Map([[1, 'Pilot: Part 1?']]) };
    const plan = buildLocateRenamePlan([file('Title - S01E01 - Other.mkv')], 'Title', 'anime:1', 1, undefined, undefined, names);
    expect(plan.fileRenames[0].newName).toBe('S01E01 - Pilot Part 1 - Title.mkv');
  });

  it('drops a fetched episode name that just repeats the work title', () => {
    const names = { 'anime:1': new Map([[1, 'The Title']]) };
    const plan = buildLocateRenamePlan([file('Title - 01.mkv')], 'Title', 'anime:1', 1, undefined, undefined, names);
    expect(plan.fileRenames[0].newName).toBe('S01E01 - Title.mkv');
  });

  it('never writes an episode title for light novels or books', () => {
    const plan = buildLocateRenamePlan([file('Title - 01 - Chapter Name.epub')], 'Title', 'lnovel:1', null);
    expect(plan.fileRenames[0].newName).toBe('Vol.01 - Title.epub');
  });

  it('derives the label style from the external id type when no media type is given', () => {
    expect(buildLocateRenamePlan([file('T - 01.cbz')], 'T', 'comic:5', null).fileRenames[0].newName).toBe('No.01 - T.cbz');
    expect(buildLocateRenamePlan([file('T - 01.cbz')], 'T', 'manga:5', null).fileRenames[0].newName).toBe('Vol.01 - T.cbz');
    expect(buildLocateRenamePlan([file('T - 1.mkv')], 'T', 'movie:5', null).fileRenames[0].newName).toBe('T.mkv');
  });

  it('lets an explicit media type override the external id type', () => {
    const plan = buildLocateRenamePlan([file('T - 01.cbz')], 'T', 'comic:5', null, undefined, 'manga');
    expect(plan.fileRenames[0].newName).toBe('Vol.01 - T.cbz');
  });

  it('suffixes duplicate target names', () => {
    const entries = [file('Title - 01.mkv'), file('Title - 01 (2).mkv')];
    const plan = buildLocateRenamePlan(entries, 'Title', 'anime:1', null);
    expect(plan.fileRenames.map(r => r.newName)).toEqual(['S01E01 - Title.mkv', 'S01E01 - Title (2).mkv']);
  });

  it('sanitizes the work title in file and folder names', () => {
    const plan = buildLocateRenamePlan([file('ReZero - 01.mkv')], 'Re:Zero [2016]', 'anime:1', null);
    expect(plan.fileRenames[0].newName).toBe('S01E01 - ReZero 2016.mkv');
    expect(plan.folderNewName).toBe('ReZero 2016 [anime-1]');
  });

  it('tags season-marked files with the catalog entry from the season map', () => {
    const entries = [file('Stand Alone Complex - S01E01.mkv'), file('Stand Alone Complex - S02E01.mkv')];
    const seasonMap = {
      1: { externalId: 'anime:467', title: 'Ghost in the Shell: Stand Alone Complex' },
      2: { externalId: 'anime:801', title: 'Ghost in the Shell: Stand Alone Complex 2nd GIG' },
    };
    const plan = buildLocateRenamePlan(entries, 'Ghost in the Shell: Stand Alone Complex', 'anime:467', 1, seasonMap);
    expect(plan.fileRenames.map(r => r.newName)).toEqual([
      'S01E01 - Ghost in the Shell Stand Alone Complex.mkv',
      'S02E01 - Ghost in the Shell Stand Alone Complex 2nd GIG.mkv',
    ]);
    expect(plan.folderNewName).toBe('Ghost in the Shell Stand Alone Complex [anime-467] [anime-801]');
  });

  it('resolves a season from a native-title alias, preferring the longest alias', () => {
    const entries = [file('エースをねらえ！ - 01.mkv'), file('エースをねらえ！２ - 01.mkv')];
    const seasonMap = {
      1: { externalId: 'anime:1', title: 'Ace wo Nerae!', aliases: ['エースをねらえ！'] },
      2: { externalId: 'anime:2', title: 'Shin Ace wo Nerae!', aliases: ['エースをねらえ！２'] },
    };
    const plan = buildLocateRenamePlan(entries, 'Ace wo Nerae!', 'anime:1', 1, seasonMap);
    expect(plan.fileRenames.map(r => r.newName)).toEqual([
      'S01E01 - Ace wo Nerae!.mkv',
      'S02E01 - Shin Ace wo Nerae!.mkv',
    ]);
    expect(plan.folderNewName).toBe('Ace wo Nerae! [anime-1] [anime-2]');
  });

  it('treats "wo" and "o" as the same particle when matching aliases', () => {
    const seasonMap = { 2: { externalId: 'anime:2', title: 'Shin Ace o Nerae!' } };
    const plan = buildLocateRenamePlan([file('Shin Ace wo Nerae! - 01.mkv')], 'Ace wo Nerae!', 'anime:1', 1, seasonMap);
    expect(plan.fileRenames[0].newName).toBe('S02E01 - Shin Ace o Nerae!.mkv');
  });

  it('falls back to the caller season when two aliases of equal length tie', () => {
    const seasonMap = {
      1: { externalId: 'anime:1', title: 'AAAAA' },
      2: { externalId: 'anime:2', title: 'BBBBB' },
    };
    const plan = buildLocateRenamePlan([file('AAAAA BBBBB - 01.mkv')], 'Work', 'anime:9', 3, seasonMap);
    expect(plan.fileRenames[0].newName).toBe('S03E01 - AAAAA BBBBB - Work.mkv');
  });

  it('ignores aliases shorter than five characters', () => {
    const seasonMap = { 2: { externalId: 'anime:2', title: 'Two' } };
    const plan = buildLocateRenamePlan([file('Two - 01.mkv')], 'Work', 'anime:1', 1, seasonMap);
    expect(plan.fileRenames[0].newName).toBe('S01E01 - Two - Work.mkv');
  });

  it('lets an explicit season marker win over a title alias', () => {
    const seasonMap = { 2: { externalId: 'anime:2', title: 'Second Work' } };
    const plan = buildLocateRenamePlan([file('Second Work - S01E01.mkv')], 'Work', 'anime:1', 1, seasonMap);
    expect(plan.fileRenames[0].newName).toBe('S01E01 - Work.mkv');
    expect(plan.folderNewName).toBe('Work [anime-1]');
  });

  it('slices a bare continuous run into seasons by episode counts and drops the overflow', () => {
    const entries = [1, 2, 3, 4, 5].map(n => file(`Title - ${String(n).padStart(2, '0')}.mkv`));
    const seasonMap = { 2: { externalId: 'anime:2', title: 'Title 2' } };
    const plan = buildLocateRenamePlan(entries, 'Title', 'anime:1', 1, seasonMap, undefined, undefined, { 1: 2, 2: 2 });
    expect(plan.fileRenames.map(r => r.newName)).toEqual([
      'S01E01 - Title.mkv',
      'S01E02 - Title.mkv',
      'S02E01 - Title 2.mkv',
      'S02E02 - Title 2.mkv',
    ]);
  });

  it('stops slicing at the first season with no known count', () => {
    const entries = [1, 2, 3].map(n => file(`Title - ${String(n).padStart(2, '0')}.mkv`));
    const plan = buildLocateRenamePlan(entries, 'Title', 'anime:1', 1, undefined, undefined, undefined, { 1: 2, 2: 0, 3: 5 });
    expect(plan.fileRenames.map(r => r.newName)).toEqual(['S01E01 - Title.mkv', 'S01E02 - Title.mkv']);
  });

  it('caps a season-marked folder at each season\'s own length', () => {
    const entries = [file('T - S01E01.mkv'), file('T - S01E02.mkv'), file('T - S01E03.mkv')];
    const plan = buildLocateRenamePlan(entries, 'T', 'anime:1', 1, undefined, undefined, undefined, { 1: 2 });
    expect(plan.fileRenames.map(r => r.newName)).toEqual(['S01E01 - T.mkv', 'S01E02 - T.mkv']);
  });

  it('rounds a decimal special number', () => {
    const plan = buildLocateRenamePlan([file('T #0.8.mkv')], 'T', 'anime:1', 1);
    expect(plan.fileRenames[0].newName).toBe('S01E01 - T.mkv');
  });

  it('returns an empty plan for an empty folder', () => {
    expect(buildLocateRenamePlan([], 'T', 'anime:1', null)).toEqual({ fileRenames: [], folderNewName: 'T [anime-1]' });
  });
});

describe('findTaggedPathRecursive', () => {
  beforeEach(() => {
    scanFolderContentsMock.mockReset();
  });

  it('returns a directly tagged entry at the root', async () => {
    scanFolderContentsMock.mockResolvedValue([file('Akira [anime-1].mkv')]);
    await expect(findTaggedPathRecursive('/root', 'anime:1')).resolves.toEqual({ absPath: '/root/Akira [anime-1].mkv', isDir: false });
    expect(scanFolderContentsMock).toHaveBeenCalledTimes(1);
  });

  it('descends into subfolders up to maxDepth', async () => {
    const tree: Record<string, LocalFolderEntry[]> = {
      '/root': [dir('Koukaku Kidoutai'), file('other.mkv')],
      '/root/Koukaku Kidoutai': [dir('b. STAND Alone COMPLEX (2002-06) [anime-467]')],
    };
    scanFolderContentsMock.mockImplementation(async (p: string) => tree[p] ?? []);
    await expect(findTaggedPathRecursive('/root', 'anime:467')).resolves.toEqual({
      absPath: '/root/Koukaku Kidoutai/b. STAND Alone COMPLEX (2002-06) [anime-467]',
      isDir: true,
    });
  });

  it('stops at maxDepth', async () => {
    const tree: Record<string, LocalFolderEntry[]> = {
      '/root': [dir('a')],
      '/root/a': [dir('b')],
      '/root/a/b': [file('x [anime-1].mkv')],
    };
    scanFolderContentsMock.mockImplementation(async (p: string) => tree[p] ?? []);
    await expect(findTaggedPathRecursive('/root', 'anime:1', 1)).resolves.toBeNull();
    await expect(findTaggedPathRecursive('/root', 'anime:1', 2)).resolves.toEqual({ absPath: '/root/a/b/x [anime-1].mkv', isDir: false });
  });

  it('treats a scan failure as an empty folder', async () => {
    scanFolderContentsMock.mockRejectedValue(new Error('denied'));
    await expect(findTaggedPathRecursive('/root', 'anime:1')).resolves.toBeNull();
  });
});

describe('matchRelationsToFiles', () => {
  const group = (containerPath: string, ...names: string[]) => ({ containerPath, entries: names.map(file) });

  it('matches a relation title against a candidate file and builds a tagged name', () => {
    const relations = [{ related_media_external_id: 'anime:43', title: 'Ghost in the Shell' }];
    const groups = [group('/root/movies', 'Innocence.mkv', 'Ghost in the Shell (1995).mkv')];
    const result = matchRelationsToFiles(relations, groups);
    expect(result).toEqual([{
      relatedExternalId: 'anime:43',
      relatedTitle: 'Ghost in the Shell',
      containerPath: '/root/movies',
      entry: groups[0].entries[1],
      newName: 'S01E01 - Ghost in the Shell [anime-43].mkv',
    }]);
  });

  it('omits the episode label for movie ids', () => {
    const relations = [{ related_media_external_id: 'movie:43', title: 'Ghost in the Shell' }];
    const result = matchRelationsToFiles(relations, [group('/m', 'Ghost in the Shell.mkv')]);
    expect(result[0].newName).toBe('Ghost in the Shell [movie-43].mkv');
  });

  it('sanitizes the relation title in the new name', () => {
    const relations = [{ related_media_external_id: 'movie:1', title: 'Ghost in the Shell: Innocence' }];
    const result = matchRelationsToFiles(relations, [group('/m', 'Ghost in the Shell Innocence.mkv')]);
    expect(result[0].newName).toBe('Ghost in the Shell Innocence [movie-1].mkv');
  });

  it('rejects a match below minScore', () => {
    const relations = [{ related_media_external_id: 'movie:1', title: 'Akira' }];
    const groups = [group('/m', 'Akira Production Report Documentary Extended Cut Remastered.mkv')];
    expect(matchRelationsToFiles(relations, groups)).toEqual([]);
    expect(matchRelationsToFiles(relations, [group('/m', 'Akira.mkv')], 60)).toEqual([]);
  });

  it('never reuses a file for two relations', () => {
    const relations = [
      { related_media_external_id: 'movie:1', title: 'Innocence' },
      { related_media_external_id: 'movie:2', title: 'Innocence' },
    ];
    const result = matchRelationsToFiles(relations, [group('/m', 'Innocence.mkv')]);
    expect(result.map(r => r.relatedExternalId)).toEqual(['movie:1']);
  });

  it('skips relations with a blank title and non-media candidates', () => {
    const relations = [{ related_media_external_id: 'movie:1', title: '!!!' }, { related_media_external_id: 'movie:2', title: 'Akira' }];
    const groups = [{ containerPath: '/m', entries: [dir('Akira.mkv'), file('Akira.nfo')] }];
    expect(matchRelationsToFiles(relations, groups)).toEqual([]);
  });

  it('picks the best-scoring file across groups', () => {
    const relations = [{ related_media_external_id: 'movie:1', title: 'Akira' }];
    const groups = [group('/a', 'Akira Extras.mkv'), group('/b', 'Akira.mkv')];
    const result = matchRelationsToFiles(relations, groups);
    expect(result[0].containerPath).toBe('/b');
  });
});
