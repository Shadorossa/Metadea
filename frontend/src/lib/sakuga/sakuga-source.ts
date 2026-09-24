// Sakugabooru's free-text `source` field, as its editors write it:
//   "#06 (BD) (Action AD: Toru Iwazawa)"   → Ep 6, BD, "Action AD"
//   "#023 (S2 #10) (BD) "                  → Ep 23 (S2 Ep 10), BD
//   "OP (TV)"                              → OP, TV
// Parsed for display only (chips on the clip card); anything unrecognised
// is simply not shown.

export type SakugaMedium = 'BD' | 'TV' | 'WEB' | 'DVD';

export interface SakugaSourceInfo {
  /** The leading `#N` (absolute numbering in multi-season listings). */
  episode: number | null;
  /** From a "(S2 #10)" group: season and episode within it. */
  season: number | null;
  seasonEpisode: number | null;
  medium: SakugaMedium | null;
  /** OP / ED / PV / CM when the source names one. */
  segment: string | null;
  /** Role labels from "(Role: Name)" groups, e.g. "Action AD". */
  roles: string[];
}

const MEDIA: readonly SakugaMedium[] = ['BD', 'TV', 'WEB', 'DVD'];
const SEGMENTS = ['OP', 'ED', 'PV', 'CM'] as const;

export function parseSakugaSource(source: string | null | undefined): SakugaSourceInfo {
  const info: SakugaSourceInfo = { episode: null, season: null, seasonEpisode: null, medium: null, segment: null, roles: [] };
  const text = (source ?? '').trim();
  if (!text) return info;

  const leading = /^#\s*(\d{1,4})\b/.exec(text);
  if (leading) info.episode = Number(leading[1]);

  const outside = text.replace(/\([^)]*\)/g, ' ').toUpperCase();
  for (const segment of SEGMENTS) {
    if (new RegExp(`(^|[^A-Z])${segment}\\d*([^A-Z]|$)`).test(outside)) { info.segment = segment; break; }
  }

  for (const match of text.matchAll(/\(([^)]*)\)/g)) {
    const group = match[1].trim();
    const upper = group.toUpperCase();
    const medium = MEDIA.find(m => upper === m);
    if (medium) { info.medium ??= medium; continue; }
    const seasonal = /^S(\d{1,2})\s*#\s*(\d{1,4})$/i.exec(group);
    if (seasonal) {
      info.season = Number(seasonal[1]);
      info.seasonEpisode = Number(seasonal[2]);
      continue;
    }
    const colon = group.indexOf(':');
    if (colon > 0) {
      const role = group.slice(0, colon).trim();
      if (role && role.length <= 32 && !info.roles.includes(role)) info.roles.push(role);
      continue;
    }
    if (!info.segment) {
      const segment = SEGMENTS.find(s => upper === s);
      if (segment) info.segment = segment;
    }
  }
  return info;
}

/** The episode label's numbers: the in-season one when the source gives
 *  both ("S2 Ep 10"), else the plain one ("Ep 6"). */
export function sourceEpisodeParts(info: SakugaSourceInfo): { season: number | null; episode: number } | null {
  if (info.season !== null && info.seasonEpisode !== null) return { season: info.season, episode: info.seasonEpisode };
  if (info.episode !== null) return { season: null, episode: info.episode };
  return null;
}
