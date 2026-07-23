import { invoke } from '../tauri';
import type { MediaCatalogEntry, DbMediaRelation, DbMediaAuthor } from '../tauri/catalog';
import type { DbMediaCharacter } from '../tauri/characters';
import type { GitHubUserProfile } from '../settings/github';
import { REPO_OWNER, REPO_NAME, checkRepoWriteAccess } from './ownership';
import { setField } from '../shared/object-utils';
import { catalogFilePath } from './catalogPaths';

export interface ProposalBundle {
  media_catalog: MediaCatalogEntry;
  media_relations: Array<DbMediaRelation & { media_external_id: string }>;
  characters: DbMediaCharacter[];
  media_authors: DbMediaAuthor[];
  saga_name?: string;
}

// A character has no owning media_catalog row — its own file just carries its
// own fields plus the media it appears in (character_appearances' shape),
// independent of any one media's own proposal file.
// Every field but external_id is optional and omitted when unchanged —
// mirrors minimalProposalCatalogEntry's media_catalog equivalent, so a
// proposal that only added a voice actor doesn't also re-propose the name/
// bio/aliases/image as if the user had edited those too (harmless once
// there's an existing upstream file to overlay onto, but with none yet the
// whole object used to get written out verbatim).
export interface CharacterProposalField {
  external_id: string;
  name?: string;
  name_native?: string | null;
  aliases_csv?: string | null;
  biography?: string | null;
  image_url?: string | null;
}

export interface CharacterProposalAppearance {
  media_external_id: string;
  relation_type: string | null;
}

// name/name_native/image_url are omitted for an AniList-sourced actor (see
// CharacterPrEditorModal's addVoiceActor) — that data belongs to AniList,
// not to this proposal, and build-database.js resolves display fields from
// whatever else already knows this actor rather than treating a blank as
// authoritative.
export interface CharacterProposalActor {
  external_id: string;
  name?: string;
  name_native?: string | null;
  image_url?: string | null;
  role?: string | null;
  language?: string | null;
}

export interface CharacterProposalBundle {
  character: CharacterProposalField;
  appearances: CharacterProposalAppearance[];
  actors: CharacterProposalActor[];
}

export type ProposalFileEntry =
  | {
      kind: 'media';
      externalId: string;
      bundle: ProposalBundle;
      // Same purpose as the character variant's below — explicit removals
      // this session made, never written to the on-disk bundle itself.
      removedRelationIds?: string[];
      removedCharacterIds?: string[];
      removedAuthorIds?: string[];
    }
  | {
      kind: 'character';
      externalId: string;
      bundle: CharacterProposalBundle;
      // Explicit removals this editor session made — needed to tell "the
      // user removed this appearance/actor" apart from "this editor never
      // even loaded it" when merging against whatever's upstream (see
      // mergeListByKey). Never itself written to the on-disk bundle.
      removedAppearanceIds?: string[];
      removedActorIds?: string[];
    };

function entryTitle(entry: ProposalFileEntry): string {
  return entry.kind === 'media'
    ? (entry.bundle.media_catalog.title_main || entry.externalId)
    : (entry.bundle.character.name || entry.externalId);
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
      setField(merged, key, local[key]);
    }
  }
  return merged;
}

// Same idea as overlayChangedCatalogFields, for a character's own (much
// smaller) field set.
function overlayChangedCharacterFields(local: CharacterProposalField, upstream: CharacterProposalField): CharacterProposalField {
  const merged: CharacterProposalField = { ...upstream };
  for (const key of Object.keys(local) as (keyof CharacterProposalField)[]) {
    if (key === 'external_id') continue;
    const localVal = local[key] ?? null;
    const upstreamVal = upstream[key] ?? null;
    if (JSON.stringify(localVal) !== JSON.stringify(upstreamVal)) {
      setField(merged, key, local[key]);
    }
  }
  return merged;
}

// Merges a list-shaped field (appearances, actors) against upstream without
// clobbering entries this editor session never saw: anything upstream keeps
// existing unless explicitly removed here, local additions/edits win for
// their own key, and only keys in `removedKeys` actually disappear — an
// upstream entry just missing from `local` (because another user added it
// after this session started) is left untouched instead of being dropped.
function mergeListByKey<T>(upstream: T[], local: T[], removedKeys: string[] | undefined, keyOf: (item: T) => string): T[] {
  const merged = new Map(upstream.map(item => [keyOf(item), item]));
  for (const key of removedKeys ?? []) merged.delete(key);
  for (const item of local) merged.set(keyOf(item), item);
  return Array.from(merged.values());
}

function sharableBundleFor(bundle: ProposalBundle): ProposalBundle {
  // Strip fields that only make sense on this user's own local install
  // before they leave the machine — the shared community catalog every
  // other user pulls from has no business carrying one person's per-install
  // favorite/rating counters or this row's local timestamps as if they were
  // canonical data. Sync bookkeeping itself no longer lives on media_catalog
  // at all (see sync_state.rs), so there's nothing sync-related left to strip
  // here. id/created_at/updated_at can't just be omitted (MediaCatalogEntry
  // requires them) — zeroed out instead, same placeholder convention
  // mapMediaDataToCatalogEntry already uses for `id`, since save_catalog_entry
  // (Rust) always regenerates all three from the existing row on import
  // regardless of what's here.
  const {
    favorites_count, ratings_count,
    ...sharableCatalogEntry
  } = bundle.media_catalog;
  sharableCatalogEntry.created_at = '';
  sharableCatalogEntry.updated_at = '';
  return { ...bundle, media_catalog: sharableCatalogEntry };
}

