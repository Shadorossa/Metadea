// Turns a ROM dump's file name into a clean title plus the metadata the
// name carried — No-Intro/Redump tags ("(Europe) (En,Fr,De) (Rev 1)"),
// scene numbering ("5288 - "), Switch title ids and [Base]/[UPD]/[DLC]
// kinds, PS2 serials ("SLUS-20974_..."), "(UNDUB v1.0.0)" mods. Pure:
// used by the Local tab for display before IGDB resolves, by the IGDB
// match query, and by rom-rename-plan.ts to decide the clean file name.

export type RomKind = 'base' | 'update' | 'dlc';

export interface ParsedRomName {
  // Display title: "Fire Emblem: Three Houses". Subtitle dashes become ":"
  // only when the name was tagged in a Redump/No-Intro/scene style.
  title: string;
  // Same, but keeping the original " - " separators.
  rawTitle: string;
  // Filesystem-safe form of `title` (":" -> " -", forbidden chars dropped).
  fileTitle: string;
  region?: string;
  languages: string[];
  revision?: string;
  version?: string;
  titleId?: string;
  baseTitleId?: string;
  kind: RomKind;
  dlcName?: string;
  mod?: string;
  serial?: string;
  disc?: number;
  sceneNumber?: string;
  junkTags: string[];
}

const REGIONS = new Set([
  'usa', 'us', 'europe', 'eu', 'eur', 'japan', 'jp', 'jpn', 'spain', 'france', 'germany', 'italy', 'uk', 'united kingdom',
  'australia', 'korea', 'china', 'taiwan', 'hong kong', 'world', 'asia', 'netherlands', 'sweden', 'brazil', 'canada',
  'russia', 'poland', 'portugal', 'scandinavia', 'latin america', 'mexico', 'denmark', 'finland', 'norway', 'greece',
  'belgium', 'austria', 'switzerland', 'unknown',
]);

