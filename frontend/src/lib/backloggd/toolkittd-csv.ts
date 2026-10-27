// The CSV that the Toolkittd browser extension exports from Backloggd →
// Settings → Data (https://github.com/jolacdev/toolkittd, csv.ts): one row
// per logged game, first playthrough only. Backloggd has no API and its
// pages sit behind a bot challenge, so the user's own export is the only
// way in. Columns are read by header name, so a reordering doesn't matter.

export interface BackloggdGame {
  name: string;
  /** IGDB slug, from the row's Backloggd URL (`/games/<slug>/`). */
  slug: string | null;
  played: boolean;
  playing: boolean;
  backlog: boolean;
  wishlist: boolean;
  liked: boolean;
  mastered: boolean;
  /** Backloggd's 0–10 half-star scale (5 stars = 10); null when unrated. */
  rating: number | null;
  startDate: string | null;
  finishDate: string | null;
  /** Total logged time across playthroughs. */
  minutes: number;
  review: string | null;
}

/** RFC 4180 rows: quoted fields may hold commas, quotes ("") and newlines. */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c === '"' && input[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && input[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += c;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter(cells => cells.some(cell => cell.trim() !== ''));
}

/** `https://backloggd.com/games/<slug>/` → `<slug>`. */
export function slugFromBackloggdUrl(url: string): string | null {
  const match = /\/games\/([a-z0-9-]+)\/?(?:[?#].*)?$/.exec(url.trim());
  return match ? match[1] : null;
}

const truthy = (value: string | undefined) => value?.trim().toLowerCase() === 'true';
const number = (value: string | undefined) => {
  const n = Number(value?.trim());
  return value?.trim() && Number.isFinite(n) ? n : 0;
};
const date = (value: string | undefined) => /^\d{4}-\d{2}-\d{2}/.exec(value?.trim() ?? '')?.[0] ?? null;

/** The games in a Toolkittd CSV, or null when the header isn't Toolkittd's. */
export function parseToolkittdCsv(text: string): BackloggdGame[] | null {
  const [header, ...rows] = parseCsvRows(text);
  if (!header) return null;
  const column = new Map(header.map((name, i) => [name.trim(), i]));
  if (!column.has('Game Name') || !column.has('Backloggd URL')) return null;
  const cell = (row: string[], name: string) => {
    const i = column.get(name);
    return i === undefined ? undefined : row[i];
  };
  return rows.map(row => {
    const rating = number(cell(row, 'Rating'));
    return {
      name: cell(row, 'Game Name')?.trim() ?? '',
      slug: slugFromBackloggdUrl(cell(row, 'Backloggd URL') ?? ''),
      played: truthy(cell(row, 'Played')),
      playing: truthy(cell(row, 'Currently Playing')),
      backlog: truthy(cell(row, 'In Backlog')),
      wishlist: truthy(cell(row, 'In Wishlist')),
      liked: truthy(cell(row, 'Liked')),
      mastered: truthy(cell(row, 'Mastered')),
      rating: rating > 0 ? Math.min(rating, 10) : null,
      startDate: date(cell(row, 'Start Date')),
      finishDate: date(cell(row, 'Finish Date')),
      minutes: Math.round(number(cell(row, 'Total Hours')) * 60 + number(cell(row, 'Total Minutes'))),
      review: cell(row, 'Review')?.trim() || null,
    };
  });
}
