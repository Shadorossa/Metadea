import { REPO_OWNER, REPO_NAME } from './ownership';

export interface GitHubPull {
  number: number;
  html_url: string;
  title: string;
  head: { ref: string };
  user: { login: string } | null;
  created_at: string;
}

export async function githubFetch<T>(token: string, path: string, init?: RequestInit): Promise<T> {
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
