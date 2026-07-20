import { useEffect, useState } from 'react';
import { invoke } from '../tauri';
import type { GitHubUserProfile } from '../settings/github';
import { isRepoOwner } from './ownership';

type OwnerGateState = 'loading' | 'owner' | 'not-owner' | 'signed-out';

export interface OwnerGateResult {
  state: OwnerGateState;
  token: string | null;
  username: string | null;
}

// Same GitHub-identity gate used by the proposal flow (isRepoOwner), shared
// so the notifications PR list and the local catalog admin panel don't each
// re-implement this token -> profile -> ownership check.
export function useOwnerGate(): OwnerGateResult {
  const [result, setResult] = useState<OwnerGateResult>({ state: 'loading', token: null, username: null });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const token = await invoke<string | null>('get_github_token').catch(() => null);
      if (!token) {
        if (!cancelled) setResult({ state: 'signed-out', token: null, username: null });
        return;
      }
      try {
        const user = await invoke<GitHubUserProfile>('get_github_user_profile', { token });
        if (cancelled) return;
        setResult({
          state: isRepoOwner(user.login) ? 'owner' : 'not-owner',
          token,
          username: user.login,
        });
      } catch (err) {
        console.error('[useOwnerGate] Failed to fetch GitHub profile:', err);
        if (!cancelled) setResult({ state: 'signed-out', token: null, username: null });
      }
    })();

    return () => { cancelled = true; };
  }, []);

  return result;
}
