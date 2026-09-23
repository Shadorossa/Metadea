import { isTauri, invoke } from './bridge';
import { STORAGE_KEYS } from '../storage/storage-keys';
import { decodeJwtPayload } from '../shared/text/encoding-utils';

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

/** The signed-in account's email from its session token (the Worker puts it
 *  in the JWT payload), or null. Only ever used as a hint, never trusted. */
export async function accountEmailHint(): Promise<string | null> {
  const session = await getAuthToken().catch(() => null);
  if (!session) return null;
  const email = decodeJwtPayload(session.token).email;
  return typeof email === 'string' && email.includes('@') ? email : null;
}

export async function clearAuthToken(): Promise<void> {
  localStorage.removeItem(STORAGE_KEYS.authToken);
  localStorage.removeItem(STORAGE_KEYS.authUsername);
  if (isTauri()) await invoke('clear_auth_token');
}

export function getAniListToken(): string | null {
  return typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEYS.anilistToken) : null;
}
