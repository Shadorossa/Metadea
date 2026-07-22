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
  saga_name?: string;
}

export interface ProposalFileEntry {
  externalId: string;
  bundle: ProposalBundle;
}

// Overlays onto `upstream` only the media_catalog fields where `local`
// actually differs from what's already published — so editing just the
// release date proposes a diff of just the release date, not a full re-copy
// of every other column (synopsis, genres, score, ...) at whatever value
// happened to be cached locally, which could just as easily be staler than
// what's already on `main` as it could be newer. id/created_at/updated_at
// are excluded — those are always reset in sharableBundleFor regardless.
function overlayChangedCatalogFields(local: MediaCatalogEntry, upstream: MediaCatalogEntry): MediaCatalogEntry {
  const merged: MediaCatalogEntry = { ...upstream };
  for (const key of Object.keys(local) as (keyof MediaCatalogEntry)[]) {
    if (key === 'id' || key === 'created_at' || key === 'updated_at') continue;
    const localVal = local[key] ?? null;
    const upstreamVal = upstream[key] ?? null;
    if (JSON.stringify(localVal) !== JSON.stringify(upstreamVal)) {
      (merged as any)[key] = local[key];
    }
  }
  return merged;
}

function sharableBundleFor(bundle: ProposalBundle): ProposalBundle {
  // Strip fields that only make sense on this user's own local install
  // before they leave the machine — the shared community catalog every
  // other user pulls from has no business carrying one person's sync
  // bookkeeping, per-install favorite/rating counters, or this row's local
  // timestamps as if they were canonical data. id/created_at/updated_at
  // can't just be omitted (MediaCatalogEntry requires them) — zeroed out
  // instead, same placeholder convention mapMediaDataToCatalogEntry already
  // uses for `id`, since save_catalog_entry (Rust) always regenerates all
  // three from the existing row on import regardless of what's here.
  const {
    last_synced_at, sync_failed_count, last_sync_error, favorites_count, ratings_count,
    ...sharableCatalogEntry
  } = bundle.media_catalog;
  sharableCatalogEntry.created_at = '';
  sharableCatalogEntry.updated_at = '';
  return { ...bundle, media_catalog: sharableCatalogEntry };
}

// Handles the workflow of creating a branch, committing one JSON file per
// affected media entry, and opening a single GitHub PR covering all of them —
// e.g. adding a saga to "IE GO Luz" also touches "Inazuma Eleven 2"'s own
// file with its reciprocal relation, so both commits ride the same branch/PR
// instead of only the entry that was actually opened in the editor.
export async function submitCollaborativeProposal(
  primaryExternalId: string,
  entries: ProposalFileEntry[],
  changeSummary: string,
  onStatus: (message: string) => void,
): Promise<string | null> {
  if (entries.length === 0) return null;
  const primary = entries.find(e => e.externalId === primaryExternalId) ?? entries[0];
  const entry = primary.bundle.media_catalog;

  onStatus('Checking GitHub token...');
  const token = await invoke<string | null>('get_github_token').catch(() => null);
  if (!token) {
    throw new Error('Please log in with GitHub in Metadea Settings to submit proposals.');
  }

  onStatus('Fetching GitHub profile...');
  const user = await invoke<GitHubUserProfile>('get_github_user_profile', { token });
  const username = user.login;

  const branchName = `proposal-${primaryExternalId.replace(':', '-')}-${username}`;

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

  // One commit per affected entry, all on the same branch — a saga edit that
  // touches N works ends up as N self-contained files (each with just its
  // own relations, not a copy of every other file's data) in one PR.
  for (const { externalId, bundle } of entries) {
    onStatus(`Uploading data for ${bundle.media_catalog.title_main || externalId}...`);
    const filePath = `database/${externalId.replace(':', '-')}.json`;

    // If a file for this id is already published on `main`, propose a real
    // diff against it instead of a full re-upload: media_catalog only
    // carries the fields that actually changed (see overlayChangedCatalogFields).
    // A non-primary entry (a saga member touched only via relation
    // propagation, not opened in the editor) additionally keeps upstream's
    // characters/authors untouched — this proposal never claims to have
    // edited those, only the relation.
    let outgoingBundle = bundle;
    const existingRes = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filePath}?ref=main`, {
      headers: { 'Authorization': `token ${token}` },
    });
    if (existingRes.ok) {
      try {
        const existingData = await existingRes.json();
        const existingBundle = JSON.parse(decodeURIComponent(escape(atob(existingData.content)))) as ProposalBundle;
        outgoingBundle = {
          ...bundle,
          media_catalog: overlayChangedCatalogFields(bundle.media_catalog, existingBundle.media_catalog),
          ...(externalId !== primaryExternalId ? {
            characters: existingBundle.characters ?? [],
            media_authors: existingBundle.media_authors ?? [],
          } : {}),
        };
      } catch {
        // Malformed/unparseable upstream file — fall back to this
        // proposal's own local snapshot rather than blocking the submit.
      }
    }

    const jsonContent = JSON.stringify(sharableBundleFor(outgoingBundle), null, 2);
    const base64Content = btoa(unescape(encodeURIComponent(jsonContent)));

    let fileSha: string | undefined;
    const fileCheckRes = await fetch(`https://api.github.com/repos/${targetRepoOwner}/${REPO_NAME}/contents/${filePath}?ref=${branchName}`, {
      headers: { 'Authorization': `token ${token}` },
    });
    if (fileCheckRes.ok) {
      const fileCheckData = await fileCheckRes.json();
      fileSha = fileCheckData.sha;
    }

    const commitRes = await fetch(`https://api.github.com/repos/${targetRepoOwner}/${REPO_NAME}/contents/${filePath}`, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: `Update catalog entry for ${outgoingBundle.media_catalog.title_main || externalId}`,
        content: base64Content,
        branch: branchName,
        sha: fileSha,
      }),
    });
    if (!commitRes.ok) {
      throw new Error(`Failed to commit JSON file for ${externalId} to GitHub.`);
    }
  }

  // Always open a PR to keep the workflow consistent and provide a review URL.
  onStatus('Opening Pull Request...');
  const affectedList = entries.map(({ externalId, bundle }) => `- **${bundle.media_catalog.title_main || externalId}** (\`${externalId}\`)`).join('\n');
  const prBody = `Proposal submitted from Metadea desktop application by user @${username}.\n\nUpdates collaborative catalog data for:\n${affectedList}\n\n### Changes\n${changeSummary}`;
  const prRes = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/pulls`, {
    method: 'POST',
    headers: {
      'Authorization': `token ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: `[Proposal] Catalog data for ${entry.title_main || primaryExternalId}`,
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
