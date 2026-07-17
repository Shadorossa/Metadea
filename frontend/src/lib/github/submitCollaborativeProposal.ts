import { invoke } from '../tauri';
import type { MediaCatalogEntry, DbMediaRelation, DbMediaAuthor } from '../tauri/catalog';
import type { DbMediaCharacter } from '../tauri/characters';
import type { GitHubUserProfile } from '../settings/github';
import { REPO_OWNER, REPO_NAME, isRepoOwner } from './ownership';

export interface ProposalBundle {
  media_catalog: MediaCatalogEntry;
  media_relations: Array<DbMediaRelation & { media_external_id: string }>;
  characters: DbMediaCharacter[];
  media_authors: DbMediaAuthor[];
  saga_groups: Record<string, string>;
}

// Handles the workflow of creating a branch, committing catalog JSON data, and opening a GitHub PR.
export async function submitCollaborativeProposal(
  externalId: string,
  bundle: ProposalBundle,
  changeSummary: string,
  onStatus: (message: string) => void,
): Promise<string | null> {
  const entry = bundle.media_catalog;

  onStatus('Checking GitHub token...');
  const token = await invoke<string | null>('get_github_token').catch(() => null);
  if (!token) {
    throw new Error('Please log in with GitHub in Metadea Settings to submit proposals.');
  }

  onStatus('Fetching GitHub profile...');
  const user = await invoke<GitHubUserProfile>('get_github_user_profile', { token });
  const username = user.login;

  // Strip fields that only make sense on this user's own local install
  // before they leave the machine — the shared community catalog every
  // other user pulls from has no business carrying one person's sync
  // bookkeeping or per-install favorite/rating counters as if they were
  // canonical data.
  const {
    last_synced_at, sync_failed_count, last_sync_error, favorites_count, ratings_count,
    ...sharableCatalogEntry
  } = entry;
  const sharableBundle: ProposalBundle = { ...bundle, media_catalog: sharableCatalogEntry };

  const jsonContent = JSON.stringify(sharableBundle, null, 2);
  const base64Content = btoa(unescape(encodeURIComponent(jsonContent)));
  const filePath = `database/${externalId.replace(':', '-')}.json`;
  const branchName = `proposal-${externalId.replace(':', '-')}-${username}`;

  const isOwner = isRepoOwner(username);
  const headRef = isOwner ? branchName : `${username}:${branchName}`;
  let targetRepoOwner = REPO_OWNER;

  if (!isOwner) {
    onStatus('Creating repository fork...');
    const forkRes = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/forks`, {
      method: 'POST',
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json',
      },
    });
    if (!forkRes.ok && forkRes.status !== 202) {
      throw new Error('Failed to create repository fork on GitHub.');
    }
    targetRepoOwner = username;
    onStatus('Waiting for GitHub to prepare the fork (3s)...');
    await new Promise(r => setTimeout(r, 3000));
  }

  onStatus('Getting main branch references...');
  const mainBranchRes = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/git/ref/heads/main`, {
    headers: { 'Authorization': `token ${token}` },
  });
  if (!mainBranchRes.ok) {
    throw new Error('Failed to obtain main branch reference.');
  }
  const mainBranchData = await mainBranchRes.json();
  const mainSha = mainBranchData.object.sha;

  onStatus('Creating proposal branch...');
  const createBranchRes = await fetch(`https://api.github.com/repos/${targetRepoOwner}/${REPO_NAME}/git/refs`, {
    method: 'POST',
    headers: {
      'Authorization': `token ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: mainSha }),
  });
  if (!createBranchRes.ok && createBranchRes.status !== 422) {
    throw new Error('Failed to create proposal branch.');
  }

  let fileSha: string | undefined;
  const fileCheckRes = await fetch(`https://api.github.com/repos/${targetRepoOwner}/${REPO_NAME}/contents/${filePath}?ref=${branchName}`, {
    headers: { 'Authorization': `token ${token}` },
  });
  if (fileCheckRes.ok) {
    const fileCheckData = await fileCheckRes.json();
    fileSha = fileCheckData.sha;
  }

  onStatus('Uploading data to GitHub...');
  const commitRes = await fetch(`https://api.github.com/repos/${targetRepoOwner}/${REPO_NAME}/contents/${filePath}`, {
    method: 'PUT',
    headers: {
      'Authorization': `token ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: `Update catalog entry for ${entry.title_main || externalId}`,
      content: base64Content,
      branch: branchName,
      sha: fileSha,
    }),
  });
  if (!commitRes.ok) {
    throw new Error('Failed to commit JSON file to GitHub.');
  }

  // Always open a PR to keep the workflow consistent and provide a review URL.
  onStatus('Opening Pull Request...');
  const prBody = `Proposal submitted from Metadea desktop application by user @${username}.\n\nUpdates collaborative catalog data for **${entry.title_main || externalId}** (\`${externalId}\`).\n\n### Changes\n${changeSummary}`;
  const prRes = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/pulls`, {
    method: 'POST',
    headers: {
      'Authorization': `token ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: `[Proposal] Catalog data for ${entry.title_main || externalId}`,
      head: headRef,
      base: 'main',
      body: prBody,
    }),
  });

  let prUrl: string | null = null;
  if (!prRes.ok) {
    const prData = await prRes.json().catch(() => ({} as { message?: string; errors?: Array<{ message?: string }> }));
    const message = prData.errors?.[0]?.message || prData.message || '';

    if (message.includes('A pull request already exists')) {
      onStatus('Proposal uploaded! An active Pull Request already exists.');
      const existingRes = await fetch(
        `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/pulls?head=${isOwner ? REPO_OWNER : username}:${branchName}&state=open`,
        { headers: { 'Authorization': `token ${token}` } },
      );
      if (existingRes.ok) {
        const existing = await existingRes.json();
        prUrl = existing?.[0]?.html_url ?? null;
      }
    } else if (message.toLowerCase().includes('no commits between')) {
      // The branch already carries this exact content (e.g. an earlier
      // proposal for the same media+user was already merged, and this
      // resubmission has nothing new on top of a reused branch name) — not
      // a real failure, just nothing new to open a PR about.
      onStatus('Nothing new to submit — this branch has no changes ahead of main.');
    } else {
      // Surface GitHub's actual reason instead of a generic message — a 422
      // here can mean several different things (validation error, branch
      // protection, etc.) and silently swallowing which one made this
      // impossible to diagnose from the console alone.
      throw new Error(`Failed to open Pull Request: ${message || `HTTP ${prRes.status}`}`);
    }
  } else {
    onStatus('Proposal submitted successfully!');
    const prData = await prRes.json();
    prUrl = prData.html_url ?? null;
  }

  return prUrl;
}

export function openUrlInBrowser(url: string): void {
  const tauri = window.__TAURI__;
  if (tauri?.opener?.openUrl) {
    tauri.opener.openUrl(url);
  } else {
    window.open(url, '_blank');
  }
}
