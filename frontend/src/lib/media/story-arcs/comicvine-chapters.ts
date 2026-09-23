// Chapter numbers out of a Comic Vine issue description. A manga tankōbon on
// Comic Vine is an "issue" whose description (HTML written by volunteers)
// lists the chapters it collects in whatever shape its editor chose: a
// "Chapter 187: Title" list, a table with a Chapter column, "#189" list
// items, "Chapters 190-198", "Includes chapters 179–187", Spanish
// "Capítulos 1 a 9", Japanese "第12話". Bare numbers in prose are never
// read as chapters: a number only counts next to a chapter word, as a
// "#N"/"N:" list item under a chapters heading, or in a table's chapter
// column.

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const value = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(value) && value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** Plain text with one line per block element (p, li, tr, br, headings);
 *  table cells joined with " | ". */
export function htmlToLines(html: string | null | undefined): string[] {
  if (!html) return [];
  const text = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' | ')
    .replace(/<\/?(p|div|li|ul|ol|tr|table|thead|tbody|h[1-6]|blockquote|figure|figcaption)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, '');
  return decodeEntities(text)
    .split('\n')
    .map(line => line.replace(/[ \t\u00a0]+/g, ' ').replace(/(\s*\|\s*)+$/, '').trim())
    .filter(Boolean);
}

const CHAPTER_WORD = String.raw`(?:chapters?|chaps?\.?|chs?\.?|chp\.?|cap[ií]tulos?|caps?\.|chapitres?|kapitel|capitol[oi])`;
const NUM = String.raw`#?\d{1,4}(?:\.\d{1,2})?`;
const RANGE_SEP = String.raw`(?:-|–|—|~|to|through|thru|a|al|à|bis)`;
const LIST_SEP = String.raw`(?:,|&|\+|/|and|y|e|et|und)`;
const TERM = String.raw`${NUM}(?:\s*${RANGE_SEP}\s*${NUM})?`;
const KEYWORD_LIST = new RegExp(String.raw`(?<![\p{L}\p{N}])${CHAPTER_WORD}\s*(?:n[º°o]\.?\s*)?(${TERM}(?:\s*${LIST_SEP}\s*${TERM})*)`, 'giu');
const JAPANESE_CHAPTER = /第\s*(\d{1,4})\s*[話话章]/g;
const HASH_ITEM = new RegExp(String.raw`^(?:[-*•·]\s*)?#(\d{1,4}(?:\.\d{1,2})?)(?:\s*[-–—]\s*#?(\d{1,4}(?:\.\d{1,2})?))?(?!\d)`);
const NUMBERED_ITEM = /^(?:[-*•·]\s*)?(\d{1,4}(?:\.\d)?)\s*(?:[:.)–—-]|\|)\s*\S/;
const CHAPTER_HEADING = new RegExp(String.raw`^(?:${CHAPTER_WORD}|chapter titles|contents|table of contents|t[ií]tulos de los cap[ií]tulos|[ií]ndice)\s*:?$`, 'iu');
const CHAPTER_COLUMN = new RegExp(String.raw`^(?:${CHAPTER_WORD}|#|no\.?|n[º°]|number|n[uú]mero)$`, 'iu');

// Beyond this a "range" is a typo or not a chapter range at all.
const MAX_RANGE_SPAN = 400;

function toNumber(token: string): number {
  return Number(token.replace('#', ''));
}

// "190-98" → 190–198: an end shorter than its start borrows the start's
// leading digits.
function completeRangeEnd(start: string, end: string): number {
  const s = start.replace('#', '');
  const e = end.replace('#', '');
  const endValue = Number(e);
  if (endValue >= Number(s) || e.length >= s.length) return endValue;
  return Number(s.slice(0, s.length - e.length) + e);
}

function expandRange(start: number, end: number, out: Set<number>) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start > MAX_RANGE_SPAN) {
    if (Number.isFinite(start)) out.add(start);
    return;
  }
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    out.add(start);
    out.add(end);
    return;
  }
  for (let n = start; n <= end; n++) out.add(n);
}

const TERM_SPLIT = new RegExp(String.raw`^(${NUM})(?:\s*${RANGE_SEP}\s*(${NUM}))?$`, 'iu');

function addTermList(list: string, out: Set<number>) {
  // Each TERM is matched left to right, so a "1 a 9" range stays whole and
  // the list separators between terms are skipped.
  const termPattern = new RegExp(TERM, 'giu');
  for (const match of list.matchAll(termPattern)) {
    const term = match[0].trim();
    const parts = TERM_SPLIT.exec(term);
    if (!parts) continue;
    const start = toNumber(parts[1]);
    if (parts[2]) expandRange(start, completeRangeEnd(parts[1], parts[2]), out);
    else out.add(start);
  }
}

function tableChapterNumbers(html: string, out: Set<number>) {
  for (const table of html.match(/<table[\s\S]*?<\/table>/gi) ?? []) {
    const rows = (table.match(/<tr[\s\S]*?<\/tr>/gi) ?? []).map(row =>
      [...row.matchAll(/<t([dh])[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(cell => htmlToLines(cell[2]).join(' ')),
    );
    const headerIndex = rows.findIndex(cells => cells.some(cell => CHAPTER_COLUMN.test(cell.trim())));
    if (headerIndex === -1) continue;
    const column = rows[headerIndex].findIndex(cell => CHAPTER_COLUMN.test(cell.trim()));
    for (const cells of rows.slice(headerIndex + 1)) {
      const cell = (cells[column] ?? '').trim();
      const parts = TERM_SPLIT.exec(cell);
      if (!parts) continue;
      const start = toNumber(parts[1]);
      if (parts[2]) expandRange(start, completeRangeEnd(parts[1], parts[2]), out);
      else out.add(start);
    }
  }
}

/** Sorted, unique chapter numbers a Comic Vine issue description lists
 *  (empty when it lists none). */
export function parseChapterNumbers(description: string | null | undefined): number[] {
  if (!description) return [];
  const found = new Set<number>();
  tableChapterNumbers(description, found);

  let inChapterSection = false;
  for (const line of htmlToLines(description.replace(/<table[\s\S]*?<\/table>/gi, '\n'))) {
    let matched = false;
    for (const match of line.matchAll(KEYWORD_LIST)) {
      addTermList(match[1], found);
      matched = true;
    }
    for (const match of line.matchAll(JAPANESE_CHAPTER)) {
      found.add(Number(match[1]));
      matched = true;
    }
    const hash = HASH_ITEM.exec(line);
    if (hash) {
      const start = Number(hash[1]);
      if (hash[2]) expandRange(start, completeRangeEnd(hash[1], hash[2]), found);
      else found.add(start);
      matched = true;
    }
    if (!matched && inChapterSection) {
      const numbered = NUMBERED_ITEM.exec(line);
      if (numbered) {
        found.add(Number(numbered[1]));
        matched = true;
      }
    }
    if (CHAPTER_HEADING.test(line)) inChapterSection = true;
    else if (!matched && inChapterSection && /^[^\d]/.test(line) && line.length < 60 && !/[.!?]$/.test(line)) {
      // Another short heading ends the chapter list.
      inChapterSection = false;
    }
  }

  return [...found].filter(n => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
}

/** A Comic Vine issue_number ("21", "21.5", " 3 ") as a number; null for
 *  "Annual 1" and friends. */
export function parseIssueNumber(issueNumber: string | null | undefined): number | null {
  if (!issueNumber) return null;
  const value = Number(issueNumber.trim());
  return issueNumber.trim() !== '' && Number.isFinite(value) ? value : null;
}
