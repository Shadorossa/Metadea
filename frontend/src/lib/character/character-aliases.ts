// Consolidates every alternate name a character page knows about — AniList's
// own alternative/spoiler names, the locally saved aliases_csv, bold
// "Aliases:"-style biography lines and "also known as X" phrases in the
// biography text — into one de-duplicated tag list.
import type { ParsedCharacteristic } from './biography-parser';
import { isAliasSourceLabel } from './character-stat-labels';

export interface CharacterAlias {
  text: string;
  spoiler: boolean;
}

export interface CharacterAliasSources {
  name: string;
  nameNative: string | null;
  alternative: string[];
  alternativeSpoiler: string[];
  aliasesCsv: string | null | undefined;
  parsedStats: ParsedCharacteristic[];
  biography: string | null | undefined;
}

// Deliberately does NOT also grab arbitrary "(...)" text from the bio —
// that used to add anything in parentheses as an "alias", but a
// biography's parentheticals are usually team names, arcs, or asides
// ("the Aliea Gakuen arc", "(Coach)"), not alternate names, and there's
// no reliable way to tell those apart from a real one this way.
const AKA_RE = /(?:also\s+known\s+as|known\s+as|referred\s+to\s+as|also\s+called|alias(?:es)?)\s+([^,.\n(<]+)/gi;

export function collectCharacterAliases(src: CharacterAliasSources): CharacterAlias[] {
  const aliasMap = new Map<string, CharacterAlias>();
  const mainNameLower = src.name.toLowerCase().trim();
  const nativeNameLower = (src.nameNative || '').toLowerCase().trim();

  function addAlias(rawText: string, spoiler: boolean = false) {
    if (!rawText) return;
    const clean = rawText.replace(/<[^>]*>/g, '').trim();
    if (!clean) return;
    const parts = clean.split(/[,;\n]/).map(s => s.trim()).filter(Boolean);
    for (const p of parts) {
      const key = p.toLowerCase().trim();
      if (key && key !== mainNameLower && key !== nativeNameLower && key.length > 1 && !aliasMap.has(key)) {
        aliasMap.set(key, { text: p, spoiler });
      }
    }
  }

  // 1. AniList alternative names
  for (const alt of src.alternative ?? []) addAlias(alt, false);
  for (const alt of src.alternativeSpoiler ?? []) addAlias(alt, true);

  // 2. Local DB saved aliases
  if (src.aliasesCsv) {
    for (const alt of src.aliasesCsv.split(',')) addAlias(alt, false);
  }

  // 3. Biografía parsed bold labels ("Aliases", "AKA", "Nicknames", etc.)
  for (const stat of src.parsedStats) {
    if (isAliasSourceLabel(stat.label)) addAlias(stat.value, false);
  }

  // 4. Biografía text patterns ("also known as X", "known as X")
  const rawDesc = src.biography || '';
  const akaRegex = new RegExp(AKA_RE.source, AKA_RE.flags);
  let match;
  while ((match = akaRegex.exec(rawDesc)) !== null) {
    if (match[1]) addAlias(match[1], false);
  }

  return Array.from(aliasMap.values());
}
