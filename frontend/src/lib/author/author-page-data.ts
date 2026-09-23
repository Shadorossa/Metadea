// Loads an author page (AniList staff or OpenLibrary author) — local-first
// with a sync_state-gated live refresh — into one render-ready view model.
// No DOM here: the React island (components/character/page/AuthorPage)
// renders it. Ported from the former author.astro inline script.
import { fetchAniListStaffDetail, type AniListStaffDetail } from '../search/providers/anilist';
import { fetchOpenLibAuthorFullDetail, bookIdFromWorkKey, type OpenLibAuthorDetail } from '../search/providers/openlibrary';
import { mapExternalFormatToType } from '../media/mappers/mapper-utils';
import { needsResync } from '../media/media-status';
import { parseCSV } from '../shared/text/string-utils';
import type { Translations } from '../../i18n/types';
import {
  getAuthor,
  getAuthorWorks,
  saveAuthorProfileAndRelations,
  getSyncState,
  markSynced,
  markSyncFailed,
  type DbMediaAuthor,
  type AuthorWorkRelation,
  type AuthorWork,
} from '../tauri';

export const AUTHOR_WORKS_PER_PAGE = 16;

export interface AuthorWorkCard {
  url: string;
  title: string;
  cover?: string | null;
  role?: string | null;
  /** Release year, when the provider gives one (career timeline). */
  year?: number;
  /** Provider average on the app's 0–10 scale (scoreGlobal). */
  score?: number;
}

export interface AuthorRenderData {
  name: string;
  nameNative?: string | null;
  aliases: string[];
  image?: string | null;
  /** Raw third-party biography markup — the view sanitizes it before rendering. */
  biography?: string | null;
  birthDate?: string | null;
  deathDate?: string | null;
  works: AuthorWorkCard[];
}

/** Why the page couldn't load — the view turns it into `author_page.errors.*`. */
export type AuthorLoadErrorReason = 'invalid_id' | 'tmdb_unavailable' | 'unsupported_provider' | 'not_found' | 'failed';

export type AuthorPageLoadResult =
  | { status: 'ready'; data: AuthorRenderData }
  | {
    status: 'error';
    reason: AuthorLoadErrorReason;
    /** `unsupported_provider`: the provider prefix; `not_found`: the source
     *  name (AniList/OpenLibrary); `failed`: the technical error, if any. */
    detail?: string;
  };

class AuthorLoadError extends Error {
  constructor(readonly reason: AuthorLoadErrorReason, readonly detail?: string) {
    super(reason);
  }
}

// Purely local reconstruction — used both when sync_state says a resync
// isn't due yet, and as a graceful degrade if a due live fetch fails but a
// local copy still exists (same idea as mediaService.ts's resync backoff).
async function localAuthorToRenderData(externalId: string, a: DbMediaAuthor): Promise<AuthorRenderData> {
  const works: AuthorWork[] = await getAuthorWorks(externalId).catch(() => []);
  return {
    name: a.name,
    nameNative: a.name_native ?? null,
    aliases: parseCSV(a.aliases_csv),
    image: a.image ?? null,
    biography: a.biography ?? null,
    birthDate: a.birth_date ?? null,
    deathDate: a.death_date ?? null,
    works: works.map(w => ({
      url: `/media?id=${w.media_external_id}`,
      title: w.title || w.media_external_id,
      cover: w.cover ?? null,
      role: w.role ?? null,
    })),
  };
}

// Soundtrack/song credits (Insert Song Lyrics, Theme Song Performance,
// Music, ...) show up in the same staffMedia list as real story/art
// credits — AniList has no separate connection for them — but they're
// not representative of an author's actual body of work, so they don't
// belong in the Works grid. AniList can combine several roles for the
// same media into one comma-separated staffRole string (e.g. "Original
// Creator, Insert Song Lyrics (\"...\")") rather than separate edges —
// only drop the work entirely when EVERY part is music-related; when a
// real role is mixed in, keep the work and show that instead of the raw
// (often long, quote-heavy) combined string.
const MUSIC_ROLE_RE = /song|music|composer|lyric/i;
// Preferred display role when a media has more than one real (non-music)
// credit — mirrors anilist-mapper.ts's own author rolePriority order.
const ROLE_DISPLAY_PRIORITY = ['Original Creator', 'Story & Art', 'Story', 'Art', 'Original Story', 'Director'];

function pickDisplayRole(rawRole: string): string | null {
  const parts = rawRole.split(',').map(p => p.trim()).filter(Boolean);
  const realParts = parts.filter(p => !MUSIC_ROLE_RE.test(p));
  if (realParts.length === 0) return null; // every part is music-related — drop this work
  for (const preferred of ROLE_DISPLAY_PRIORITY) {
    const match = realParts.find(p => p.toLowerCase().startsWith(preferred.toLowerCase()));
    if (match) return match;
  }
  return realParts[0];
}

