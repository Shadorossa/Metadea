// Normalises what plugin handlers return. Results cross from untrusted code
// into the UI, so every field is type-checked, trimmed and capped here and
// anything unexpected is dropped (or the whole result rejected). Nothing a
// plugin returns is ever rendered as HTML: panels are data Metadea lays out.
import type { SourceWorkType } from './manifest';
import { SOURCE_TYPES } from './manifest';

export class PluginResultError extends Error {}

type Raw = Record<string, unknown>;
const isRecord = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);

function text(value: unknown, max: number): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return undefined;
  // eslint-disable-next-line no-control-regex
  const clean = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  return clean ? clean.slice(0, max) : undefined;
}

function requiredText(value: unknown, max: number, what: string): string {
  const out = text(value, max);
  if (out === undefined) throw new PluginResultError(`${what} is missing`);
  return out;
}

function positiveInt(value: unknown): number | undefined {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isSafeInteger(n) && n > 0 ? n : undefined;
}

/** http(s) URL, for links and remote images. */
export function webUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 8192) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** Inline raster/SVG image a plugin may hand over without any network. */
export function imageDataUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 16 * 1024 * 1024) return undefined;
  return /^data:image\/(png|jpeg|jpg|gif|webp|avif|bmp|svg\+xml)[;,]/i.test(value) ? value : undefined;
}

function imageRef(value: unknown): string | undefined {
  return imageDataUrl(value) ?? webUrl(value);
}

