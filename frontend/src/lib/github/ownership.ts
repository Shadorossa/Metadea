export const REPO_OWNER = 'Shadorossa';
export const REPO_NAME = 'Metadea';

export function isRepoOwner(username: string): boolean {
  return username.toLowerCase() === REPO_OWNER.toLowerCase();
}

// GitHub's own "does this account have write access" check — a collaborator
// invited with Write or Admin role, not just the literal repo owner. Used
// instead of isRepoOwner alone wherever "can this account push directly /
// manage the repo" actually means "any trusted collaborator", not just one
// hardcoded username.
async function fetchCollaboratorPermission(token: string, username: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/collaborators/${encodeURIComponent(username)}/permission`,
      { headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json' } },
    );
    if (!res.ok) return null;
    const data = await res.json().catch(() => null) as { permission?: string } | null;
    return data?.permission ?? null;
  } catch {
    return null;
  }
}

// true for the repo owner (fast path, no API call needed) or any invited
// collaborator holding Write/Admin permission — false for a read-only
// collaborator or a non-collaborator (who can still contribute via the
// normal fork+PR flow, just without this level of access).
export async function checkRepoWriteAccess(token: string, username: string): Promise<boolean> {
  if (isRepoOwner(username)) return true;
  const permission = await fetchCollaboratorPermission(token, username);
  return permission === 'admin' || permission === 'write';
}

// Plain-JS (non-React) check used by vanilla Astro scripts that only need a
// yes/no answer — e.g. showing/hiding a write-access-only nav or settings
// link — without pulling in useOwnerGate's React state machine.
export async function isConnectedWithWriteAccess(): Promise<boolean> {
  try {
    const { invoke } = await import('../tauri');
    const token = await invoke<string | null>('get_github_token').catch(() => null);
    if (!token) return false;
    const user = await invoke<{ login: string }>('get_github_user_profile', { token });
    return checkRepoWriteAccess(token, user.login);
  } catch {
    return false;
  }
}
