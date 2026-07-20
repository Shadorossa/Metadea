import { REPO_OWNER, REPO_NAME } from './ownership';

export interface GitHubPull {
  number: number;
  html_url: string;
  title: string;
  head: { ref: string };
  user: { login: string } | null;
  created_at: string;
}

async function githubFetch<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({} as { message?: string }));
    throw new Error(data.message || `GitHub request failed: HTTP ${res.status}`);
  }
  return res.json();
}

// Only PRs opened by Metadea's own proposal flow (submitCollaborativeProposal.ts
// always names branches "proposal-*") — excludes unrelated repo housekeeping PRs.
export async function listOpenProposalPulls(token: string): Promise<GitHubPull[]> {
  const pulls = await githubFetch<GitHubPull[]>(
    token,
    `/repos/${REPO_OWNER}/${REPO_NAME}/pulls?state=open&per_page=100`,
  );
  return pulls.filter(pr => pr.head.ref.startsWith('proposal-'));
}

export async function fetchFileAtRef(token: string, path: string, ref: string): Promise<string> {
  const data = await githubFetch<{ content: string }>(
    token,
    `/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}?ref=${encodeURIComponent(ref)}`,
  );
  return decodeURIComponent(escape(atob(data.content)));
}

export interface GitHubFile {
  content: string;
  sha: string;
}

// Same as fetchFileAtRef but also returns the blob sha, needed to update or
// delete the file afterward (GitHub's contents API requires the current sha
// of whatever it's replacing/removing).
export async function getFileAtRef(token: string, path: string, ref: string): Promise<GitHubFile> {
  const data = await githubFetch<{ content: string; sha: string }>(
    token,
    `/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}?ref=${encodeURIComponent(ref)}`,
  );
  return { content: decodeURIComponent(escape(atob(data.content))), sha: data.sha };
}

export interface GitHubDirEntry {
  name: string;
  path: string;
  type: 'file' | 'dir';
}

// Lists every merged collaborative-catalog entry (database/*.json on main) —
// distinct from listOpenProposalPulls, which only lists entries still under
// review.
export async function listDatabaseFiles(token: string): Promise<GitHubDirEntry[]> {
  const entries = await githubFetch<GitHubDirEntry[]>(token, `/repos/${REPO_OWNER}/${REPO_NAME}/contents/database`);
  return entries.filter(e => e.type === 'file' && e.name.endsWith('.json'));
}

export async function deleteFileFromMain(token: string, path: string, sha: string, message: string): Promise<void> {
  await githubFetch(token, `/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, sha, branch: 'main' }),
  });
}

// database/{type}-{id}.json → "{type}:{id}" — mirrors the filename convention
// set by submitCollaborativeProposal.ts (externalId.replace(':', '-')).
export function externalIdFromDatabaseFilename(name: string): string {
  return name.replace(/\.json$/, '').replace('-', ':');
}

export async function mergePull(token: string, number: number): Promise<void> {
  await githubFetch(token, `/repos/${REPO_OWNER}/${REPO_NAME}/pulls/${number}/merge`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ merge_method: 'squash' }),
  });
}

export async function closePull(token: string, number: number): Promise<void> {
  await githubFetch(token, `/repos/${REPO_OWNER}/${REPO_NAME}/pulls/${number}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: 'closed' }),
  });
}