function headers(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [name, v] of Object.entries(value).slice(0, 32)) {
    if (typeof v === 'string') out[name] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

// ── sources ───────────────────────────────────────────────────────────────────

export interface SourceSearchItem {
  id: string;
  title: string;
  cover?: string;
  type: SourceWorkType;
  anilistId?: number;
  malId?: number;
  year?: number;
}

export interface SourceSearchResult {
  items: SourceSearchItem[];
  hasMore: boolean;
}

export interface SourceChapter {
  id: string;
  number: number;
  title?: string;
  volume?: number;
  date?: string;
  scanlator?: string;
}

export interface SourceDetails {
  id: string;
  title: string;
  description?: string;
  cover?: string;
  chapters: SourceChapter[];
}

export interface SourceImagePage {
  url: string;
  headers?: Record<string, string>;
}

export type SourcePages =
  | { kind: 'images'; pages: SourceImagePage[] }
  | { kind: 'archive'; url: string; format: 'cbz' | 'zip' | 'epub' | 'pdf'; headers?: Record<string, string> };

export interface SourceLatestItem {
  itemId: string;
  chapterNumber?: number;
}

export const MAX_SEARCH_ITEMS = 100;
export const MAX_CHAPTERS = 5000;
export const MAX_PAGES = 1000;

function searchItem(raw: unknown): SourceSearchItem | null {
  if (!isRecord(raw)) return null;
  const id = text(raw.id, 512);
  const title = text(raw.title, 300);
  const type = raw.type as SourceWorkType;
  if (!id || !title || !SOURCE_TYPES.includes(type)) return null;
  const item: SourceSearchItem = { id, title, type };
  const cover = imageRef(raw.cover);
  if (cover) item.cover = cover;
  const anilistId = positiveInt(raw.anilistId);
  if (anilistId) item.anilistId = anilistId;
  const malId = positiveInt(raw.malId);
  if (malId) item.malId = malId;
  const year = positiveInt(raw.year);
  if (year && year >= 1800 && year <= 2200) item.year = year;
  return item;
}

export function sanitizeSearchResult(raw: unknown): SourceSearchResult {
  const list = Array.isArray(raw) ? raw : isRecord(raw) && Array.isArray(raw.items) ? raw.items : null;
  if (!list) throw new PluginResultError('search must return { items } or an array');
  const items = list.slice(0, MAX_SEARCH_ITEMS).map(searchItem).filter((i): i is SourceSearchItem => i !== null);
  return { items, hasMore: isRecord(raw) && raw.hasMore === true };
}

function chapter(raw: unknown): SourceChapter | null {
  if (!isRecord(raw)) return null;
  const id = text(raw.id, 512);
  const number = typeof raw.number === 'string' ? Number(raw.number) : raw.number;
  if (!id || typeof number !== 'number' || !Number.isFinite(number) || number < 0 || number > 1e6) return null;
  const out: SourceChapter = { id, number };
  const title = text(raw.title, 300);
  if (title) out.title = title;
  const volume = typeof raw.volume === 'number' && Number.isFinite(raw.volume) && raw.volume >= 0 ? raw.volume : undefined;
  if (volume !== undefined) out.volume = volume;
  const date = text(raw.date, 32);
  if (date) out.date = date;
  const scanlator = text(raw.scanlator, 100);
  if (scanlator) out.scanlator = scanlator;
  return out;
}

export function sanitizeDetails(raw: unknown): SourceDetails {
  if (!isRecord(raw)) throw new PluginResultError('details must return an object');
  const details: SourceDetails = {
    id: requiredText(raw.id, 512, 'id'),
    title: requiredText(raw.title, 300, 'title'),
    chapters: (Array.isArray(raw.chapters) ? raw.chapters : [])
      .slice(0, MAX_CHAPTERS)
      .map(chapter)
      .filter((c): c is SourceChapter => c !== null),
  };
  const description = text(raw.description, 5000);
  if (description) details.description = description;
  const cover = imageRef(raw.cover);
  if (cover) details.cover = cover;
  return details;
}

const ARCHIVE_FORMATS = ['cbz', 'zip', 'epub', 'pdf'] as const;

export function sanitizePages(raw: unknown): SourcePages {
  const list = Array.isArray(raw) ? raw : isRecord(raw) && raw.kind !== 'archive' && Array.isArray(raw.pages) ? raw.pages : null;
  if (list) {
    const pages = list.slice(0, MAX_PAGES).flatMap((page): SourceImagePage[] => {
      const url = imageRef(isRecord(page) ? page.url : page);
      if (!url) return [];
      const extra = isRecord(page) ? headers(page.headers) : undefined;
      return [extra ? { url, headers: extra } : { url }];
    });
    if (pages.length === 0) throw new PluginResultError('pages returned no usable image');
    return { kind: 'images', pages };
  }
  if (isRecord(raw) && raw.kind === 'archive') {
    const url = webUrl(raw.url);
    const format = raw.format as (typeof ARCHIVE_FORMATS)[number];
    if (!url || !ARCHIVE_FORMATS.includes(format)) throw new PluginResultError('archive pages need an http(s) url and a format (cbz, zip, epub, pdf)');
    const extra = headers(raw.headers);
    return extra ? { kind: 'archive', url, format, headers: extra } : { kind: 'archive', url, format };
  }
  throw new PluginResultError('pages must return { kind: "images", pages } or { kind: "archive", url, format }');
}

export function sanitizeLatest(raw: unknown): SourceLatestItem[] {
  const list = Array.isArray(raw) ? raw : isRecord(raw) && Array.isArray(raw.items) ? raw.items : [];
  return list.slice(0, 500).flatMap(item => {
    if (!isRecord(item)) return [];
    const itemId = text(item.itemId, 512);
    if (!itemId) return [];
    const n = typeof item.chapterNumber === 'number' && Number.isFinite(item.chapterNumber) ? item.chapterNumber : undefined;
    return [n === undefined ? { itemId } : { itemId, chapterNumber: n }];
  });
}

// ── workActions ───────────────────────────────────────────────────────────────

export type WorkActionResult =
  | { type: 'none' }
  | { type: 'openUrl'; url: string }
  | { type: 'toast'; message: string; level: 'success' | 'error' }
  | { type: 'notify'; title: string; body: string };

export function sanitizeActionResult(raw: unknown): WorkActionResult {
  if (raw == null || !isRecord(raw)) return { type: 'none' };
  switch (raw.type) {
    case 'openUrl': {
      const url = webUrl(raw.url);
      if (!url || !url.startsWith('https:')) throw new PluginResultError('openUrl needs an https url');
      return { type: 'openUrl', url };
    }
    case 'toast':
      return { type: 'toast', message: requiredText(raw.message, 300, 'message'), level: raw.level === 'error' ? 'error' : 'success' };
    case 'notify':
      return { type: 'notify', title: requiredText(raw.title, 100, 'title'), body: text(raw.body, 300) ?? '' };
    default:
      return { type: 'none' };
  }
}

// ── workPanels ────────────────────────────────────────────────────────────────

export interface WorkPanelRow {
  label: string;
  value: string;
  /** https link the value opens in the browser. */
  href?: string;
}

export interface WorkPanelData {
  title: string;
  rows: WorkPanelRow[];
  badges: string[];
}

export function sanitizePanel(raw: unknown, fallbackTitle: string): WorkPanelData | null {
  if (raw == null) return null;
  if (!isRecord(raw)) throw new PluginResultError('a panel must be an object or null');
  const rows = (Array.isArray(raw.rows) ? raw.rows : []).slice(0, 30).flatMap((row): WorkPanelRow[] => {
    if (!isRecord(row)) return [];
    const label = text(row.label, 60);
    const value = text(row.value, 300);
    if (!label || value === undefined) return [];
    const href = webUrl(row.href);
    return [href && href.startsWith('https:') ? { label, value, href } : { label, value }];
  });
  const badges = (Array.isArray(raw.badges) ? raw.badges : []).slice(0, 10).flatMap(b => {
    const badge = text(b, 40);
    return badge ? [badge] : [];
  });
  if (rows.length === 0 && badges.length === 0) return null;
  return { title: text(raw.title, 80) ?? fallbackTitle, rows, badges };
}
