import { invoke } from '@tauri-apps/api/core';
import type { MediaCatalogEntry, DbMediaRelation, DbMediaAuthor } from '../tauri/catalog';
import type { MediaCharacter } from '../tauri/characters';
import type { GitHubUserProfile } from '../settings/github';

const REPO_OWNER = 'Shadorossa';
const REPO_NAME = 'Metadea';

export interface ProposalBundle {
  media_catalog: MediaCatalogEntry;
  media_relations: Array<DbMediaRelation & { media_external_id: string }>;
  characters: MediaCharacter[];
  media_authors: DbMediaAuthor[];
  saga_groups: Record<string, string>;
}

// Everything needed to turn a collaborative-catalog bundle into a GitHub PR:
// fork the repo (if the submitter isn't the owner), branch, commit the JSON
// file, open a PR with a dash-bulleted change summary, and hand back a URL
// the caller can open in the browser. Pulled out of PrEditorModal's
// handleSubmit because none of this is view logic — it's a standalone
// backend-orchestration workflow that's independently testable.
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

  const jsonContent = JSON.stringify(bundle, null, 2);
  const base64Content = btoa(unescape(encodeURIComponent(jsonContent)));
  const filePath = `database/${externalId.replace(':', '-')}.json`;
  const branchName = `proposal-${externalId.replace(':', '-')}-${username}`;

  const isOwner = username.toLowerCase() === REPO_OWNER.toLowerCase();
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

  // Always open a PR (even for the repo owner — a same-repo branch→main PR
  // works fine on GitHub) so the flow is consistent: every submission ends
  // with a real PR the app can open in the browser, prepared with a
  // dash-bulleted list of exactly what changed.
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
    const prData = await prRes.json();
    if (prData.errors?.[0]?.message?.includes('A pull request already exists')) {
      onStatus('Proposal uploaded! An active Pull Request already exists.');
      const existingRes = await fetch(
        `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/pulls?head=${isOwner ? REPO_OWNER : username}:${branchName}&state=open`,
        { headers: { 'Authorization': `token ${token}` } },
      );
      if (existingRes.ok) {
        const existing = await existingRes.json();
        prUrl = existing?.[0]?.html_url ?? null;
      }
    } else {
      throw new Error('Failed to open Pull Request.');
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
