import { describe, expect, it } from 'vitest';
import { htmlToLines, parseChapterNumbers, parseIssueNumber } from './comicvine-chapters';

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe('parseChapterNumbers', () => {
  it.each<[string, string | null, number[]]>([
    ['"Chapter N: Title" list (Bleach vol. 21 shape)',
      '<p>Ichigo returns to the human world...</p><h4>Chapters</h4><ul><li>Chapter 182: Be My Family or Not</li><li>Chapter 183: Surprise Attack</li><li>Chapter 184: Deathberry Returns</li></ul>', [182, 183, 184]],
    ['table with a Chapter column ignores other numeric columns',
      '<table><thead><tr><th>Chapter</th><th>Title</th><th>Pages</th></tr></thead><tbody><tr><td>191</td><td>Conquistadores</td><td>19</td></tr><tr><td>192</td><td>The Toxic Invasion</td><td>21</td></tr></tbody></table>', [191, 192]],
    ['table whose chapter column is "#" and a range cell',
      '<table><tr><th>#</th><th>Name</th></tr><tr><td>10</td><td>A</td></tr><tr><td>11-12</td><td>B</td></tr></table>', [10, 11, 12]],
    ['ignores a table without a chapter column',
      '<table><tr><th>Year</th><th>Sales</th></tr><tr><td>2007</td><td>500</td></tr></table>', []],
    ['abbreviations: "Ch. 188", "Ch 189", "Chp. 190", "Chap. 191"',
      '<ul><li>Ch. 188 - Title</li><li>Ch 189</li><li>Chp. 190</li><li>Chap. 191</li></ul>', [188, 189, 190, 191]],
    ['"#N" list items', '<ul><li>#189 The Fallen</li><li>#190: Next</li></ul>', [189, 190]],
    ['not a "#N" inside prose', '<p>Collects issue #5 of the magazine run.</p>', []],
    ['hyphen range', 'Chapters 190-198', range(190, 198)],
    ['en dash entity range', '<p>Includes chapters 179&ndash;187.</p>', range(179, 187)],
    ['en dash range', 'Includes chapters 179–187', range(179, 187)],
    ['"to" range', 'Collects chapters 10 to 12', [10, 11, 12]],
    ['"through" range', 'Collects chapters 10 through 12', [10, 11, 12]],
    ['completes an abbreviated range end ("190-98")', 'Chapters 190-98', range(190, 198)],
    ['comma/and list mixing single chapters and ranges', 'Chapters 1, 2 and 5-7', [1, 2, 5, 6, 7]],
    ['"&" list', 'chapters 3 & 4', [3, 4]],
    ['Spanish "Capítulo N"', 'Capítulo 12: El regreso', [12]],
    ['Spanish "Capitulos N a M"', 'Capitulos 1 a 9', range(1, 9)],
    ['Spanish "capítulos N al M y K"', 'Incluye los capítulos 20 al 22 y 25', [20, 21, 22, 25]],
    ['Spanish "Cap. N"', 'Cap. 7', [7]],
    ['French "Chapitres N à M"', 'Chapitres 3 à 5', [3, 4, 5]],
    ['German "Kapitel N"', 'Kapitel 8', [8]],
    ['Italian "Capitoli N-M"', 'Capitoli 1-2', [1, 2]],
    ['Japanese 第N話', '<p>第182話 ビー・マイ・ファミリー</p><p>第183話</p>', [182, 183]],
    ['keeps half chapters', '<li>Chapter 187.5: Omake</li><li>Chapter 188</li>', [187.5, 188]],
    ['numbered lines under a chapters heading',
      '<h3>Chapter Titles</h3><p>182. Be My Family or Not<br>183. Surprise Attack</p><h3>Trivia</h3><p>2007. A year.</p>', [182, 183]],
    ['no numbered lines without a chapters heading', '<p>182. Be My Family or Not</p>', []],
    ['never reads bare numbers in prose',
      '<p>Released in 2007 with 200 pages. Each chapter is great; 15 characters appear.</p>', []],
    ['sorts and de-duplicates across formats',
      '<p>Includes chapters 190-192.</p><ul><li>Chapter 192: X</li><li>Chapter 189: Y</li></ul>', [189, 190, 191, 192]],
    ['refuses absurd spans instead of expanding them', 'Chapters 1-5000', [1]],
    ['returns nothing for a null description', null, []],
    ['returns nothing for an empty description', '', []],
  ])('%s', (_name, html, expected) => {
    expect(parseChapterNumbers(html)).toEqual(expected);
  });
});

describe('htmlToLines', () => {
  it('splits block elements and decodes entities', () => {
    expect(htmlToLines('<p>A &amp; B</p><ul><li>C&#8211;D</li></ul>line<br/>two')).toEqual(['A & B', 'C–D', 'line', 'two']);
  });
});

describe('parseIssueNumber', () => {
  it('parses numeric issue numbers only', () => {
    expect(parseIssueNumber('21')).toBe(21);
    expect(parseIssueNumber(' 21.5 ')).toBe(21.5);
    expect(parseIssueNumber('Annual 1')).toBeNull();
    expect(parseIssueNumber(null)).toBeNull();
    expect(parseIssueNumber('')).toBeNull();
  });
});
