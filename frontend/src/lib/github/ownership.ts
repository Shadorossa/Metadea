export const REPO_OWNER = 'Shadorossa';
export const REPO_NAME = 'Metadea';

export function isRepoOwner(username: string): boolean {
  return username.toLowerCase() === REPO_OWNER.toLowerCase();
}

// Plain-JS (non-React) check used by vanilla Astro scripts that only need a
// yes/no answer — e.g. showing/hiding an owner-only nav or settings link —
// without pulling in useOwnerGate's React state machine.
export async function isConnectedAsOwner(): Promise<boolean> {
  try {
    const { invoke } = await import('../tauri');
    const token = await invoke<string | null>('get_github_token').catch(() => null);
    if (!token) return false;
    const user = await invoke<{ login: string }>('get_github_user_profile', { token });
    return isRepoOwner(user.login);
  } catch {
    return false;
  }
}
