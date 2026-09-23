// Builds the ordered list of rows shown in a character page's "Datos" card:
// AniList's own structured fields first (gender/age/blood type/birthday),
// then the stats parsed out of the biography, grouped under section headers.
// Pure — the React side sanitizes each value fragment before rendering it.
import { parseStatSectionLabel, StatSectionTracker } from '../media/stat-sections';
import type { ParsedCharacteristic } from './biography-parser';
import {
  buildStatLabelMap,
  formatSectionHeader,
  isAliasStatLabel,
  resolveStatLabel,
  type CharacterStrings,
} from './character-stat-labels';

export type CharacterStatRow =
  | { kind: 'header'; label: string }
  | { kind: 'stat'; label: string; items: string[] };

export interface CharacterStructuredFields {
  gender: string | null;
  age: string | null;
  bloodType: string | null;
  dateOfBirth: { year: number | null; month: number | null; day: number | null } | null;
}

/** Splits a raw stat value (may carry list/br markup) into its individual items. */
export function parseStatItems(rawValue: string): string[] {
  const lines = rawValue
    .replace(/<\/?(?:ul|ol)[^>]*>/gi, '')
    .replace(/<\/?li[^>]*>/gi, '\n')
    .split(/<br\s*\/?>|\n/i)
    .map(v => v.trim())
    .filter(Boolean);

  return lines.flatMap(line => {
    const clean = line.replace(/<\/?small>/gi, '').trim();
    return clean.includes(',') && !clean.includes('(') ? clean.split(',').map(v => v.trim()) : [clean];
  }).filter(Boolean);
}

/** "Main text (parenthetical)" → main + sub, both still raw inline HTML. */
export function splitStatValue(raw: string): { main: string; sub: string | null } {
  const cleaned = raw.replace(/<\/?small>/gi, '').trim();
  const match = cleaned.match(/^(.*?)\s*(\([^)]+\))$/);
  if (match && match[1].trim()) {
    return { main: match[1].trim(), sub: match[2].trim() };
  }
  return { main: cleaned, sub: null };
}

export function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '').trim();
}

export function formatBirthday(dateOfBirth: NonNullable<CharacterStructuredFields['dateOfBirth']>): string {
  const day = dateOfBirth.day ?? '?';
  const month = dateOfBirth.month ?? '?';
  const year = dateOfBirth.year ? `/${dateOfBirth.year}` : '';
  return `${day}/${month}${year}`;
}

interface ProcessedStat {
  rawLabel: string;
  cleanLabel: string;
  section: string | null;
  value: string;
}

export function buildCharacterStatRows(
  character: CharacterStructuredFields,
  parsedStats: ParsedCharacteristic[],
  t: CharacterStrings,
): CharacterStatRow[] {
  const rows: CharacterStatRow[] = [];
  const addedLabels = new Set<string>();
  const labelMap = buildStatLabelMap(t);

  const pushStat = (label: string, items: string[]) => {
    if (items.length === 0) return;
    rows.push({ kind: 'stat', label, items });
  };

  if (character.gender) {
    pushStat(t.stat_gender, parseStatItems(character.gender));
    addedLabels.add('gender');
    addedLabels.add('género');
  }
  if (character.age) {
    pushStat(t.stat_age, parseStatItems(String(character.age)));
    addedLabels.add('age');
    addedLabels.add('edad');
  }
  if (character.bloodType) {
    pushStat(t.stat_blood_type, parseStatItems(character.bloodType));
    addedLabels.add('bloodtype');
    addedLabels.add('blood type'); // AniList biographies spell it with a space
    addedLabels.add('grupo sanguíneo');
  }
  if (character.dateOfBirth && (character.dateOfBirth.day || character.dateOfBirth.month)) {
    pushStat(t.stat_birthday, [formatBirthday(character.dateOfBirth)]);
    addedLabels.add('birthday');
    addedLabels.add('cumpleaños');
  }

  const processedStats: ProcessedStat[] = parsedStats.map(stat => {
    const { section, cleanLabel } = parseStatSectionLabel(stat.label);
    return { rawLabel: stat.label, cleanLabel, section, value: stat.value };
  });

  // A bare "Physical Description:" line right before "Hair [Physical
  // Description]" is that section's own opener — fold it in.
  for (let i = 0; i < processedStats.length - 1; i++) {
    const nextSection = processedStats[i + 1].section;
    if (!processedStats[i].section && nextSection) {
      if (processedStats[i].cleanLabel.toLowerCase() === nextSection.toLowerCase()) {
        processedStats[i].section = nextSection;
      }
    }
  }

  const sectionTracker = new StatSectionTracker();

  for (const stat of processedStats) {
    const lowerLabel = stat.cleanLabel.toLowerCase();
    const lowerRaw = stat.rawLabel.toLowerCase();
    if (addedLabels.has(lowerLabel) || addedLabels.has(lowerRaw)) continue;
    if (isAliasStatLabel(lowerLabel)) continue;

    const displayLabel = resolveStatLabel(lowerLabel, t, labelMap) ?? stat.cleanLabel;

    const sectionHeader = sectionTracker.next(stat.section);
    if (sectionHeader) {
      rows.push({ kind: 'header', label: formatSectionHeader(sectionHeader, t) });
    }

    pushStat(displayLabel, parseStatItems(stat.value));
    addedLabels.add(lowerLabel);
    addedLabels.add(lowerRaw);
  }

  return rows;
}
