import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ZERO_SHA = /^0+$/;
const CHARACTER_CATALOG_ROOT = 'catalog/Characters/';
const REPOSITORY = 'Shadorossa/Metadea';
const HASH_IMAGE_RE = /\/images\/character\/(?:([a-f0-9]{64})\.webp(?:[?#"'\s]|$)|([^/]+)\.webp\?v=([a-f0-9]{64})(?:[&#"'\s]|$))/g;

function runGit(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function trackedCharacterFiles(revision = 'HEAD') {
  return runGit(['ls-tree', '-r', '--name-only', revision, '--', 'catalog/Characters'])
    .split(/\r?\n/)
    .filter(path => path.startsWith(CHARACTER_CATALOG_ROOT) && path.endsWith('.json'));
}

export function changedCharacterCatalogFiles(before, after) {
  const args = ZERO_SHA.test(before)
    ? ['ls-tree', '-r', '--name-only', after, '--', 'catalog/Characters']
    : ['diff', '--name-only', '--diff-filter=ACMRT', before, after, '--', 'catalog/Characters'];
  return execFileSync('git', args, { encoding: 'utf8' })
    .split(/\r?\n/)
    .map(path => path.replaceAll('\\', '/'))
    .filter(path => path.startsWith(CHARACTER_CATALOG_ROOT) && path.endsWith('.json'));
}

function parseCharacter(filePath) {
  const bundle = JSON.parse(readFileSync(filePath, 'utf8'));
  const character = bundle?.character;
  if (!character || typeof character.external_id !== 'string') return null;
  const expectedPath = `${CHARACTER_CATALOG_ROOT}${character.external_id.replaceAll(':', '-')}.json`;
  if (filePath.replaceAll('\\', '/') !== expectedPath) return null;
  return { bundle, character };
}

function extractImageReferences(text) {
  const references = { hashes: new Set(), physicalHashes: new Set(), stableVersions: new Map() };
  for (const match of text.matchAll(HASH_IMAGE_RE)) {
    if (match[1]) {
      references.hashes.add(match[1]);
      references.physicalHashes.add(match[1]);
      continue;
    }
    if (!match[2] || !match[3]) continue;
    references.hashes.add(match[3]);
    try {
      const externalId = decodeURIComponent(match[2]);
      if (externalId.startsWith('character:')) references.stableVersions.set(`${externalId}\0${match[3]}`, { externalId, hash: match[3] });
    } catch {
      // Malformed aliases are not valid references to this catalog's object layout.
    }
  }
  return references;
}

function mergeImageReferences(target, source) {
  for (const hash of source.hashes) target.hashes.add(hash);
  for (const hash of source.physicalHashes) target.physicalHashes.add(hash);
  for (const [key, version] of source.stableVersions) target.stableVersions.set(key, version);
}

function extractLegacyHashes(text) {
  return extractImageReferences(text).hashes;
}

function previousCharacterImageHashes(before, files) {
  if (ZERO_SHA.test(before)) return new Set();
  const hashes = new Set();
  for (const file of files) {
    let bundle;
    try {
      bundle = JSON.parse(execFileSync('git', ['show', `${before}:${file}`], { encoding: 'utf8' }));
    } catch {
      continue;
    }
    const imageUrl = bundle?.character?.image_url;
    if (typeof imageUrl === 'string') {
      for (const hash of extractLegacyHashes(imageUrl)) hashes.add(hash);
    }
  }
  return hashes;
}

async function githubRequest(path, token, accept = 'application/vnd.github+json') {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: accept,
      'User-Agent': 'Metadea-Catalog-Image-Migration',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`GitHub API ${path} respondió ${response.status}.`);
  return response;
}

async function hashesReferencedByOpenPullRequests(token) {
  const references = { hashes: new Set(), physicalHashes: new Set(), stableVersions: new Map() };
  let page = 1;
  while (true) {
    const response = await githubRequest(`/repos/${REPOSITORY}/pulls?state=open&per_page=100&page=${page}`, token);
    const pulls = await response.json();
    if (!Array.isArray(pulls) || pulls.length === 0) break;

    for (const pull of pulls) {
      const head = pull?.head;
      const repository = head?.repo?.full_name;
      const sha = head?.sha;
      const number = pull?.number;
      if (typeof repository !== 'string' || typeof sha !== 'string' || !Number.isInteger(number)) {
        throw new Error('GitHub devolvió una PR abierta sin referencia completa; se omite la limpieza.');
      }

      let filePage = 1;
      while (true) {
        const filesResponse = await githubRequest(`/repos/${REPOSITORY}/pulls/${number}/files?per_page=100&page=${filePage}`, token);
        const files = await filesResponse.json();
        if (!Array.isArray(files) || files.length === 0) break;
        for (const file of files) {
          const filename = file?.filename;
          if (typeof filename !== 'string' || !filename.startsWith('catalog/') || !filename.endsWith('.json')) continue;
          if (file.status === 'removed') continue;
          const rawPath = filename.split('/').map(encodeURIComponent).join('/');
          const rawResponse = await fetch(`https://raw.githubusercontent.com/${repository}/${sha}/${rawPath}`, { cache: 'no-store' });
          if (!rawResponse.ok) throw new Error(`No se pudo revisar ${filename} en la PR #${number}.`);
          mergeImageReferences(references, extractImageReferences(await rawResponse.text()));
        }
        if (files.length < 100) break;
        filePage++;
      }
    }
    if (pulls.length < 100) break;
    page++;
  }
  return references;
}

async function callImageWorker(workerUrl, token, action, data) {
  const oidcRequestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const oidcRequestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!oidcRequestUrl || !oidcRequestToken) throw new Error('GitHub Actions no expuso el endpoint OIDC.');
  const oidcUrl = new URL(oidcRequestUrl);
  oidcUrl.searchParams.set('audience', 'metadea-r2-catalog');
  const oidcResponse = await fetch(oidcUrl, {
    headers: { Authorization: `Bearer ${oidcRequestToken}` },
    cache: 'no-store',
  });
  if (!oidcResponse.ok) throw new Error(`No se pudo obtener la identidad OIDC (${oidcResponse.status}).`);
  const oidcResult = await oidcResponse.json();
  if (typeof oidcResult?.value !== 'string') throw new Error('GitHub no devolvió el token OIDC.');

  const response = await fetch(`${workerUrl}/catalog-images/${action}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${oidcResult.value}`,
      'X-GitHub-Token': token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
    cache: 'no-store',
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(typeof result?.error === 'string' ? result.error : `El Worker respondió ${response.status}.`);
  }
  return result;
}

function readCatalogFiles(files) {
  const entries = [];
  for (const filePath of files) {
    const parsed = parseCharacter(filePath);
    if (parsed) entries.push({ filePath, ...parsed });
  }
  return entries;
}

async function promoteImages({ entries, workerUrl, token, runId, runHeadSha }) {
  const workerOrigin = new URL(workerUrl).origin;
  const promotedHashes = new Set();
  let updated = 0;

  for (const entry of entries) {
    const { character, bundle, filePath } = entry;
    let imageUrl;
    try {
      imageUrl = new URL(character.image_url);
    } catch {
      continue;
    }
    if (imageUrl.origin !== workerOrigin) continue;
    const hashPathMatch = /^\/images\/character\/([a-f0-9]{64})\.webp$/.exec(imageUrl.pathname);
    let sourceHash = hashPathMatch?.[1] ?? null;
    if (!sourceHash) {
      const stableAliasMatch = /^\/images\/character\/([^/]+)\.webp$/.exec(imageUrl.pathname);
      const version = imageUrl.searchParams.get('v');
      if (!stableAliasMatch || !version || !/^[a-f0-9]{64}$/.test(version) || imageUrl.searchParams.size !== 1) continue;
      try {
        if (decodeURIComponent(stableAliasMatch[1]) !== character.external_id) continue;
      } catch {
        continue;
      }
      sourceHash = version;
    }

    const result = await callImageWorker(workerUrl, token, 'promote', {
      runId,
      runHeadSha,
      externalId: character.external_id,
      expectedImageUrl: character.image_url,
    });
    if (typeof result?.imageUrl !== 'string') throw new Error(`El Worker no devolvió URL estable para ${character.external_id}.`);
    if (character.image_url !== result.imageUrl) {
      character.image_url = result.imageUrl;
      writeFileSync(filePath, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
      updated++;
    }
    promotedHashes.add(sourceHash);
  }

  console.log(`Promoted character images to stable R2 keys: ${updated}.`);
  return promotedHashes;
}

async function main() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  const eventName = process.env.GITHUB_EVENT_NAME;
  const workerUrl = process.env.SHARED_IMAGE_WORKER_URL;
  const token = process.env.GH_TOKEN;
  const runId = process.env.GITHUB_RUN_ID;
  const runHeadSha = process.env.GITHUB_SHA;
  if (!eventPath || !workerUrl || !token || !runId || !runHeadSha) {
    throw new Error('Faltan variables de GitHub Actions o SHARED_IMAGE_WORKER_URL.');
  }

  const event = JSON.parse(readFileSync(eventPath, 'utf8'));
  const isManualMigration = eventName === 'workflow_dispatch';
  const isScheduledCleanup = eventName === 'schedule';
  const eventRef = typeof event.ref === 'string' ? event.ref : process.env.GITHUB_REF;
  if (!isManualMigration && eventRef !== 'refs/heads/main') return;

  const files = isManualMigration
    ? trackedCharacterFiles('HEAD')
    : isScheduledCleanup
      ? []
      : (() => {
        if (typeof event.before !== 'string' || typeof event.after !== 'string') {
          throw new Error('El evento push no incluye las revisiones anterior y nueva.');
        }
        return changedCharacterCatalogFiles(event.before, event.after);
      })();

  const entries = readCatalogFiles(files);
  const workerEndpoint = `${new URL(workerUrl).origin}/catalog-images/promote`;
  console.log(isScheduledCleanup
    ? 'Scheduled cleanup only; character image promotion is skipped.'
    : `Checking ${entries.length} character catalog entries via ${workerEndpoint}.`);
  const promotedHashes = await promoteImages({ entries, workerUrl, token, runId, runHeadSha });
  if (!isManualMigration && !isScheduledCleanup && typeof event.before === 'string') {
    for (const hash of previousCharacterImageHashes(event.before, files)) promotedHashes.add(hash);
  }

  const requestedCleanup = String(event.inputs?.cleanup_hashes ?? '')
    .split(/[\s,;]+/)
    .filter(Boolean);
  for (const hash of requestedCleanup) {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error(`Hash de limpieza no válido: ${hash}`);
  }

  runGit(['add', '--', 'catalog/Characters']);
  let hasChanges = true;
  try {
    execFileSync('git', ['diff', '--cached', '--quiet'], { stdio: 'ignore' });
    hasChanges = false;
  } catch {
    hasChanges = true;
  }
  if (hasChanges) {
    execFileSync('git', ['config', 'user.name', 'github-actions[bot]']);
    execFileSync('git', ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
    execFileSync('git', ['commit', '-m', 'chore(catalog): store character images by external ID']);
    execFileSync('git', ['push', 'origin', 'HEAD:main'], { stdio: 'inherit' });
  }

  // Cleanup is fail-closed: if open PRs cannot be inspected, do not delete any
  // hash objects, since their previews may still use the legacy URL.
  try {
    execFileSync('git', ['fetch', 'origin', '+refs/heads/main:refs/remotes/origin/main'], { stdio: 'inherit' });
    const catalogSha = runGit(['rev-parse', 'origin/main']);
    if (catalogSha !== runGit(['rev-parse', 'HEAD'])) {
      throw new Error('main avanzó durante la migración; se omite la limpieza de hashes.');
    }
    const mainReferences = { hashes: new Set(), physicalHashes: new Set(), stableVersions: new Map() };
    for (const path of trackedCharacterFiles('origin/main')) {
      mergeImageReferences(mainReferences, extractImageReferences(readFileSync(path, 'utf8')));
    }
    // Catalog bundles outside Characters can embed the same character record.
    const allCatalogJson = runGit(['ls-tree', '-r', '--name-only', 'origin/main', '--', 'catalog'])
      .split(/\r?\n/).filter(path => path.startsWith('catalog/') && path.endsWith('.json'));
    for (const path of allCatalogJson) {
      if (path.startsWith(CHARACTER_CATALOG_ROOT)) continue;
      mergeImageReferences(mainReferences, extractImageReferences(readFileSync(path, 'utf8')));
    }
    const openPrReferences = await hashesReferencedByOpenPullRequests(token);
    const keepHashes = new Set([...mainReferences.physicalHashes, ...openPrReferences.physicalHashes]);
    const stableVersions = new Map([...mainReferences.stableVersions, ...openPrReferences.stableVersions]);
    const forceDeleteHashes = [...new Set([...promotedHashes, ...requestedCleanup])]
      .filter(hash => !keepHashes.has(hash));
    const result = await callImageWorker(workerUrl, token, 'reconcile', {
      runId,
      runHeadSha,
      catalogSha,
      keepHashes: [...keepHashes],
      stableVersions: [...stableVersions.values()],
      forceDeleteHashes,
    });
    console.log(`Character hash objects deleted: ${result?.deleted ?? 0}; retained for catalog/PR references: ${keepHashes.size}.`);
  } catch (error) {
    console.warn('::warning::R2 image cleanup was deferred and will be retried by the scheduled sweep.');
    console.warn(`Skipped R2 hash cleanup to protect catalog/PR references: ${String(error)}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
