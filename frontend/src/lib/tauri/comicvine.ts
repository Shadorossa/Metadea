import { invoke } from './core';

export interface ComicVineImage {
  medium_url: string | null;
  small_url:  string | null;
}

export interface ComicVinePublisher {
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
  id:    number;
  name:  string;
  image: ComicVineImage | null;
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

export interface ComicVineIssueDetail {
  id:                number;
  name:              string | null;
  issue_number:      string | null;
  image:             ComicVineImage | null;
  cover_date:        string | null;
  description:       string | null;
  deck:              string | null;
  volume:            ComicVineVolumeRef | null;
  character_credits: ComicVineCharacterCredit[];
  concept_credits:   ComicVineConceptCredit[];
  person_credits:    ComicVinePersonCredit[];
}

export async function comicVineGetIssue(issueId: number): Promise<ComicVineIssueDetail | null> {
  return invoke<ComicVineIssueDetail | null>('comicvine_get_issue', { issueId });
}

export interface ComicVineVolumeCast {
  characters: ComicVineCharacterCredit[];
  concepts:   ComicVineConceptCredit[];
}

export async function comicVineGetIssuesCast(issueIds: number[]): Promise<ComicVineVolumeCast> {
  return invoke<ComicVineVolumeCast>('comicvine_get_issues_cast', { issueIds });
}
