import { isTauri, invoke } from './core';
import { STORAGE_KEYS } from '../shared/storage-keys';

export interface AuthSession {
  token:    string;
  username: string;
}

export async function storeAuthToken(token: string, username: string): Promise<void> {
  localStorage.setItem('auth_token',    token);
  localStorage.setItem('auth_username', username);
  if (isTauri()) await invoke('store_auth_token', { token, username });
}

export async function getAuthToken(): Promise<AuthSession | null> {
  const token    = localStorage.getItem('auth_token');
  const username = localStorage.getItem('auth_username') ?? '';
  if (token) return { token, username };
  if (isTauri()) {
    try {
      const session = await invoke<AuthSession | null>('get_auth_token');
      if (session) {
        localStorage.setItem('auth_token',    session.token);
        localStorage.setItem('auth_username', session.username);
      }
      return session;
    } catch { return null; }
  }
  return null;
}

export async function clearAuthToken(): Promise<void> {
  localStorage.removeItem('auth_token');
  localStorage.removeItem('auth_username');
  if (isTauri()) await invoke('clear_auth_token');
}

export async function getAniListToken(): Promise<string | null> {
  const token = localStorage.getItem(STORAGE_KEYS.anilistToken);
  return token || null;
}
