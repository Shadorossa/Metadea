import { isTauri, invoke, tauriCmd } from './core';

export interface MetaEntry {
  cover_path?:  string;
  banner_path?: string;
}

export async function readMetadataIndex(): Promise<Record<string, MetaEntry>> {
  return tauriCmd<Record<string, MetaEntry>>('read_metadata_index', {});
}

export interface GameInfo {
  app_id:       string;
  name:         string;
  igdb_id?:     number;
  summary?:     string;
  release_date?: number;
  rating?:      number;
  genres?:      string[];
  developers?:  string[];
  publishers?:  string[];
  how_long_to_beat?: {
    main_story_minutes?:    number;
    main_extra_minutes?:    number;
    completionist_minutes?: number;
  };
  last_fetched?: string;
}

export async function readGameInfo(appId: string): Promise<GameInfo | null> {
  if (!isTauri()) return null;
  try {
    const info = await invoke<GameInfo>('read_game_info', { appId });
    return info && Object.keys(info).length > 0 ? info : null;
  } catch { return null; }
}
