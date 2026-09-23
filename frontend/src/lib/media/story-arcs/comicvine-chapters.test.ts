import { describe, expect, it } from 'vitest';
import { htmlToLines, parseChapterNumbers, parseIssueNumber } from './comicvine-chapters';

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe('parseChapterNumbers', () => {
  it('reads a "Chapter N: Title" list (Bleach vol. 21 shape)', () => {
    const html = '<p>Ichigo returns to the human world...</p><h4>Chapters</h4><ul><li>Chapter 182: Be My Family or Not</li><li>Chapter 183: Surprise Attack</li><li>Chapter 184: Deathberry Returns</li></ul>';
    expect(parseChapterNumbers(html)).toEqual([182, 183, 184]);
  });

  it('reads a table with a Chapter column and ignores other numeric columns', () => {
    const html = '<table><thead><tr><th>Chapter</th><th>Title</th><th>Pages</th></tr></thead><tbody><tr><td>191</td><td>Conquistadores</td><td>19</td></tr><tr><td>192</td><td>The Toxic Invasion</td><td>21</td></tr></tbody></table>';
    expect(parseChapterNumbers(html)).toEqual([191, 192]);
  });

  it('reads a table whose chapter column is "#" and a range cell', () => {
    const html = '<table><tr><th>#</th><th>Name</th></tr><tr><td>10</td><td>A</td></tr><tr><td>11-12</td><td>B</td></tr></table>';
    expect(parseChapterNumbers(html)).toEqual([10, 11, 12]);
  });

  it('ignores a table without a chapter column', () => {
    const html = '<table><tr><th>Year</th><th>Sales</th></tr><tr><td>2007</td><td>500</td></tr></table>';
    expect(parseChapterNumbers(html)).toEqual([]);
  });

  it('reads abbreviations: "Ch. 188", "Ch 189", "Chp. 190", "Chap. 191"', () => {
    expect(parseChapterNumbers('<ul><li>Ch. 188 - Title</li><li>Ch 189</li><li>Chp. 190</li><li>Chap. 191</li></ul>')).toEqual([188, 189, 190, 191]);
  });

  it('reads "#N" list items but not a "#N" inside prose', () => {
    expect(parseChapterNumbers('<ul><li>#189 The Fallen</li><li>#190: Next</li></ul>')).toEqual([189, 190]);
    expect(parseChapterNumbers('<p>Collects issue #5 of the magazine run.</p>')).toEqual([]);
  });

  it('reads ranges with hyphens, en dashes, "to" and "through"', () => {
    expect(parseChapterNumbers('Chapters 190-198')).toEqual(range(190, 198));
    expect(parseChapterNumbers('<p>Includes chapters 179&ndash;187.</p>')).toEqual(range(179, 187));
    expect(parseChapterNumbers('Includes chapters 179–187')).toEqual(range(179, 187));
    expect(parseChapterNumbers('Collects chapters 10 to 12')).toEqual([10, 11, 12]);
    expect(parseChapterNumbers('Collects chapters 10 through 12')).toEqual([10, 11, 12]);
  });

  it('completes an abbreviated range end ("190-98")', () => {
    expect(parseChapterNumbers('Chapters 190-98')).toEqual(range(190, 198));
  });

  it('reads comma/and lists, mixing single chapters and ranges', () => {
    expect(parseChapterNumbers('Chapters 1, 2 and 5-7')).toEqual([1, 2, 5, 6, 7]);
    expect(parseChapterNumbers('chapters 3 & 4')).toEqual([3, 4]);
  });

  it('reads Spanish, French, German and Italian chapter words', () => {
    expect(parseChapterNumbers('Capítulo 12: El regreso')).toEqual([12]);
    expect(parseChapterNumbers('Capitulos 1 a 9')).toEqual(range(1, 9));
    expect(parseChapterNumbers('Incluye los capítulos 20 al 22 y 25')).toEqual([20, 21, 22, 25]);
    expect(parseChapterNumbers('Cap. 7')).toEqual([7]);
    expect(parseChapterNumbers('Chapitres 3 à 5')).toEqual([3, 4, 5]);
    expect(parseChapterNumbers('Kapitel 8')).toEqual([8]);
    expect(parseChapterNumbers('Capitoli 1-2')).toEqual([1, 2]);
  });

  it('reads Japanese 第N話', () => {
    expect(parseChapterNumbers('<p>第182話 ビー・マイ・ファミリー</p><p>第183話</p>')).toEqual([182, 183]);
  });

  it('keeps half chapters', () => {
    expect(parseChapterNumbers('<li>Chapter 187.5: Omake</li><li>Chapter 188</li>')).toEqual([187.5, 188]);
  });

  it('reads numbered lines only under a chapters heading', () => {
    const html = '<h3>Chapter Titles</h3><p>182. Be My Family or Not<br>183. Surprise Attack</p><h3>Trivia</h3><p>2007. A year.</p>';
    expect(parseChapterNumbers(html)).toEqual([182, 183]);
    expect(parseChapterNumbers('<p>182. Be My Family or Not</p>')).toEqual([]);
  });

  it('never reads bare numbers in prose', () => {
    expect(parseChapterNumbers('<p>Released in 2007 with 200 pages. Each chapter is great; 15 characters appear.</p>')).toEqual([]);
  });

  it('sorts and de-duplicates across formats', () => {
    const html = '<p>Includes chapters 190-192.</p><ul><li>Chapter 192: X</li><li>Chapter 189: Y</li></ul>';
    expect(parseChapterNumbers(html)).toEqual([189, 190, 191, 192]);
  });

  it('refuses absurd spans instead of expanding them', () => {
    expect(parseChapterNumbers('Chapters 1-5000')).toEqual([1]);
  });

  it('returns nothing for empty descriptions', () => {
    expect(parseChapterNumbers(null)).toEqual([]);
    expect(parseChapterNumbers('')).toEqual([]);
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
