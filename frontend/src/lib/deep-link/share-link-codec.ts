// Codec for the rich share links served by workers/share-links:
//
//   /<t>/<id>/<slug>/<packed>
//   /g/2136/bayonetta-2009/hsac-86-co9xp1
//
// Everything a Discord/Open Graph preview needs travels in the URL itself,
// so the worker stores nothing and needs no API key:
//
//   <t>      one letter per media type (SHARE_TYPES), which is also the
//            external-id prefix: `g/2136` <-> `game:2136`.
//   <id>     the rest of the external id; `:` is written `~` and any byte
//            outside [A-Za-z0-9_-] as `.HH` (UTF-8, upper-case hex), so ids
//            with provider prefixes (`event:apisports:football:39`) round-trip.
//   <slug>   lowercased ASCII title + `-<year>`. Unknown year: nothing, or
//            `-_` when the title itself ends in four digits. No usable ASCII
//            title: `_`.
//   <packed> `<genreCodes>-<score>-<image>[-<titleToken>]`
//            genreCodes: concatenated 2-char codes (GENRE_CODES, unknown ones
//            dropped); score: 0..100 (the app's scoreGlobal, i.e. score×10);
//            image: optional banner token `b.<body>` (+ `.<cover>`) (bannerTokenFromUrl)
//            followed by an optional cover token (coverTokenFromUrl). A bare
//            `b` (old links: "banner resolved by the Worker via AniList",
//            which Cloudflare Workers cannot reach) still decodes and is
//            ignored;
//            titleToken: base64url of the UTF-8 title, present only when the
//            title cannot be rebuilt from the slug (titleFromSlug).
//
// This file exists twice, byte-for-byte: frontend/src/lib/deep-link/
// share-link-codec.ts (Metadea app, builds links) and src/services/
// share-codec.ts (metadea-web Worker, parses them and renders the preview).
// Both repos run the same fixture table (share-link-fixtures.json) through
// their copy; change the two files and the two fixture copies together.
// Pure and dependency-free (runs in the WebView, Node tests and Workers).
// GENRE_CODES, the type letters and the token tags are part of every link
// ever shared: append only, never reuse or change a code.

export const SHARE_TYPES = {
  g: { prefix: 'game', label: 'Game' },
  a: { prefix: 'anime', label: 'Anime' },
  m: { prefix: 'manga', label: 'Manga' },
  n: { prefix: 'lnovel', label: 'Light novel' },
  v: { prefix: 'vnovel', label: 'Visual novel' },
  s: { prefix: 'series', label: 'Series' },
  f: { prefix: 'movie', label: 'Movie' },
  b: { prefix: 'book', label: 'Book' },
  c: { prefix: 'comic', label: 'Comic' },
  e: { prefix: 'event', label: 'Event' },
} as const;

export type ShareTypeLetter = keyof typeof SHARE_TYPES;

/** The metadea-web Worker: serves share links and custom images (R2). */
export const METADEA_WORKER_ORIGIN = 'https://metadea.metadea.workers.dev';

