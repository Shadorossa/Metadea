import { invoke } from './bridge';

export interface ComicVineImage {
  medium_url: string | null;
  small_url:  string | null;
}

export interface ComicVinePublisher {
  id:   number | null;
  name: string | null;
}

export interface ComicVinePersonCredit {
  id:    number;
  name:  string;
  role:  string | null;
  image: ComicVineImage | null;
}

export interface ComicVineVolume {
  id:                number;
  name:              string;
  image:             ComicVineImage | null;
  start_year:        string | null;
  publisher:         ComicVinePublisher | null;
  count_of_issues:   number | null;
  description:       string | null;
  deck:              string | null;
  site_detail_url:   string | null;
  character_credits: ComicVineCharacterCredit[];
  concept_credits:   ComicVineConceptCredit[];
  person_credits:    ComicVinePersonCredit[];
  first_issue_cover_date: string | null;
  last_issue_cover_date:  string | null;
}

export interface ComicVineSearchPage {
  volumes:  ComicVineVolume[];
  has_more: boolean;
}

export interface ComicVineCharacterCredit {
  id:          number;
  name:        string;
  image:       ComicVineImage | null;
  publisher?:  ComicVinePublisher | null;
  deck?:       string | null;
  description?: string | null;
}

export interface ComicVineConceptCredit {
  id:   number;
  name: string;
}

export interface ComicVineIssue {
  id:                number;
  name:              string | null;
  issue_number:      string | null;
  image:             ComicVineImage | null;
  cover_date:        string | null;
  character_credits: ComicVineCharacterCredit[];
  concept_credits:   ComicVineConceptCredit[];
}

export async function comicVineSearch(query: string, page = 1): Promise<ComicVineSearchPage> {
  return invoke<ComicVineSearchPage>('comicvine_search', { query, page });
}

export interface ComicVineCharacterSearchPage {
  characters: ComicVineCharacterCredit[];
  has_more:   boolean;
}

export async function comicVineSearchCharacters(query: string, page = 1): Promise<ComicVineCharacterSearchPage> {
  return invoke<ComicVineCharacterSearchPage>('comicvine_search_characters', { query, page });
}

export async function comicVineGetVolume(volumeId: number): Promise<ComicVineVolume | null> {
  return invoke<ComicVineVolume | null>('comicvine_get_volume', { volumeId });
}

export async function comicVineGetIssues(volumeId: number): Promise<ComicVineIssue[]> {
  return invoke<ComicVineIssue[]>('comicvine_get_issues', { volumeId });
}

export interface ComicVineVolumeRef {
  id:   number;
  name: string;
}

export interface ComicVineVolumeCast {
  characters: ComicVineCharacterCredit[];
  concepts:   ComicVineConceptCredit[];
}

export async function comicVineGetIssuesCast(issueIds: number[]): Promise<ComicVineVolumeCast> {
  return invoke<ComicVineVolumeCast>('comicvine_get_issues_cast', { issueIds });
}

// ── Story arcs (story-arc editor's "Import from ComicVine") ──────────────────
// These commands reject with E_COMICVINE_* codes (formatAppError).

export interface ComicVineResourceRef {
  id:   number;
  name: string | null;
}

export interface ComicVineStoryArc {
  id:                         number;
  name:                       string | null;
  deck:                       string | null;
  description:                string | null;
  image:                      ComicVineImage | null;
  issues:                     ComicVineResourceRef[];
  first_appeared_in_issue:    { id: number; name: string | null; issue_number: string | null } | null;
  count_of_issue_appearances: number | null;
  publisher:                  ComicVinePublisher | null;
}

export interface ComicVineIssueSummary {
  id:           number;
  issue_number: string | null;
  name:         string | null;
  volume:       ComicVineResourceRef | null;
  description:  string | null;
  cover_date:   string | null;
}

export interface ComicVineStoryArcSearchPage {
  story_arcs: ComicVineStoryArc[];
  has_more:   boolean;
}

/** Every arc touching a volume plus all of that volume's issues (numeric
 *  order, with descriptions). `complete` is false when the scan stopped to
 *  stay inside Comic Vine's hourly budget. Cached 30 days on the Rust side. */
export interface ComicVineVolumeArcs {
  volume_id: number;
  arcs:      ComicVineStoryArc[];
  issues:    ComicVineIssueSummary[];
  complete:  boolean;
}

export async function comicVineSearchStoryArcs(query: string, page = 1): Promise<ComicVineStoryArcSearchPage> {
  return invoke<ComicVineStoryArcSearchPage>('comicvine_search_story_arcs', { query, page });
}

export async function comicVineGetStoryArc(storyArcId: number): Promise<ComicVineStoryArc | null> {
  return invoke<ComicVineStoryArc | null>('comicvine_get_story_arc', { storyArcId });
}

export async function comicVineGetIssuesBatch(issueIds: number[]): Promise<ComicVineIssueSummary[]> {
  return invoke<ComicVineIssueSummary[]>('comicvine_get_issues_batch', { issueIds });
}

export async function comicVineStoryArcsForVolume(volumeId: number, refresh = false): Promise<ComicVineVolumeArcs> {
  return invoke<ComicVineVolumeArcs>('comicvine_story_arcs_for_volume', { volumeId, refresh });
}
