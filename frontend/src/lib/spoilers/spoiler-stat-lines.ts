// Which character stat lines (the "__Label:__ value" lines AniList/Fandom
// bios carry, parsed by lib/character/biography-parser.ts) give away where
// the story goes. Labels appear in whatever language the bio was written in,
// so every list below carries the forms seen in AniList bios across the
// app's 8 locales. Pure — tested in spoiler-stat-lines.test.ts.

export type SpoilerStatKind = 'status' | 'sensitive';

/** Lower-cased, accents stripped, whitespace collapsed. */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/<[^>]+>/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Latin-script labels, matched as whole words on the normalized label.
const STATUS_WORDS = ['status', 'estado', 'estat', 'statut', 'stato', 'situacion', 'situacao', 'zustand'];

const SENSITIVE_LABEL_WORDS: readonly string[] = [
  // fate
  'fate', 'destiny', 'destino', 'desti', 'destin', 'destinee', 'schicksal',
  // death
  'death', 'deceased', 'died', 'muerte', 'fallecimiento', 'defuncion', 'defuncio', 'mort', 'deces', 'tod', 'todesursache',
  'gestorben', 'morte', 'obito',
  // alignment
  'alignment', 'alineamiento', 'alineacio', 'alignement', 'gesinnung', 'allineamento', 'allegiance', 'lealtad', 'loyalty',
  // affiliation
  'affiliation', 'affiliations', 'afiliacion', 'afiliaciones', 'afiliacio', 'afiliacions', 'afiliacao', 'afiliacoes',
  'affiliazione', 'affiliazioni', 'zugehorigkeit', 'zugehoerigkeit', 'zugehorigkeiten',
  'affiliates', 'afiliados', 'afiliats', 'affilies', 'affiliati', 'verbundete',
  // relationships
  'relationship', 'relationships', 'relatives', 'relaciones', 'relacions', 'relations', 'beziehung', 'beziehungen',
  'relazioni', 'relacoes',
  // formerly
  'formerly', 'former', 'previous', 'previously', 'anteriormente', 'anteriorment', 'anciennement', 'ehemals',
  'ehemalig', 'ehemalige', 'precedentemente', 'antiguamente',
];

// Scripts without word boundaries (Japanese) or where \b does not apply
// (Cyrillic): plain substring matches.
const STATUS_FRAGMENTS = ['статус', 'состояние', '状態', 'ステータス', '生死'];
const SENSITIVE_LABEL_FRAGMENTS = [
  'судьба', 'смерть', 'мировоззрение', 'принадлежность', 'союзники', 'отношения', 'родственники', 'ранее', 'бывш',
  '運命', '死亡', '死因', '所属', '関係', '人間関係', '属性',
];

// Values that give the game away whatever their label says: "(formerly)",
// "Deceased", "killed by ...".
const SENSITIVE_VALUE_WORDS = [
  'formerly', 'former', 'deceased', 'dead', 'died', 'killed', 'fallecido', 'fallecida', 'muerto', 'muerta',
  'difunto', 'difunta', 'anteriormente', 'decede', 'decedee', 'mort', 'morte', 'anciennement', 'verstorben',
  'tot', 'ehemals', 'ehemalig', 'morto', 'morta', 'defunto', 'defunta', 'precedentemente',
];
const SENSITIVE_VALUE_FRAGMENTS = ['мёртв', 'мертв', 'погиб', 'умер', 'бывш', '死亡', '故人'];
// '元' ("former") only as a value prefix: it is also part of ordinary words.
const SENSITIVE_VALUE_PREFIXES = ['元'];

function wordPattern(words: readonly string[]): RegExp {
  return new RegExp(`(?:^|[^a-z0-9])(?:${words.join('|')})(?:$|[^a-z0-9])`);
}

const STATUS_RE = wordPattern(STATUS_WORDS);
const SENSITIVE_LABEL_RE = wordPattern(SENSITIVE_LABEL_WORDS);
const SENSITIVE_VALUE_RE = wordPattern(SENSITIVE_VALUE_WORDS);

function hasFragment(text: string, fragments: readonly string[]): boolean {
  return fragments.some(fragment => text.includes(fragment));
}

/** 'status' for the Status line itself, 'sensitive' for fate/death/
 *  alignment/affiliation/relationships/"formerly" lines (by label, or by a
 *  value that reads "deceased"/"formerly"), null for everything else. */
export function classifySpoilerStatLine(label: string, values: readonly string[] = []): SpoilerStatKind | null {
  const normalizedLabel = normalize(label);
  if (STATUS_RE.test(normalizedLabel) || hasFragment(normalizedLabel, STATUS_FRAGMENTS)) return 'status';
  if (SENSITIVE_LABEL_RE.test(normalizedLabel) || hasFragment(normalizedLabel, SENSITIVE_LABEL_FRAGMENTS)) return 'sensitive';
  for (const value of values) {
    const normalizedValue = normalize(value);
    if (SENSITIVE_VALUE_RE.test(normalizedValue)) return 'sensitive';
    if (hasFragment(normalizedValue, SENSITIVE_VALUE_FRAGMENTS)) return 'sensitive';
    if (SENSITIVE_VALUE_PREFIXES.some(prefix => normalizedValue.startsWith(prefix))) return 'sensitive';
  }
  return null;
}