function rolePriorityIndex(r: string): number {
  const idx = ROLE_DISPLAY_PRIORITY.findIndex(p => r.toLowerCase().startsWith(p.toLowerCase()));
  return idx === -1 ? ROLE_DISPLAY_PRIORITY.length : idx;
}

// AniList usually combines several roles on the same media into one
// comma-separated staffRole string on a single edge (handled by
// pickDisplayRole above) — but not always: it can also hand back
// genuinely separate edges for the same media id with different roles
// (e.g. one edge "Chief Supervisor", another "Original Creator" on the
// exact same title), which used to render as duplicate cards for the
// same work. Grouped by media id so every role it found lands on one
// card instead.
export function buildAniListStaffWorks(staff: AniListStaffDetail): AuthorWorkCard[] {
  const worksByMediaId = new Map<string, { url: string; title: string; cover: string | null; roles: string[]; year?: number; score?: number }>();
  for (const edge of staff.staffMedia?.edges || []) {
    const role = pickDisplayRole(edge.staffRole || '');
    if (role === null) continue;
    const item = edge.node;
    const type = mapExternalFormatToType(item.type, item.format);
    const key = `${type}:${item.id}`;
    const existing = worksByMediaId.get(key);
    if (existing) {
      if (!existing.roles.includes(role)) existing.roles.push(role);
    } else {
      // Empty when AniList has no title at all — the view shows its
      // translated "unknown title" placeholder.
      const title = item.title.english || item.title.romaji || '';
      worksByMediaId.set(key, {
        url: `/media?id=${key}`,
        title,
        cover: item.coverImage?.medium || null,
        roles: [role],
        year: item.startDate?.year ?? undefined,
        score: item.averageScore ? item.averageScore / 10 : undefined,
      });
    }
  }
  return Array.from(worksByMediaId.values()).map(w => ({
    url: w.url,
    title: w.title,
    cover: w.cover,
    role: [...w.roles].sort((a, b) => rolePriorityIndex(a) - rolePriorityIndex(b)).join(', '),
    year: w.year,
    score: w.score,
  }));
}

export function aniListStaffToRenderData(staff: AniListStaffDetail): AuthorRenderData {
  return {
    name: staff.name.full,
    nameNative: staff.name.native,
    aliases: staff.name.alternative || [],
    image: staff.image?.large || null,
    biography: staff.description || null,
    birthDate: null,
    deathDate: null,
    works: buildAniListStaffWorks(staff),
  };
}

/** "September 21, 1937" → 1937; undefined when there's no 4-digit year. */
export function yearOfPublishDate(date: string | undefined): number | undefined {
  const match = date ? /\b(\d{4})\b/.exec(date) : null;
  return match ? Number(match[1]) : undefined;
}

export function openLibraryAuthorToRenderData(author: OpenLibAuthorDetail): AuthorRenderData {
  // OpenLibrary uses -1 as a sentinel for "explicitly no photo" rather than
  // omitting the field (same gotcha as fetchOpenLibAuthor, openlibrary.ts)
  // — .length alone doesn't catch it, [-1] still has length 1.
  const realPhotoId = author.photos?.find(id => id > 0);
  const authorPhotoUrl = realPhotoId ? `https://covers.openlibrary.org/a/id/${realPhotoId}-L.jpg` : null;
  const bioText = (typeof author.bio === 'object' ? author.bio?.value : author.bio) || null;
  const works = (author.works || []).map(work => ({
    url: `/media?id=book:${bookIdFromWorkKey(work.key)}`,
    title: work.title,
    cover: work.covers?.length ? `https://covers.openlibrary.org/b/id/${work.covers[0]}-M.jpg` : null,
    role: 'AUTHOR',
    year: yearOfPublishDate(work.first_publish_date),
  }));
  return {
    name: author.name,
    nameNative: null,
    aliases: [],
    image: authorPhotoUrl,
    biography: bioText,
    birthDate: author.birth_date || null,
    deathDate: author.death_date || null,
    works,
  };
}

// Credits the app knows how to translate (author_page.roles); AniList's
// other staff roles ("Chief Supervisor", ...) are provider text and show as-is.
const ROLE_LABEL_KEYS: Record<string, keyof Translations['author_page']['roles']> = {
  'author': 'author',
  'original creator': 'original_creator',
  'story & art': 'story_and_art',
  'story': 'story',
  'art': 'art',
  'original story': 'original_story',
  'director': 'director',
};

/** A work card's role line in the UI language: each comma-separated credit
 *  that is a known role is translated, anything else is kept verbatim. */
export function authorRoleLabel(role: string, labels: Translations['author_page']['roles']): string {
  return role.split(',').map(part => part.trim()).filter(Boolean).map(part => {
    const key = ROLE_LABEL_KEYS[part.toLowerCase()];
    return key ? labels[key] : part;
  }).join(', ');
}

/** `anime:21` out of the card's `/media?id=anime:21` link. */
export function authorWorkExternalId(work: Pick<AuthorWorkCard, 'url'>): string {
  return work.url.slice('/media?id='.length);
}

