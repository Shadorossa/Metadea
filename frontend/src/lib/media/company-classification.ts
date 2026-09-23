// Tells record labels / music companies apart from the rest of an anime's
// credited companies. AniList lists every company on an anime as a studio:
// the animation studio (`isMain`) and the "Producers", which mix the
// production committee (Aniplex, Kadokawa, TOHO...) with the music labels
// that release the soundtrack (Lantis, Flying DOG, King Records...). The
// media page hides the latter behind a "+N music labels" toggle.
//
// Pure. Two layers: a curated list of labels (normalised exact match, with
// aliases) and a conservative keyword heuristic (whole words only), with a
// short exception list for names the keywords would get wrong.

/** Lowercase, accents and punctuation stripped, corporate suffixes dropped:
 *  "King Records Co., Ltd." → "king records". */
export function normalizeCompanyName(name: string): string {
  let out = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  // Repeatedly, so "co ltd" and "inc japan"-style tails both go.
  const SUFFIX = /\s(?:inc|incorporated|co|company|ltd|limited|corp|corporation|llc|kk|k k|kabushiki kaisha|gk|g k)$/;
  while (SUFFIX.test(out)) out = out.replace(SUFFIX, '');
  return out;
}

// Japanese anime music labels and music arms, normalised. Aliases are just
// further entries (AniList spells some labels several ways).
const KNOWN_MUSIC_LABELS: readonly string[] = [
  'lantis',
  'flying dog', 'flyingdog', 'jvcentertainment flying dog',
  'sony music entertainment', 'sony music entertainment japan', 'sony music japan',
  'sony music records', 'sony music labels', 'sony music communications', 'sony music solutions',
  'sacra music', 'ki oon music', 'kioon music', 'sme records',
  'king records', 'king amusement creative',
  'starchild', 'starchild records',
  'pony canyon', 'pony canyon music',
  'victor entertainment', 'jvc entertainment', 'jvckenwood victor entertainment', 'victor music arts',
  'avex', 'avex entertainment', 'avex trax', 'avex mode', 'avex music creative',
  'warner music japan', 'warner music',
  'universal music', 'universal music japan', 'universal music llc', 'universal sigma',
  'nippon columbia', 'columbia music entertainment',
  'nippon crown', 'crown records',
  'teichiku entertainment', 'teichiku records',
  'tokuma japan communications',
  'toho music', 'toho animation records',
  'emi music japan', 'emi records japan',
  'toy s factory', 'toys factory',
  'evil line records',
  'for life music entertainment',
  'yamaha music entertainment holdings', 'yamaha music communications',
  'being',
  'magic capsule',
  'space shower music',
  'dive ii entertainment',
  'bandai namco music live',
  'lantis records',
  'geneon music', 'geneon universal music',
  'marvelous music',
  'mages music',
  'aniplex music',
];

const KNOWN_SET = new Set(KNOWN_MUSIC_LABELS);

// Whole-word keywords that make a company a music one. "sound" and "audio"
// are here too, but only as whole words — "Soundrop" or "Audiovisual" don't
// match.
const MUSIC_KEYWORD = /\b(?:music|musics|musik|records|recordings|record label|audio|sound|sounds|label|labels)\b/;

// Names the keywords would flag but that aren't music companies: a voice
// actor agency and sound-for-picture studios credited as producers.
// Normalised.
const KEYWORD_EXCEPTIONS: ReadonlySet<string> = new Set([
  'audio planning u',
  'audio highs',
  'sound team don juan',
  'sound box',
]);

/** Whether an anime/manga company credit is a record label / music company. */
export function isMusicCompany(name: string | null | undefined): boolean {
  if (!name) return false;
  const normalized = normalizeCompanyName(name);
  if (!normalized) return false;
  if (KNOWN_SET.has(normalized)) return true;
  if (KEYWORD_EXCEPTIONS.has(normalized)) return false;
  return MUSIC_KEYWORD.test(normalized);
}

/** Media types whose company credits come from AniList's studio list. */
export function hidesMusicCompanies(mediaType: string): boolean {
  return mediaType === 'anime' || mediaType === 'manga';
}

/** Splits credits into the ones shown by default and the music labels. */
export function partitionMusicCompanies<T extends { name: string }>(companies: readonly T[]): { shown: T[]; music: T[] } {
  const shown: T[] = [];
  const music: T[] = [];
  for (const company of companies) (isMusicCompany(company.name) ? music : shown).push(company);
  return { shown, music };
}