// Unified genre names (lib/media/genre-unifier.ts) -> 2-char codes.
export const GENRE_CODES: Readonly<Record<string, string>> = {
  'Action': 'ac', 'Fighting': 'fi', 'Hack and Slash': 'hs', 'Shooter': 'sh',
  'Adventure': 'ad', 'Point-and-click': 'pc', 'Strategy': 'st',
  'Real-Time Strategy (RTS)': 'rt', 'Turn-Based Strategy (TBS)': 'tb', 'Tactical': 'ta', '4X': '4x',
  'Role-playing (RPG)': 'rp', 'Platformer': 'pl', 'Puzzle': 'pz', 'Arcade': 'ar',
  'Simulation': 'si', 'Sports': 'sp', 'Racing': 'ra', 'MOBA': 'mo', 'Party': 'pa',
  'Visual Novel': 'vn', 'Card & Board Game': 'cb', 'Music': 'mu', 'Quiz/Trivia': 'qu',
  'Sandbox': 'sb', 'Open world': 'ow', 'Survival': 'su', 'Stealth': 'se',
  'Fantasy': 'fa', 'Sci-Fi': 'sf', 'Horror': 'ho', 'Thriller': 'th', 'Mystery': 'my',
  'Romance': 'ro', 'Comedy': 'co', 'Drama': 'dr', 'History': 'hi', 'War': 'wa',
  'Western': 'we', 'Crime': 'cr', 'Animation': 'an', 'Documentary': 'do', 'Family': 'fm',
  'TV Movie': 'tv', 'News': 'ne', 'Reality': 're', 'Soap Opera': 'so', 'Talk Show': 'tk',
  'Cyberpunk': 'cy', 'Steampunk': 'sm', 'Slice of Life': 'sl', 'Supernatural': 'sn',
  'Psychological': 'ps', 'Mecha': 'me', 'Mahou Shoujo': 'ms', 'Ecchi': 'ec', 'Harem': 'ha',
  'Isekai': 'is', 'Hentai': 'he', 'Juvenile Fiction': 'jf', 'Teen Fiction': 'tf',
  'School': 'sc', 'Magic': 'mg', 'Witches': 'wi', 'Wizards': 'wz', 'Vampires': 'va',
  'Ghosts': 'gh', 'Monsters': 'mn', 'Friendship': 'fr', 'Coming of Age': 'ca',
  'Adventure & Adventurers': 'aa', 'Overcoming Adversity': 'oa', 'Indie': 'in',
  'Educational': 'ed', 'Kids': 'ki', 'Business': 'bu', 'Non-fiction': 'nf', 'Erotic': 'er',
  'Space Opera': 'op', 'Literary Fiction': 'lf', 'Magical Realism': 'mr', 'Young Adult': 'ya',
  'Urban': 'ur', 'Paranormal': 'pn', 'LGBTQ+': 'lg', 'Noir': 'no', 'Dystopian': 'dy',
  'Post-Apocalyptic': 'pp', 'Heist': 'hz', 'Spy Thriller': 'sy', 'Mythology': 'mt',
  'Folk Tale': 'fk',
};

const GENRE_NAMES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(GENRE_CODES).map(([name, code]) => [code, name]),
);

export const MAX_GENRES = 6;
const MAX_ID_SEGMENT = 96;
const MAX_TITLE_SLUG = 60;
const MAX_TITLE_BYTES = 90;
const MAX_PATH = 400;

// ── Cover tokens ────────────────────────────────────────────────────────────

export type CoverProvider = 'igdb' | 'steam' | 'anilist' | 'tmdb' | 'openlibrary' | 'vndb' | 'comicvine' | 'metadea';

/** A provider-short image id; `value` is the token text itself. */
export interface CoverToken {
  provider: CoverProvider;
  value: string;
}

// Token grammar, one leading tag per provider (none of them is `b`, which is
// the banner flag in front of a token):
//   co…/ar…/sc…         IGDB image id, as IGDB names it
//   s<appid>            Steam library capsule
//   x<a|m><file>.<ext>  AniList cover file (`-` written `~`), anime|manga folder
//   t<file>.<ext>       TMDB poster file
//   o<id>               Open Library cover id
//   v<id>               VNDB cover id (cv)
//   k<d1>_<d2>_<file>.<ext>  ComicVine upload path (`-` written `~`)
//   i<m|c><sha256>      custom image already served by the Worker's own
//                       /images/<Media|character>/<sha256>.webp route
const TOKEN_PATTERNS: ReadonlyArray<[CoverProvider, RegExp]> = [
  ['igdb', /^(?:co|ar|sc)[a-z0-9]{1,24}$/],
  ['steam', /^s\d{1,10}$/],
  ['anilist', /^x[am][A-Za-z0-9~]{1,48}\.(?:jpg|jpeg|png|gif|webp)$/],
  ['tmdb', /^t[A-Za-z0-9]{1,40}\.(?:jpg|jpeg|png|webp)$/],
  ['openlibrary', /^o\d{1,12}$/],
  ['vndb', /^v\d{1,10}$/],
  ['comicvine', /^k\d{1,6}_\d{1,10}_[A-Za-z0-9~]{1,40}\.(?:jpg|jpeg|png|gif|webp)$/],
  ['metadea', /^i[mc][a-f0-9]{64}$/],
];

