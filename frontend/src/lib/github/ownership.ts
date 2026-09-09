export const REPO_OWNER = 'Shadorossa';
export const REPO_NAME = 'Metadea';

function isRepoOwner(username: string): boolean {
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
