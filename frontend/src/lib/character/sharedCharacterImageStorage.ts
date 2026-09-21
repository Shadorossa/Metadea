import { SHARED_IMAGE_WORKER_URL } from '../config';
import { invoke } from '../tauri';

const MAX_IMAGE_BYTES = 1024 * 1024;
const MAX_EDGE = 768;
const MAX_SOURCE_BYTES = 16 * 1024 * 1024;

async function readImageSource(sourceUrl: string): Promise<Blob> {
  const response = await fetch(sourceUrl, { mode: 'cors' });
  if (!response.ok) throw new Error('No se pudo leer la imagen de origen.');
  const contentType = response.headers.get('Content-Type')?.split(';')[0].trim() ?? '';
  if (!contentType.startsWith('image/')) throw new Error('El enlace no apunta a una imagen.');
  const declaredSize = Number(response.headers.get('Content-Length'));
  if (Number.isFinite(declaredSize) && declaredSize > MAX_SOURCE_BYTES) throw new Error('La imagen de origen es demasiado grande.');

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No se pudo leer la imagen de origen.');
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_SOURCE_BYTES) {
      await reader.cancel().catch(() => {});
      throw new Error('La imagen de origen supera los 16 MiB.');
    }
    chunks.push(value);
  }
  const buffer = new ArrayBuffer(total);
  const combined = new Uint8Array(buffer);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Blob([buffer], { type: contentType });
}

async function webpBlobFromImageSource(sourceUrl: string): Promise<Blob> {
  const sourceBlob = await readImageSource(sourceUrl);
  const source = await createImageBitmap(sourceBlob);

  try {
    if (sourceBlob.type === 'image/webp'
      && sourceBlob.size <= MAX_IMAGE_BYTES
      && source.width <= MAX_EDGE
      && source.height <= MAX_EDGE) {
      return sourceBlob;
    }

    const scale = Math.min(1, MAX_EDGE / Math.max(source.width, source.height));
    let width = Math.max(1, Math.round(source.width * scale));
    let height = Math.max(1, Math.round(source.height * scale));
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No se pudo preparar la imagen WebP.');

    for (let attempt = 0; attempt < 4; attempt++) {
      canvas.width = width;
      canvas.height = height;
      context.clearRect(0, 0, width, height);
      context.drawImage(source, 0, 0, width, height);

      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', 0.82 - attempt * 0.12));
      if (!blob || blob.type !== 'image/webp') throw new Error('Este dispositivo no pudo codificar la imagen como WebP.');
      if (blob.size <= MAX_IMAGE_BYTES) return blob;

      width = Math.max(1, Math.floor(width * 0.8));
      height = Math.max(1, Math.floor(height * 0.8));
    }
  } finally {
    source.close();
  }

  throw new Error('La imagen sigue siendo demasiado grande después de comprimirla.');
}

export async function uploadImageToSharedCatalog(
  imageUrl: string,
  collection: 'character' | 'media',
  externalId?: string,
): Promise<string> {
  const bucketFolder = collection === 'media' ? 'Media' : 'character';
  if (collection === 'character' && (!externalId || !/^character:[^/?#]+$/.test(externalId))) {
    throw new Error('No se puede subir la imagen sin el external_id del personaje.');
  }
  const isInlineImage = imageUrl.startsWith('data:image/');
  if (/^https?:\/\//i.test(imageUrl)) {
    const workerOrigin = new URL(SHARED_IMAGE_WORKER_URL).origin;
    const sharedUrl = new URL(imageUrl);
    if (sharedUrl.origin === workerOrigin
      && collection === 'media'
      && new RegExp(`^/images/${bucketFolder}/[a-f0-9]{64}\\.webp$`).test(sharedUrl.pathname)) {
      return imageUrl;
    }
    if (collection === 'character' && sharedUrl.origin === workerOrigin) {
      const aliasMatch = /^\/images\/character\/([^/]+)\.webp$/.exec(sharedUrl.pathname);
      const version = sharedUrl.searchParams.get('v');
      if (aliasMatch && version && /^[a-f0-9]{64}$/.test(version) && sharedUrl.searchParams.size === 1) {
        try {
          if (decodeURIComponent(aliasMatch[1]) === externalId) return imageUrl;
        } catch {
          // Treat malformed paths as external images and let normal validation report the failure.
        }
      }
    }
  } else if (!isInlineImage) {
    return imageUrl;
  }

  let image: Blob;
  try {
    image = await webpBlobFromImageSource(imageUrl);
  } catch (error) {
    if (isInlineImage || collection === 'character') {
      throw new Error('No se pudo copiar la imagen al catálogo compartido; revisa que el enlace permita descargarla e inténtalo de nuevo.', { cause: error });
    }
    console.warn('[Shared catalog images] Could not copy the remote image to R2; keeping its source URL.', error);
    return imageUrl;
  }

  const token = await invoke<string | null>('get_github_token').catch(() => null);
  if (!token) throw new Error('Inicia sesión con GitHub en Ajustes para subir imágenes al catálogo.');

  const response = await fetch(`${SHARED_IMAGE_WORKER_URL}/upload/${collection}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'image/webp',
      ...(collection === 'character' ? { 'X-Metadea-Character-Id': externalId as string } : {}),
    },
    body: image,
  });
  const result = await response.json().catch(() => null) as { imageUrl?: unknown; error?: unknown } | null;
  if (!response.ok) {
    const message = typeof result?.error === 'string' ? result.error : `Error al subir la imagen (${response.status}).`;
    throw new Error(message);
  }

  if (typeof result?.imageUrl !== 'string') throw new Error('El Worker no devolvió la URL de la imagen.');
  const sharedUrl = new URL(result.imageUrl);
  const isExpectedCharacterAlias = collection === 'character'
    && sharedUrl.pathname === `/images/character/${externalId!.split(':').map(encodeURIComponent).join(':')}.webp`
    && sharedUrl.searchParams.get('v') !== null
    && /^[a-f0-9]{64}$/.test(sharedUrl.searchParams.get('v') || '')
    && sharedUrl.searchParams.size === 1;
  const isExpectedHashImage = collection === 'media'
    && new RegExp(`^/images/${bucketFolder}/[a-f0-9]{64}\\.webp$`).test(sharedUrl.pathname);
  if (sharedUrl.origin !== new URL(SHARED_IMAGE_WORKER_URL).origin || (!isExpectedCharacterAlias && !isExpectedHashImage)) {
    throw new Error('El Worker devolvió una URL de imagen no válida.');
  }
  return sharedUrl.toString();
}