const ARTICLES = /^(.+?),\s*(The|A|An|El|La|Los|Las|Le|Les|Der|Die|Das|Il|Lo|Gli|Un|Una|Une)$/i;
const TITLE_ID = /^[0-9A-F]{16}$/i;
const VERSION_TAG = /^v(\d+(?:\.\d+)*)$/i;
const REVISION_TAG = /^Rev\s*([A-Z0-9.]+)$/i;
const LANGUAGE_CODE = /^[A-Z][a-z](?:\+[A-Z][a-z])*$/;
const DISC_TAG = /^Dis[ck]\s*(\d+)(?:\s+of\s+\d+)?$/i;
const SITE_TAG = /^[\w.-]+\.(com|net|org|to|io|cc|xyz|me|info|ru|es|fr|de|it)$/i;
const MOD_TAG = /undub|hack|patch|translat|t-[a-z]{2}\b|\bmod\b|fan|decensor|uncensor|widescreen|hd texture/i;
const SERIAL = /^(S[LC][UEPKA]S|SCAJ|SLKA|SCED|SLED|SCPS|SLPS|SLPM|PBPX|ULUS|ULES|ULJS|ULJM|UCUS|UCES|UCJS|NPUH|NPEH|NPJH|BLUS|BLES|BCUS|BCES|BLJM)[-_ ]?(\d{5})[-_ ]*/i;
const EXTENSION = /\.(?:[a-z][a-z0-9]{0,3}|[0-9][a-z][a-z0-9]{0,2})$/i;
const SCENE_NUMBER = /^(\d{3,5})\s*-\s+/;
const TAG = /\(([^()]*)\)|\[([^[\]]*)\]/g;
const FORBIDDEN_FILE_CHARS = /[\\/?*"<>|]/g;

export function switchKindFromTitleId(titleId: string): RomKind {
  const suffix = titleId.slice(13).toUpperCase();
  if (suffix === '000') return 'base';
  if (suffix === '800') return 'update';
  return 'dlc';
}

// Updates are base + 0x800 and DLC ids are base + 0x1000 + n, so the base
// of a DLC differs from it in the 13th hex digit, not just the suffix.
export function switchBaseTitleId(titleId: string, kind: RomKind): string {
  const id = BigInt(`0x${titleId}`);
  const mask = ~BigInt(0xfff);
  const base = kind === 'dlc' ? (id - BigInt(0x1000)) & mask : id & mask;
  return base.toString(16).toUpperCase().padStart(16, '0');
}

function isRegion(text: string): boolean {
  const parts = text.split(',').map(p => p.trim().toLowerCase()).filter(Boolean);
  return parts.length > 0 && parts.every(p => REGIONS.has(p));
}

function isLanguageList(text: string): boolean {
  const parts = text.split(',').map(p => p.trim()).filter(Boolean);
  return parts.length > 0 && parts.every(p => LANGUAGE_CODE.test(p));
}

function invertArticle(segment: string): { text: string; inverted: boolean } {
  const m = segment.match(ARTICLES);
  return m ? { text: `${m[2]} ${m[1]}`, inverted: true } : { text: segment, inverted: false };
}

function toFileTitle(title: string, fallback: string): string {
  const safe = title
    .replace(/\s*:\s*/g, ' - ')
    .replace(FORBIDDEN_FILE_CHARS, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '');
  return safe || fallback;
}

export function parseRomFileName(fileName: string): ParsedRomName {
  let name = fileName.replace(EXTENSION, '');
  name = name
    .replace(/[™®©]/g, '')
    .replace(/[꞉ː]/g, ':')
    .replace(/\s+/g, ' ')
    .trim();

  const parsed: ParsedRomName = { title: '', rawTitle: '', fileTitle: '', languages: [], kind: 'base', junkTags: [] };
  let tagged = false;

  const scene = name.match(SCENE_NUMBER);
  if (scene) {
    parsed.sceneNumber = scene[1];
    name = name.slice(scene[0].length);
    tagged = true;
  }

  const serial = name.match(SERIAL);
  if (serial) {
    parsed.serial = `${serial[1].toUpperCase()}-${serial[2]}`;
    name = name.slice(serial[0].length);
    tagged = true;
  }

  let kindTag: RomKind | undefined;
  const bracketTexts: string[] = [];
  const stripped = name.replace(TAG, (_whole, paren: string | undefined, bracket: string | undefined) => {
    const text = (paren ?? bracket ?? '').trim();
    const inBrackets = bracket !== undefined;
    if (!text) return ' ';
    tagged = true;
    if (TITLE_ID.test(text)) { parsed.titleId = text.toUpperCase(); return ' '; }
    const version = text.match(VERSION_TAG);
    if (version) { parsed.version = version[1]; return ' '; }
    const lower = text.toLowerCase();
    if (lower === 'base') { kindTag = 'base'; return ' '; }
    if (lower === 'dlc') { kindTag = 'dlc'; return ' '; }
    if (lower === 'upd' || lower === 'update') { kindTag = 'update'; return ' '; }
    const revision = text.match(REVISION_TAG);
    if (revision) { parsed.revision = revision[1]; return ' '; }
    if (isRegion(text)) { parsed.region = parsed.region ? `${parsed.region}, ${text}` : text; return ' '; }
    if (isLanguageList(text)) { parsed.languages.push(...text.split(',').flatMap(p => p.trim().split('+')).filter(Boolean)); return ' '; }
    const disc = text.match(DISC_TAG);
    if (disc) { parsed.disc = Number(disc[1]); return ' '; }
    if (SITE_TAG.test(text)) { parsed.junkTags.push(text); return ' '; }
    if (MOD_TAG.test(text)) { parsed.mod = parsed.mod ? `${parsed.mod} ${text}` : text; return ' '; }
    if (inBrackets) { bracketTexts.push(text); return ' '; }
    parsed.junkTags.push(text);
    return ' ';
  });

  parsed.kind = kindTag ?? (parsed.titleId ? switchKindFromTitleId(parsed.titleId) : 'base');
  if (parsed.titleId) parsed.baseTitleId = switchBaseTitleId(parsed.titleId, parsed.kind);
  if (parsed.kind === 'dlc' && bracketTexts.length > 0) parsed.dlcName = bracketTexts.shift();
  parsed.junkTags.push(...bracketTexts);

  let body = stripped.replace(/\s+/g, ' ').replace(/[\s\-–—,]+$/g, '').replace(/^[\s\-–—,]+/g, '').trim();
  if (!body.includes(' ') && body.includes('_')) body = body.replace(/_/g, ' ');
  if (!body) body = parsed.serial ?? parsed.dlcName ?? fileName.replace(EXTENSION, '');

  const segments = body.split(/\s+-\s+/).map(s => s.trim()).filter(Boolean);
  const inverted = segments.map(invertArticle);
  if (inverted.some(s => s.inverted)) tagged = true;
  const parts = inverted.map(s => s.text);

  parsed.rawTitle = parts.join(' - ');
  parsed.title = tagged ? parts.join(': ') : parsed.rawTitle;
  parsed.fileTitle = toFileTitle(parsed.title, parsed.rawTitle);
  return parsed;
}

// What the Local tab shows for a scanned ROM before (or without) an IGDB
// match — the raw file stem is often a messy dump name.
export function romDisplayTitle(stem: string): string {
  return parseRomFileName(stem).title;
}
