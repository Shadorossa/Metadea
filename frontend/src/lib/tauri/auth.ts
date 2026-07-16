import { isTauri, invoke } from './core';
import { STORAGE_KEYS } from '../shared/storage-keys';

export interface AuthSession {
  token:    string;
  username: string;
}

export async function storeAuthToken(token: string, username: string): Promise<void> {
  localStorage.setItem(STORAGE_KEYS.authToken,    token);
  localStorage.setItem(STORAGE_KEYS.authUsername, username);
  if (isTauri()) await invoke('store_auth_token', { token, username });
}

export async function getAuthToken(): Promise<AuthSession | null> {
  const token    = localStorage.getItem(STORAGE_KEYS.authToken);
  const username = localStorage.getItem(STORAGE_KEYS.authUsername) ?? '';
  if (token) return { token, username };
  if (isTauri()) {
    try {
      const session = await invoke<AuthSession | null>('get_auth_token');
      if (session) {
        localStorage.setItem(STORAGE_KEYS.authToken,    session.token);
        localStorage.setItem(STORAGE_KEYS.authUsername, session.username);
      }
      return session;
    } catch { return null; }
  }
  return null;
}

export async function clearAuthToken(): Promise<void> {
  localStorage.removeItem(STORAGE_KEYS.authToken);
  localStorage.removeItem(STORAGE_KEYS.authUsername);
  if (isTauri()) await invoke('clear_auth_token');
}

export function getAniListToken(): string | null {
  return typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEYS.anilistToken) : null;
}
