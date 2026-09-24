import { describe, expect, it } from 'vitest';
import {
  sanitizeActionResult,
  sanitizeDetails,
  sanitizePages,
  sanitizePanel,
  sanitizeSearchResult,
  MAX_SEARCH_ITEMS,
} from './plugin-results';

describe('sanitizeSearchResult', () => {
  it('keeps valid items and drops the rest', () => {
    const result = sanitizeSearchResult({
      items: [
        { id: '1', title: '  A  ', type: 'manga', anilistId: 5, malId: '7', year: 2001, cover: 'https://img.example/x.jpg' },
        { id: '2', title: 'B', type: 'anime' },
        { id: '', title: 'C', type: 'manga' },
        { id: '4', title: 'D', type: 'comic', cover: 'javascript:alert(1)', anilistId: -3, year: 99999 },
        'junk',
      ],
      hasMore: true,
    });
    expect(result).toEqual({
      hasMore: true,
      items: [
        { id: '1', title: 'A', type: 'manga', anilistId: 5, malId: 7, year: 2001, cover: 'https://img.example/x.jpg' },
        { id: '4', title: 'D', type: 'comic' },
      ],
    });
  });

  it('accepts a bare array, caps the length and rejects other shapes', () => {
    const many = Array.from({ length: MAX_SEARCH_ITEMS + 10 }, (_, i) => ({ id: String(i), title: 't', type: 'book' }));
    expect(sanitizeSearchResult(many).items).toHaveLength(MAX_SEARCH_ITEMS);
    expect(() => sanitizeSearchResult('nope')).toThrow();
  });
});

describe('sanitizeDetails', () => {
  it('normalises chapters', () => {
    const details = sanitizeDetails({
      id: 'w', title: 'W', description: 'x\u0000y',
      chapters: [{ id: 'c1', number: '1.5', volume: 1 }, { id: 'c2', number: -1 }, { id: 'c3', number: 3, title: 42 }],
    });
    expect(details.description).toBe('xy');
    expect(details.chapters).toEqual([{ id: 'c1', number: 1.5, volume: 1 }, { id: 'c3', number: 3, title: '42' }]);
    expect(() => sanitizeDetails({ title: 'no id' })).toThrow();
  });
});

describe('sanitizePages', () => {
  it('image pages from strings or objects, with headers', () => {
    expect(sanitizePages(['https://a/1.jpg', { url: 'https://a/2.jpg', headers: { Referer: 'https://a/', Bad: 1 } }, 'ftp://x'])).toEqual({
      kind: 'images',
      pages: [{ url: 'https://a/1.jpg' }, { url: 'https://a/2.jpg', headers: { Referer: 'https://a/' } }],
    });
    expect(sanitizePages({ kind: 'images', pages: ['data:image/png;base64,AAAA'] })).toEqual({ kind: 'images', pages: [{ url: 'data:image/png;base64,AAAA' }] });
    expect(() => sanitizePages({ kind: 'images', pages: ['data:text/html,<script>'] })).toThrow();
  });

  it('archives', () => {
    expect(sanitizePages({ kind: 'archive', url: 'https://a/c.cbz', format: 'cbz' })).toEqual({ kind: 'archive', url: 'https://a/c.cbz', format: 'cbz' });
    expect(() => sanitizePages({ kind: 'archive', url: 'https://a/c.rar', format: 'rar' })).toThrow();
    expect(() => sanitizePages({ kind: 'archive', url: 'file:///c.cbz', format: 'cbz' })).toThrow();
  });
});

describe('sanitizeActionResult', () => {
  it('only known result types', () => {
    expect(sanitizeActionResult(null)).toEqual({ type: 'none' });
    expect(sanitizeActionResult({ type: 'eval', code: 'x' })).toEqual({ type: 'none' });
    expect(sanitizeActionResult({ type: 'toast', message: 'hi' })).toEqual({ type: 'toast', message: 'hi', level: 'success' });
    expect(sanitizeActionResult({ type: 'openUrl', url: 'https://example.org' })).toEqual({ type: 'openUrl', url: 'https://example.org/' });
    expect(() => sanitizeActionResult({ type: 'openUrl', url: 'http://example.org' })).toThrow();
    expect(() => sanitizeActionResult({ type: 'openUrl', url: 'javascript:alert(1)' })).toThrow();
  });
});

describe('sanitizePanel', () => {
  it('rows, badges and https links only', () => {
    const panel = sanitizePanel({
      rows: [
        { label: 'A', value: '<b>1</b>', href: 'https://x.org' },
        { label: 'B', value: 2, href: 'javascript:x' },
        { label: '', value: 'dropped' },
      ],
      badges: ['one', 2, null],
    }, 'Fallback');
    expect(panel).toEqual({
      title: 'Fallback',
      rows: [{ label: 'A', value: '<b>1</b>', href: 'https://x.org/' }, { label: 'B', value: '2' }],
      badges: ['one', '2'],
    });
    expect(sanitizePanel(null, 'x')).toBeNull();
    expect(sanitizePanel({ rows: [] }, 'x')).toBeNull();
  });
});
