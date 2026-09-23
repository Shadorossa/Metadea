// Shared labeling for a bundle's contained works (media_relations' "Contains"
// direction — see CONTAINS_RELATION_TYPES in sagaTypes.ts) — used by both
// NeighborsRow (the small prequel/sequel/bundle row on a game's detail
// panel) and MediaEditorModal (the version-tab switcher), so the two don't
// each grow their own copy of the same rule and drift apart.
//
// A plain episodic bundle (The Great Ace Attorney Chronicles' two episodes)
// numbers its children "Part I"/"Part II" — there's no other sensible name
// for either half. Once one child is actually an add-on rather than another
// full chapter (Final Fantasy VII Remake Intergrade bundling the base game
// with its INTERmission DLC), the same numbering just reads as an arbitrary
// order instead of naming what each piece actually is, so every child gets
// relabeled by its own format instead: the add-on(s) as "DLC"/"Expansión",
// everything else as "Juego" (all three via media.formats).
import { getT } from '../../../i18n/runtime';

const BUNDLE_ADDON_FORMAT_IDS: ReadonlySet<string> = new Set(['DLC', 'EXPANSION']);

const ROMAN_NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
function toRoman(n: number): string {
  return ROMAN_NUMERALS[n - 1] ?? String(n);
}

export function hasBundleAddon(children: { format?: string | null }[]): boolean {
  return children.some(c => c.format && BUNDLE_ADDON_FORMAT_IDS.has(c.format));
}

// `hasAddon` is passed in (rather than recomputed here) so a caller only
// scans the full children list once instead of once per child.
export function bundleChildLabel(child: { format?: string | null }, index: number, hasAddon: boolean): string {
  const m = getT().media;
  if (!hasAddon) return m.bundle_part.replace('{numeral}', toRoman(index + 1));
  const format = child.format;
  if (format && BUNDLE_ADDON_FORMAT_IDS.has(format)) return m.formats[format as keyof typeof m.formats] ?? format;
  return m.formats.GAME;
}
