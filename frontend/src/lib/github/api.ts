import { REPO_OWNER, REPO_NAME } from './ownership';
import { MEDIA_CATALOG_FOLDERS, catalogRootPath, externalIdFromFilename } from './catalogPaths';

export interface GitHubPull {
  number: number;
  html_url: string;
  title: string;
  // A contributor without push access to the base repo gets forked+PR'd
  // instead (see submitCollaborativeProposal.ts's targetRepoOwner) — head.ref
  // then names a branch that only exists in head.repo (their fork), not in
  // REPO_OWNER/REPO_NAME. Reading the PR's own proposed content (PrPreviewModal)
  // must fetch from head.repo.full_name, not assume the base repo.
  head: { ref: string; repo: { full_name: string } | null };
  user: { login: string } | null;
  created_at: string;
}

export interface GitHubPullFile {
  filename: string;
  status: 'added' | 'modified' | 'removed' | 'renamed' | 'copied' | 'changed' | 'unchanged';
  previous_filename?: string;
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

// Returns every file changed by a PR. The REST endpoint is paginated even
// when a proposal touches several catalog works, so continue until the last
// (short) page instead of silently previewing only its primary JSON.
export async function listPullRequestFiles(token: string, number: number): Promise<GitHubPullFile[]> {
  const files: GitHubPullFile[] = [];
  for (let page = 1; ; page += 1) {
    const batch = await githubFetch<GitHubPullFile[]>(
      token,
      `/repos/${REPO_OWNER}/${REPO_NAME}/pulls/${number}/files?per_page=100&page=${page}`,
    );
    files.push(...batch);
    if (batch.length < 100) return files;
  }
}

// repoFullName defaults to the base repo — pass a PR's own head.repo.full_name
// when reading its proposed content (see GitHubPull.head's own doc comment),
// since a fork-submitted PR's branch only exists there, not in REPO_OWNER/REPO_NAME.
export async function fetchFileAtRef(token: string, path: string, ref: string, repoFullName = `${REPO_OWNER}/${REPO_NAME}`): Promise<string> {
  const data = await githubFetch<{ content: string }>(
    token,
    `/repos/${repoFullName}/contents/${path}?ref=${encodeURIComponent(ref)}`,
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

// Lists every merged collaborative-catalog media entry (catalog/<Type>/*.json
// on main) - distinct from listOpenProposalPulls, which only lists entries
// still under review. Read the catalog root first and request only existing
// type folders, avoiding expected 404s for categories with no files yet.
export async function listDatabaseFiles(token: string): Promise<GitHubDirEntry[]> {
  // Check the root first: querying each configured type folder directly
  // causes harmless 404 network errors for types that have no files yet
  // (for example Books or Comics), which still pollute the WebView console.
  const rootEntries = await githubFetch<GitHubDirEntry[]>(
    token,
    `/repos/${REPO_OWNER}/${REPO_NAME}/contents/${catalogRootPath('')}`,
  );
  const existingFolders = new Set(
    rootEntries.filter(entry => entry.type === 'dir').map(entry => entry.path),
  );
  const perFolder = await Promise.all(MEDIA_CATALOG_FOLDERS
    .map(catalogRootPath)
    .filter(path => existingFolders.has(path))
    .map(path => githubFetch<GitHubDirEntry[]>(token, `/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`)));
  return perFolder.flat().filter(e => e.type === 'file' && e.name.endsWith('.json'));
}

export async function deleteFileFromMain(token: string, path: string, sha: string, message: string): Promise<void> {
  await githubFetch(token, `/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, sha, branch: 'main' }),
  });
}

// catalog/<Folder>/{type}-{id}.json → "{type}:{id}" — the inverse of
// catalogPaths.ts's catalogFilePath, kept there as its single source of
// truth so encode/decode can't drift apart.
export const externalIdFromDatabaseFilename = externalIdFromFilename;

export async function mergePull(token: string, number: number): Promise<void> {
  await githubFetch(token, `/repos/${REPO_OWNER}/${REPO_NAME}/pulls/${number}/merge`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ merge_method: 'squash' }),
  });
}

export interface CatalogFileCommit {
  sha: string;
  message: string;
  author: string | null;
  timestamp: number;
}

// Per-file commit history straight from GitHub — the collaborative editor's
// changelog panel used to show lib/shared/community-sync-log.ts's log
// instead, which only ever records "a bulk community-catalog sync
// happened", the same handful of entries regardless of which specific media
// page the editor was opened from. This shows the history of the one file
// actually being edited. No token required (public repo, unauthenticated
// commits endpoint) — a signed-in token is only used when present, to avoid
// GitHub's much lower unauthenticated rate limit.
export async function fetchCommitHistoryForPath(token: string | null, path: string, perPage = 10): Promise<CatalogFileCommit[]> {
  const res = await fetch(
    `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/commits?path=${encodeURIComponent(path)}&per_page=${perPage}`,
    {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        ...(token ? { 'Authorization': `token ${token}` } : {}),
      },
    },
  );
  if (!res.ok) return [];
  const data = await res.json().catch(() => null) as Array<{
    sha: string;
    commit: { message: string; author: { date: string } | null };
    author: { login: string } | null;
  }> | null;
  if (!data) return [];
  return data.map(c => ({
    sha: c.sha,
    message: c.commit.message.split('\n')[0],
    author: c.author?.login ?? null,
    timestamp: c.commit.author ? new Date(c.commit.author.date).getTime() : Date.now(),
  }));
}

export async function closePull(token: string, number: number): Promise<void> {
  await githubFetch(token, `/repos/${REPO_OWNER}/${REPO_NAME}/pulls/${number}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: 'closed' }),
  });
}