export function parseCoverToken(value: string): CoverToken | null {
  for (const [provider, pattern] of TOKEN_PATTERNS) {
    if (pattern.test(value)) return { provider, value };
  }
  return null;
}

/** Recognizes the CDN URL shapes the app stores and returns their token. */
export function coverTokenFromUrl(url: string | null | undefined): CoverToken | null {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname;
  let match: RegExpMatchArray | null;
  let value: string | null = null;

  if (host === 'images.igdb.com') {
    match = path.match(/^\/igdb\/image\/upload\/t_[a-z0-9_]+\/([a-z0-9]+)\.(?:jpg|jpeg|png|webp)$/);
    if (match) value = match[1];
  } else if (/^(?:cdn|shared)\.(?:cloudflare|akamai|fastly)\.steamstatic\.com$/.test(host) || host === 'steamcdn-a.akamaihd.net') {
    match = path.match(/^\/steam\/apps\/(\d+)\//);
    if (match) value = `s${match[1]}`;
  } else if (host === 's4.anilist.co') {
    match = path.match(/^\/file\/anilistcdn\/media\/(anime|manga)\/cover\/(?:small|medium|large|extraLarge)\/([A-Za-z0-9-]+)\.([a-z]+)$/);
    if (match) value = `x${match[1][0]}${match[2].replace(/-/g, '~')}.${match[3]}`;
  } else if (host === 'image.tmdb.org') {
    match = path.match(/^\/t\/p\/[a-z0-9]+\/([A-Za-z0-9]+)\.([a-z]+)$/);
    if (match) value = `t${match[1]}.${match[2]}`;
  } else if (host === 'covers.openlibrary.org') {
    match = path.match(/^\/b\/id\/(\d+)(?:-[SML])?\.jpg$/i);
    if (match) value = `o${match[1]}`;
  } else if (host === 't.vndb.org') {
    match = path.match(/^\/cv(?:\.t)?\/\d{2}\/(\d+)\.jpg$/);
    if (match) value = `v${match[1]}`;
  } else if (`https://${host}` === METADEA_WORKER_ORIGIN) {
    match = path.match(/^\/images\/(Media|character)\/([a-f0-9]{64})\.webp$/);
    if (match) value = `i${match[1] === 'Media' ? 'm' : 'c'}${match[2]}`;
  } else if (host === 'comicvine.gamespot.com') {
    match = path.match(/^\/a\/uploads\/[a-z_]+\/(\d+)\/(\d+)\/([A-Za-z0-9-]+)\.([a-z]+)$/i);
    if (match) value = `k${match[1]}_${match[2]}_${match[3].replace(/-/g, '~')}.${match[4].toLowerCase()}`;
  }
  return value ? parseCoverToken(value) : null;
}

/** The (preview-sized) image URL a token stands for. */
export function coverTokenToUrl(token: CoverToken): string {
  const v = token.value;
  switch (token.provider) {
    case 'igdb': return `https://images.igdb.com/igdb/image/upload/t_cover_big/${v}.jpg`;
    case 'steam': return `https://cdn.cloudflare.steamstatic.com/steam/apps/${v.slice(1)}/library_600x900_2x.jpg`;
    case 'anilist': {
      const folder = v[1] === 'a' ? 'anime' : 'manga';
      return `https://s4.anilist.co/file/anilistcdn/media/${folder}/cover/large/${v.slice(2).replace(/~/g, '-')}`;
    }
    case 'tmdb': return `https://image.tmdb.org/t/p/w500/${v.slice(1)}`;
    case 'openlibrary': return `https://covers.openlibrary.org/b/id/${v.slice(1)}-L.jpg`;
    case 'vndb': {
      const id = v.slice(1);
      return `https://t.vndb.org/cv/${String(Number(id) % 100).padStart(2, '0')}/${id}.jpg`;
    }
    case 'comicvine': {
      const [d1, d2, file] = v.slice(1).split('_');
      return `https://comicvine.gamespot.com/a/uploads/scale_large/${d1}/${d2}/${file.replace(/~/g, '-')}`;
    }
    case 'metadea': return `${METADEA_WORKER_ORIGIN}/images/${v[1] === 'm' ? 'Media' : 'character'}/${v.slice(2)}.webp`;
  }
}

// ── Banner tokens ───────────────────────────────────────────────────────────

export type BannerProvider = 'anilist' | 'igdb' | 'tmdb' | 'metadea';

/** A wide image the Worker rebuilds without any API; `value` is the token body. */
export interface BannerToken {
  provider: BannerProvider;
  value: string;
}

// Written `b.<body>`, followed by `.<cover>` when a cover is sent too. No host or provider tag
// travels: the provider follows from the type letter, except for this
// Worker's own custom images, whose body always has the cover-token shape
// `i<m|c><sha256>` (never a valid body for the other providers).
//   anime/manga/lnovel  AniList banner `<id>-<hash>.<ext>` -> `<hash>`
//                       (`<id>.<ext>` -> empty body); `~<ext>` unless jpg
//   game                IGDB image id (artwork, screenshot…), served t_1080p
//   series/movie        TMDB backdrop file, `~<ext>` unless jpg, served w1280
const METADEA_BANNER = /^i[mc][a-f0-9]{64}$/;
const BANNER_PATTERNS: ReadonlyArray<[BannerProvider, ReadonlyArray<ShareTypeLetter>, RegExp]> = [
  ['anilist', ['a', 'm', 'n'], /^[A-Za-z0-9]{0,40}(?:~(?:jpeg|png|gif|webp))?$/],
  ['igdb', ['g'], /^[a-z0-9]{1,32}$/],
  ['tmdb', ['s', 'f'], /^[A-Za-z0-9]{1,40}(?:~(?:jpeg|png|webp))?$/],
];

export function parseBannerToken(value: string, letter: ShareTypeLetter): BannerToken | null {
  if (METADEA_BANNER.test(value)) return { provider: 'metadea', value };
  for (const [provider, letters, pattern] of BANNER_PATTERNS) {
    if (letters.includes(letter) && pattern.test(value)) return { provider, value };
  }
  return null;
}

function extSuffix(ext: string): string {
  return ext.toLowerCase() === 'jpg' ? '' : `~${ext.toLowerCase()}`;
}

/** The banner token of a work's banner URL, or null when the Worker could not rebuild it. */
export function bannerTokenFromUrl(url: string | null | undefined, externalId: string): BannerToken | null {
  const letter = typeLetterForId(externalId);
  if (!letter || !url || !/^https?:\/\//i.test(url)) return null;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname;
  let match: RegExpMatchArray | null;
  let value: string | null = null;
  let provider: BannerProvider | null = null;

  if (`https://${host}` === METADEA_WORKER_ORIGIN) {
    provider = 'metadea';
    match = path.match(/^\/images\/(Media|character)\/([a-f0-9]{64})\.webp$/);
    if (match) value = `i${match[1] === 'Media' ? 'm' : 'c'}${match[2]}`;
  } else if (host === 's4.anilist.co') {
    provider = 'anilist';
    match = path.match(/^\/file\/anilistcdn\/media\/(anime|manga)\/banner\/(\d+)(?:-([A-Za-z0-9]+))?\.(jpg|jpeg|png|gif|webp)$/i);
    const rest = externalId.slice(externalId.indexOf(':') + 1);
    if (match && match[1] === aniListFolder(letter) && match[2] === rest) value = `${match[3] ?? ''}${extSuffix(match[4])}`;
  } else if (host === 'images.igdb.com') {
    provider = 'igdb';
    match = path.match(/^\/igdb\/image\/upload\/t_[a-z0-9_]+\/([a-z0-9]+)\.(?:jpg|jpeg|png|webp)$/);
    if (match) value = match[1];
  } else if (host === 'image.tmdb.org') {
    provider = 'tmdb';
    match = path.match(/^\/t\/p\/[a-z0-9]+\/([A-Za-z0-9]+)\.(jpg|jpeg|png|webp)$/i);
    if (match) value = `${match[1]}${extSuffix(match[2])}`;
  }
  const token = value === null ? null : parseBannerToken(value, letter);
  return token && token.provider === provider ? token : null;
}

function aniListFolder(letter: ShareTypeLetter): 'anime' | 'manga' | null {
  return letter === 'a' ? 'anime' : letter === 'm' || letter === 'n' ? 'manga' : null;
}

function splitExt(value: string): [string, string] {
  const tilde = value.indexOf('~');
  return tilde < 0 ? [value, 'jpg'] : [value.slice(0, tilde), value.slice(tilde + 1)];
}

/** The banner URL a token stands for, given the link's type letter and external id. */
export function bannerTokenToUrl(token: BannerToken, letter: ShareTypeLetter, externalId: string): string {
  const v = token.value;
  switch (token.provider) {
    case 'metadea': return `${METADEA_WORKER_ORIGIN}/images/${v[1] === 'm' ? 'Media' : 'character'}/${v.slice(2)}.webp`;
    case 'igdb': return `https://images.igdb.com/igdb/image/upload/t_1080p/${v}.jpg`;
    case 'tmdb': {
      const [file, ext] = splitExt(v);
      return `https://image.tmdb.org/t/p/w1280/${file}.${ext}`;
    }
    case 'anilist': {
      const [hash, ext] = splitExt(v);
      const id = externalId.slice(externalId.indexOf(':') + 1);
      return `https://s4.anilist.co/file/anilistcdn/media/${aniListFolder(letter)}/banner/${id}${hash ? `-${hash}` : ''}.${ext}`;
    }
  }
}

// ── Ids ─────────────────────────────────────────────────────────────────────

// What a decoded external id may contain after its type prefix. Wider than
// the deep-link validation (extra colons, `%`), still inert in HTML/JS.
const EXTERNAL_ID_REST = /^[A-Za-z0-9_.:%~+@-]{1,128}$/;

function utf8Hex(char: string): string {
  return Array.from(new TextEncoder().encode(char), b => `.${b.toString(16).toUpperCase().padStart(2, '0')}`).join('');
}

export function escapeIdSegment(rest: string): string {
  return Array.from(rest, ch => (ch === ':' ? '~' : /[A-Za-z0-9_-]/.test(ch) ? ch : utf8Hex(ch))).join('');
}

export function unescapeIdSegment(segment: string): string | null {
  if (!/^(?:[A-Za-z0-9_~-]|\.[0-9A-F]{2})+$/.test(segment)) return null;
  const bytes: number[] = [];
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i];
    if (ch === '.') { bytes.push(parseInt(segment.slice(i + 1, i + 3), 16)); i += 2; }
    else bytes.push((ch === '~' ? ':' : ch).charCodeAt(0));
  }
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(new Uint8Array(bytes));
  } catch {
    return null;
  }
}