function toDbRelations(works: AuthorWorkCard[]): AuthorWorkRelation[] {
  return works.map(w => ({
    media_external_id: authorWorkExternalId(w),
    role: w.role,
    title: w.title,
    cover: w.cover,
  }));
}

// Live AniList staff fetch — persists the full profile (name_native/
// aliases/biography, previously never cached at all) and its works list.
async function fetchLiveAniListStaff(externalId: string, idVal: string): Promise<AuthorRenderData | null> {
  const staffId = parseInt(idVal.slice(1), 10);
  if (isNaN(staffId)) throw new AuthorLoadError('invalid_id');

  const staff = await fetchAniListStaffDetail(staffId);
  if (!staff) return null;

  const data = aniListStaffToRenderData(staff);
  const dbAuthor: DbMediaAuthor = {
    external_id: externalId,
    name: staff.name.full,
    image: staff.image?.large || null,
    role: null,
    url: `/author?id=${externalId}`,
    name_native: staff.name.native || null,
    aliases_csv: staff.name.alternative?.length ? staff.name.alternative.join(',') : null,
    biography: staff.description || null,
    birth_date: null,
    death_date: null,
  };
  saveAuthorProfileAndRelations(dbAuthor, toDbRelations(data.works)).catch(console.error);
  return data;
}

// Live OpenLibrary author fetch — same idea, persists birth/death dates too.
async function fetchLiveOpenLibraryAuthor(externalId: string, idVal: string): Promise<AuthorRenderData | null> {
  const author = await fetchOpenLibAuthorFullDetail(idVal);
  if (!author) return null;

  const data = openLibraryAuthorToRenderData(author);
  const dbAuthor: DbMediaAuthor = {
    external_id: externalId,
    name: author.name,
    image: data.image ?? null,
    role: null,
    url: `/author?id=${externalId}`,
    name_native: null,
    aliases_csv: null,
    biography: data.biography ?? null,
    birth_date: author.birth_date || null,
    death_date: author.death_date || null,
  };
  saveAuthorProfileAndRelations(dbAuthor, toDbRelations(data.works)).catch(console.error);
  return data;
}

export async function loadAuthorPageData(externalId: string): Promise<AuthorPageLoadResult> {
  if (!externalId) return { status: 'error', reason: 'invalid_id' };

  try {
    const parts = externalId.split(':');
    const provider = parts[0];
    const idVal = parts.slice(1).join(':');

    // "person:a{id}" (AniList staff) / "person:t{id}" (TMDB staff) share
    // the person: namespace — the leading letter is what keeps the two
    // providers' otherwise-independent numeric ids from colliding, and
    // decides which provider's detail fetch runs below.
    if (provider === 'person' && idVal.startsWith('t')) {
      // TMDB doesn't have its own person-detail page/fetch built yet —
      // fail clearly instead of falling through to the AniList branch
      // below with a mismatched id.
      throw new AuthorLoadError('tmdb_unavailable');
    }
    if (provider !== 'person' && provider !== 'author') {
      throw new AuthorLoadError('unsupported_provider', provider);
    }

    // sync_state gates the live fetch the same way the character page does —
    // this page used to hit AniList/OpenLibrary unconditionally on every
    // single visit regardless of how fresh the local copy already was.
    const localAuthor = await getAuthor(externalId).catch(() => null);
    const syncState = await getSyncState(externalId).catch(() => null);
    const dueForResync = needsResync(syncState ? {
      last_synced_at: syncState.last_synced_at,
      sync_failed_count: syncState.sync_failed_count,
    } : null);

    let data: AuthorRenderData;
    if (dueForResync || !localAuthor) {
      const live = provider === 'person'
        ? await fetchLiveAniListStaff(externalId, idVal)
        : await fetchLiveOpenLibraryAuthor(externalId, idVal);

      if (live) {
        data = live;
        markSynced(externalId).catch(() => {});
      } else if (localAuthor) {
        // Live fetch failed but a local copy exists — degrade instead of a
        // hard error, same backoff-on-failure behavior mediaService.ts uses.
        markSyncFailed(externalId, 'Live fetch returned no data').catch(() => {});
        data = await localAuthorToRenderData(externalId, localAuthor);
      } else {
        throw new AuthorLoadError('not_found', provider === 'person' ? 'AniList' : 'OpenLibrary');
      }
    } else {
      // Not due for a resync and a local copy already exists — skip the
      // live call entirely instead of re-fetching on every page visit.
      data = await localAuthorToRenderData(externalId, localAuthor);
    }

    return { status: 'ready', data };
  } catch (err: unknown) {
    console.error(err);
    if (err instanceof AuthorLoadError) return { status: 'error', reason: err.reason, detail: err.detail };
    const detail = err instanceof Error ? err.message : '';
    return { status: 'error', reason: 'failed', detail: detail || undefined };
  }
}