// Fetches whatever's already published at `filePath` on main, if anything —
// shared by both bundle kinds since the lookup itself doesn't care what's in
// the file, only the merge step afterward does.
async function fetchExistingBundle<T>(filePath: string, token: string): Promise<T | null> {
  const res = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filePath}?ref=main`, {
    headers: { 'Authorization': `token ${token}` },
  });
  if (!res.ok) return null;
  try {
    const data = await res.json();
    return JSON.parse(decodeURIComponent(escape(atob(data.content)))) as T;
  } catch {
    // Malformed/unparseable upstream file — caller falls back to this
    // proposal's own local snapshot rather than blocking the submit.
    return null;
  }
}

async function buildOutgoingContent(fileEntry: ProposalFileEntry, primaryExternalId: string, token: string): Promise<string> {
  const filePath = catalogFilePath(fileEntry.externalId);

  if (fileEntry.kind === 'media') {
    const existingBundle = await fetchExistingBundle<ProposalBundle>(filePath, token);
    let merged = fileEntry.bundle;
    if (existingBundle) {
      const isPrimary = fileEntry.externalId === primaryExternalId;
      merged = {
        ...fileEntry.bundle,
        media_catalog: overlayChangedCatalogFields(fileEntry.bundle.media_catalog, existingBundle.media_catalog),
        media_relations: mergeListByKey(
          existingBundle.media_relations ?? [], fileEntry.bundle.media_relations,
          fileEntry.removedRelationIds, r => r.related_media_external_id,
        ),
        // A non-primary entry (a saga member touched only via relation
        // propagation, not opened in the editor) keeps upstream's
        // characters/authors untouched — this proposal never claims to have
        // edited those, only the relation.
        characters: isPrimary
          ? mergeListByKey(existingBundle.characters ?? [], fileEntry.bundle.characters, fileEntry.removedCharacterIds, c => c.external_id)
          : (existingBundle.characters ?? []),
        media_authors: isPrimary
          ? mergeListByKey(existingBundle.media_authors ?? [], fileEntry.bundle.media_authors, fileEntry.removedAuthorIds, a => a.external_id)
          : (existingBundle.media_authors ?? []),
      };
    }
    return JSON.stringify(sharableBundleFor(merged), null, 2);
  }

  const existingBundle = await fetchExistingBundle<CharacterProposalBundle>(filePath, token);
  const merged: CharacterProposalBundle = existingBundle
    ? {
        character: overlayChangedCharacterFields(fileEntry.bundle.character, existingBundle.character),
        appearances: mergeListByKey(
          existingBundle.appearances ?? [], fileEntry.bundle.appearances,
          fileEntry.removedAppearanceIds, a => a.media_external_id,
        ),
        actors: mergeListByKey(
          existingBundle.actors ?? [], fileEntry.bundle.actors,
          fileEntry.removedActorIds, a => a.external_id,
        ),
      }
    : fileEntry.bundle;
  return JSON.stringify(merged, null, 2);
}

// Handles the workflow of creating a branch, committing one JSON file per
// affected entry, and opening a single GitHub PR covering all of them — e.g.
// adding a saga to "IE GO Luz" also touches "Inazuma Eleven 2"'s own file
// with its reciprocal relation, so both commits ride the same branch/PR
// instead of only the entry that was actually opened in the editor.
export async function submitCollaborativeProposal(
  primaryExternalId: string,
  entries: ProposalFileEntry[],
  changeSummary: string,
  onStatus: (message: string) => void,
): Promise<string | null> {
  if (entries.length === 0) return null;
  const primary = entries.find(e => e.externalId === primaryExternalId) ?? entries[0];

  onStatus('Checking GitHub token...');
  const token = await invoke<string | null>('get_github_token').catch(() => null);
  if (!token) {
    throw new Error('Please log in with GitHub in Metadea Settings to submit proposals.');
  }

  onStatus('Fetching GitHub profile...');
  const user = await invoke<GitHubUserProfile>('get_github_user_profile', { token });
  const username = user.login;

  const branchName = `proposal-${primaryExternalId.replace(':', '-')}-${username}`;

  const isOwner = await checkRepoWriteAccess(token, username);
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
  for (const fileEntry of entries) {
    const { externalId } = fileEntry;
    onStatus(`Uploading data for ${entryTitle(fileEntry)}...`);
    const filePath = catalogFilePath(externalId);

    // If a file for this id is already published on `main`, propose a real
    // diff against it instead of a full re-upload (see buildOutgoingContent).
    const jsonContent = await buildOutgoingContent(fileEntry, primaryExternalId, token);
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
        message: `Update catalog entry for ${entryTitle(fileEntry)}`,
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
  const affectedList = entries.map(e => `- **${entryTitle(e)}** (\`${e.externalId}\`)`).join('\n');
  const prBody = `Proposal submitted from Metadea desktop application by user @${username}.\n\nUpdates collaborative catalog data for:\n${affectedList}\n\n### Changes\n${changeSummary}`;
  const prRes = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/pulls`, {
    method: 'POST',
    headers: {
      'Authorization': `token ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: `[Proposal] Catalog data for ${entryTitle(primary)}`,
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
