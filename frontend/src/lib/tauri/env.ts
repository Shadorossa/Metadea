import { isTauri, invoke } from './core';
import { STORAGE_KEYS } from '../shared/storage-keys';

export interface EnvConfig {
  igdb_client_id?:     string;
  igdb_client_secret?: string;
  steam_api_key?:      string;
  tmdb_access_token?:  string;
  tmdb_api_key?:       string;
  anilist_client_id?:  string;
}

export async function readEnvConfig(): Promise<EnvConfig> {
  if (isTauri()) {
    try {
      const cfg = await invoke<EnvConfig>('read_env_config');
      localStorage.setItem(STORAGE_KEYS.envConfig, JSON.stringify(cfg));
      return cfg;
    } catch { /* fall through */ }
  }
  const stored = localStorage.getItem(STORAGE_KEYS.envConfig);
  if (stored) return JSON.parse(stored);
  return { igdb_client_id: undefined, igdb_client_secret: undefined };
}

export async function writeEnvConfig(config: EnvConfig): Promise<void> {
  localStorage.setItem(STORAGE_KEYS.envConfig, JSON.stringify(config));
  if (isTauri()) {
    try {
      await invoke<void>('write_env_config', { config });
    } catch (err) {
      throw new Error(`write_env_config failed: ${err}`);
    }
  }
}