// ── Titles ──────────────────────────────────────────────────────────────────

const SPECIAL_LETTERS: Readonly<Record<string, string>> = {
  'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'ø': 'o', 'đ': 'd', 'ð': 'd', 'ł': 'l', 'þ': 'th', 'ı': 'i',
};

// Words titleFromSlug keeps lower-case (except as the first word): English
// articles/prepositions and the Japanese particles common in romaji titles.
const LOWERCASE_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'into', 'nor', 'of', 'on', 'or',
  'the', 'to', 'with', 'vs', 'de', 'del', 'la', 'le', 'les', 'y', 'no', 'wa', 'ga', 'wo', 'ni', 'na', 'mo', 'e',
]);

/** Lower-case ASCII slug of a title ('' when nothing Latin survives). */
export function slugifyTitle(title: string): string {
  const ascii = title
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[ßæœøđðłþı]/g, ch => SPECIAL_LETTERS[ch] ?? ch)
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (ascii.length <= MAX_TITLE_SLUG) return ascii;
  const cut = ascii.slice(0, MAX_TITLE_SLUG + 1);
  const lastDash = cut.lastIndexOf('-');
  return (lastDash > 0 ? cut.slice(0, lastDash) : cut.slice(0, MAX_TITLE_SLUG)).replace(/-+$/, '');
}

