import type { ReactNode } from 'react';
import type { MediaEpisode } from '../../../lib/tauri';
import type { SagaEntry } from '../../../lib/anilist/saga';
import { fetchMediaEpisodes } from '../../../lib/media/media-page-data';

export function splitTitleAfterColon(title: string): ReactNode {
  const colonIdx = title.indexOf(':');
  if (colonIdx === -1) return title;
  return <>{title.slice(0, colonIdx + 1)}<br />{title.slice(colonIdx + 1).trim()}</>;
}

export function formatEpisodeNumber(episodeNumber: number): string {
  if (episodeNumber < 0) {
    return `Sp${-episodeNumber}`;
  }
  return String(episodeNumber);
}

export function formatThemeEpisodes(rawEpisodes: string | null | undefined, episodeOffset: number): string | null {
  if (!rawEpisodes) return null;
  const trimmed = rawEpisodes.trim();
  if (!trimmed) return null;
  if (episodeOffset <= 0) return trimmed;

  const nums = trimmed.match(/\b\d+\b/g);
  if (!nums || nums.length === 0) return trimmed;

  const firstNum = parseInt(nums[0], 10);
  if (firstNum > episodeOffset) return trimmed;

  return trimmed.replace(/\b\d+\b/g, m => String(parseInt(m, 10) + episodeOffset));
}

export function formatMatchDate(date: string | null | undefined, time: string | null | undefined): string {
  if (!date) return time || '';
  const parsed = new Date(`${date}T${time || '00:00:00'}`);
  if (Number.isNaN(parsed.getTime())) return [date, time].filter(Boolean).join(' ');
  const dateLabel = parsed.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  return time ? `${dateLabel} · ${time.slice(0, 5)}` : dateLabel;
}

export async function fetchUnifiedAnimeEpisodes(chain: SagaEntry[], force = false): Promise<MediaEpisode[]> {
  const lists = await Promise.all(chain.map(entry =>
    fetchMediaEpisodes(entry.externalId, force, undefined, true).catch(() => [] as MediaEpisode[]),
  ));
  const uniqueEpisodes = new Map<string, MediaEpisode>();
  const seenSourceEpisodes = new Set<string>();
  let movieNumber = 0;
  const standaloneAtOffset = new Map<number, number>();
  for (let i = 0; i < lists.length; i++) {
    const isMovie = chain[i].format?.toUpperCase() === 'MOVIE';
    if (isMovie && lists[i].length > 0) movieNumber++;
    for (const episode of lists[i]) {
      // A faulty/stale provider mapping must never make one underlying
      // episode appear under multiple entries in the unified episode stream.
      if (episode.source_key && seenSourceEpisodes.has(episode.source_key)) continue;
      if (episode.source_key) seenSourceEpisodes.add(episode.source_key);
      let displayedEpisode = episode;
      if (isMovie) {
        // The TV stream does not count movies, so place each one fractionally
        // between the surrounding episodes while giving it a parallel Mxx
        // label. Consecutive movies remain stable and cannot replace E01 of
        // the following TV season in the deduplication map.
        const baseOffset = Math.max(0, episode.episode_number - 1);
        const position = (standaloneAtOffset.get(baseOffset) ?? 0) + 1;
        standaloneAtOffset.set(baseOffset, position);
        displayedEpisode = {
          ...episode,
          episode_number: baseOffset + position / (chain.length + 1),
          display_label: `M${String(movieNumber).padStart(2, '0')}`,
        };
      }
      uniqueEpisodes.set(`${displayedEpisode.external_id}:${displayedEpisode.episode_number}`, displayedEpisode);
    }
  }
  return Array.from(uniqueEpisodes.values()).sort((a, b) => {
    if (a.episode_number > 0 && b.episode_number > 0) return a.episode_number - b.episode_number;
    if (a.episode_number < 0 && b.episode_number < 0) return Math.abs(a.episode_number) - Math.abs(b.episode_number);
    return a.episode_number > 0 ? -1 : 1;
  });
}
