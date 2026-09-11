import { fetchAnimeThemes } from '../search/providers/animethemes';
import { parseExternalId } from './mapper-utils';
import { buildAnimeChain } from './anime-tmdb-match';
import { getMediaThemes, saveMediaThemes, type MediaTheme } from '../tauri';

export async function getAnimePrequelThemeOffsets(rawId: string): Promise<{ opOffset: number; edOffset: number }> {
  const { type } = parseExternalId(rawId);
  if (type !== 'anime') return { opOffset: 0, edOffset: 0 };

  const chain = await buildAnimeChain(rawId).catch(() => []);
  const selfIdx = chain.findIndex(e => e.externalId === rawId);
  if (selfIdx <= 0) return { opOffset: 0, edOffset: 0 };

  let opOffset = 0;
  let edOffset = 0;

  const prequels = chain.slice(0, selfIdx);
  for (const prequel of prequels) {
    let themes = await getMediaThemes(prequel.externalId).catch(() => []);
    if (themes.length === 0) {
      const { type: pType, id: numericId } = parseExternalId(prequel.externalId);
      if (pType === 'anime' && numericId) {
        const remote = await fetchAnimeThemes(numericId).catch(() => []);
        if (remote.length > 0) {
          themes = remote.map(t => ({
            external_id: prequel.externalId,
            slug:        t.slug,
            theme_type:  t.themeType,
            sequence:    t.sequence,
            song_title:  t.songTitle,
            artists:     t.artists,
            episodes:    t.episodes,
            video_url:   t.videoUrl,
          }));
          saveMediaThemes(prequel.externalId, themes).catch(() => {});
        }
      }
    }

    const ops = themes.filter(t => t.theme_type === 'OP');
    const eds = themes.filter(t => t.theme_type === 'ED');

    opOffset += new Set(ops.map(t => t.sequence)).size;
    edOffset += new Set(eds.map(t => t.sequence)).size;
  }

  return { opOffset, edOffset };
}

export async function fetchMediaThemes(rawId: string, force = false): Promise<MediaTheme[]> {
  const { opOffset, edOffset } = await getAnimePrequelThemeOffsets(rawId).catch(() => ({ opOffset: 0, edOffset: 0 }));

  if (!force) {
    const cached = await getMediaThemes(rawId).catch(() => []);
    if (cached.length > 0) {
      if (opOffset > 0 || edOffset > 0) {
        const ops = cached.filter(t => t.theme_type === 'OP');
        const eds = cached.filter(t => t.theme_type === 'ED');
        const minOp = ops.length > 0 ? Math.min(...ops.map(t => t.sequence)) : 1;
        const minEd = eds.length > 0 ? Math.min(...eds.map(t => t.sequence)) : 1;
        const needOpShift = opOffset > 0 && ops.length > 0 && minOp <= opOffset;
        const needEdShift = edOffset > 0 && eds.length > 0 && minEd <= edOffset;

        if (needOpShift || needEdShift) {
          const shifted = cached.map(t => {
            let seq = t.sequence;
            if (t.theme_type === 'OP' && needOpShift) seq += opOffset;
            if (t.theme_type === 'ED' && needEdShift) seq += edOffset;
            return { ...t, sequence: seq };
          });
          saveMediaThemes(rawId, shifted).catch(err => console.error('Failed to update shifted themes', err));
          return shifted;
        }
      }
      return cached;
    }
  }

  const { type, id: numericId } = parseExternalId(rawId);
  if (type !== 'anime' || !numericId) return [];

  const themes = await fetchAnimeThemes(numericId).catch(() => []);
  const fresh: MediaTheme[] = themes.map(t => {
    let seq = t.sequence;
    if (t.themeType === 'OP' && opOffset > 0) seq += opOffset;
    if (t.themeType === 'ED' && edOffset > 0) seq += edOffset;
    return {
      external_id: rawId,
      slug:        t.slug,
      theme_type:  t.themeType,
      sequence:    seq,
      song_title:  t.songTitle,
      artists:     t.artists,
      episodes:    t.episodes,
      video_url:   t.videoUrl,
    };
  });

  if (fresh.length > 0) {
    saveMediaThemes(rawId, fresh).catch(err => console.error('Failed to save media themes', err));
  }
  return fresh;
}