/** The display title the worker shows when the link carries no title token. */
export function titleFromSlug(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((word, i) => (i > 0 && LOWERCASE_WORDS.has(word) ? word : word[0].toUpperCase() + word.slice(1)))
    .join(' ');
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(token: string): Uint8Array | null {
  try {
    const binary = atob(token.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(binary, ch => ch.charCodeAt(0));
  } catch {
    return null;
  }
}

/** base64url of the title's UTF-8, cut to MAX_TITLE_BYTES on a char boundary. */
export function encodeTitleToken(title: string): string {
  const encoder = new TextEncoder();
  let kept = '';
  let size = 0;
  for (const ch of title) {
    const len = encoder.encode(ch).length;
    if (size + len > MAX_TITLE_BYTES) break;
    kept += ch;
    size += len;
  }
  return base64UrlEncode(encoder.encode(kept));
}

export function decodeTitleToken(token: string): string | null {
  const bytes = base64UrlDecode(token);
  if (!bytes || bytes.length === 0) return null;
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
    // eslint-disable-next-line no-control-regex
    const clean = text.replace(/[\u0000-\u001f\u007f]/g, '').trim();
    return clean || null;
  } catch {
    return null;
  }
}

// ── Links ───────────────────────────────────────────────────────────────────

export interface ShareLinkData {
  /** Metadea external id, e.g. `anime:147105`. */
  externalId: string;
  title: string;
  year?: number;
  /** Unified genre names; names without a code are dropped. */
  genres: string[];
  /** 0..100 (scoreGlobal). */
  score?: number;
  /** Wide image for a `summary_large_image` preview (bannerTokenFromUrl). */
  banner?: BannerToken;
  cover?: CoverToken;
}

export function typeLetterForId(externalId: string): ShareTypeLetter | null {
  const prefix = externalId.slice(0, externalId.indexOf(':'));
  const entry = Object.entries(SHARE_TYPES).find(([, def]) => def.prefix === prefix);
  return entry ? (entry[0] as ShareTypeLetter) : null;
}

/** `/g/2136/bayonetta-2009/hsac-86-co9xp1`, or null when the data cannot be encoded. */
export function encodeSharePath(data: ShareLinkData): string | null {
  const letter = typeLetterForId(data.externalId);
  if (!letter) return null;
  const rest = data.externalId.slice(data.externalId.indexOf(':') + 1);
  if (!EXTERNAL_ID_REST.test(rest)) return null;
  const idSegment = escapeIdSegment(rest);
  if (idSegment.length > MAX_ID_SEGMENT) return null;

  const title = data.title.trim();
  const titleSlug = slugifyTitle(title);
  const year = data.year && Number.isInteger(data.year) && data.year >= 1000 && data.year <= 9999 ? data.year : undefined;
  let slug = titleSlug || '_';
  if (year) slug += `-${year}`;
  else if (/-\d{4}$/.test(slug)) slug += '-_';

  const codes: string[] = [];
  for (const genre of data.genres) {
    const code = GENRE_CODES[genre];
    if (code && !codes.includes(code)) codes.push(code);
    if (codes.length === MAX_GENRES) break;
  }
  const score = typeof data.score === 'number' && Number.isFinite(data.score)
    ? String(Math.min(100, Math.max(0, Math.round(data.score))))
    : '';
  const banner = data.banner && parseBannerToken(data.banner.value, letter);
  // `b.<banner>` alone, or `b.<banner>.<cover>`: no trailing dot, which
  // chat apps drop when they turn a URL into a link.
  const image = banner
    ? `b.${banner.value}${data.cover ? `.${data.cover.value}` : ''}`
    : (data.cover ? data.cover.value : '');
  let packed = `${codes.join('')}-${score}-${image}`;
  if (title && titleFromSlug(titleSlug) !== title) packed += `-${encodeTitleToken(title)}`;

  const path = `/${letter}/${idSegment}/${slug}/${packed}`;
  return path.length <= MAX_PATH ? path : null;
}

export interface DecodedShareLink extends ShareLinkData {
  letter: ShareTypeLetter;
}

const SLUG_RE = /^(?:_|[a-z0-9]+(?:-[a-z0-9]+)*)(?:-(?:_|\d{4}))?$/;
const PACKED_RE = /^((?:[a-z0-9]{2}){0,8})-(\d{0,3})-([A-Za-z0-9_.~]{0,160})(?:-([A-Za-z0-9_-]{1,120}))?$/;

/** Strict inverse of encodeSharePath; null for anything malformed. */
export function decodeSharePath(pathname: string): DecodedShareLink | null {
  if (pathname.length > MAX_PATH) return null;
  const parts = pathname.replace(/^\/+/, '').replace(/\/+$/, '').split('/');
  if (parts.length !== 4) return null;
  const [letterPart, idSegment, slug, packed] = parts;
  if (!Object.prototype.hasOwnProperty.call(SHARE_TYPES, letterPart)) return null;
  const letter = letterPart as ShareTypeLetter;

  if (idSegment.length === 0 || idSegment.length > MAX_ID_SEGMENT) return null;
  const rest = unescapeIdSegment(idSegment);
  if (!rest || !EXTERNAL_ID_REST.test(rest)) return null;

  if (slug.length > MAX_TITLE_SLUG + 8 || !SLUG_RE.test(slug)) return null;
  let titleSlug = slug;
  let year: number | undefined;
  if (slug.endsWith('-_')) {
    titleSlug = slug.slice(0, -2);
  } else {
    const yearMatch = slug.match(/^(.+)-(\d{4})$/);
    if (yearMatch) { titleSlug = yearMatch[1]; year = Number(yearMatch[2]); }
  }
  if (titleSlug === '_') titleSlug = '';
  else if (titleSlug.includes('_')) return null;

  const packedMatch = packed.match(PACKED_RE);
  if (!packedMatch) return null;
  const [, codes, scoreText, image, titleToken] = packedMatch;
  let score: number | undefined;
  if (scoreText) {
    score = Number(scoreText);
    if (score > 100) return null;
  }
  const genres: string[] = [];
  for (let i = 0; i < codes.length; i += 2) {
    const name = GENRE_NAMES[codes.slice(i, i + 2)];
    if (name && !genres.includes(name)) genres.push(name);
  }

  let banner: BannerToken | undefined;
  let coverText = image;
  if (image.startsWith('b.')) {
    // Older links always ended the banner with a dot; both forms decode.
    const bannerMatch = image.match(/^b\.([A-Za-z0-9~]{0,70})(?:\.(.*))?$/);
    const token = bannerMatch && parseBannerToken(bannerMatch[1], letter);
    if (!bannerMatch || !token) return null;
    banner = token;
    coverText = bannerMatch[2] ?? '';
  } else if (image.startsWith('b')) {
    // Old links: a bare `b` asked the Worker to fetch the AniList banner.
    coverText = image.slice(1);
  }
  let cover: CoverToken | undefined;
  if (coverText) {
    const token = parseCoverToken(coverText);
    if (!token) return null;
    cover = token;
  }

  let title = titleFromSlug(titleSlug);
  if (titleToken) {
    const decoded = decodeTitleToken(titleToken);
    if (!decoded) return null;
    title = decoded;
  }

  return {
    letter,
    externalId: `${SHARE_TYPES[letter].prefix}:${rest}`,
    title,
    year,
    genres,
    score,
    banner,
    cover,
  };
}
