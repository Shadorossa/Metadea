import { useCallback, useEffect, useRef, useState } from 'react';
import type { Translations } from '../../../i18n/index';
import { loadCharacterPageData, type CharacterPageData } from '../../../lib/character/character-page-data';
import { characterSavedMatchesPage } from '../../../lib/character/character-page-id';
import { getFavoriteCustomImage, setCharacterReaction, syncFavorites, wrapAssetUrl } from '../../../lib/tauri';
import { toggleReaction, type CharacterReaction } from '../../../lib/character/character-reactions';
import { formatAppError } from '../../../lib/errors/format-error';
import { showToast } from '../../../lib/dom/toast';
import { getT } from '../../../i18n/runtime';
import { openFavoriteImageEditor } from '../../profile/mount/favorite-image-editor';
import { CharacterPageView } from './CharacterPageView';
import { useCharacterSpoilers } from './useCharacterSpoilers';

interface Props {
  i18n: Pick<Translations, 'character'>;
}

type PageState =
  | { status: 'loading' }
  | { status: 'error'; message: string; layout: 'block' | 'flex' }
  | { status: 'ready'; data: CharacterPageData; loadCount: number };

function currentIdParam(): string {
  return new URLSearchParams(window.location.search).get('id') ?? '';
}

export default function CharacterPage({ i18n }: Props) {
  const t = i18n.character;
  const [state, setState] = useState<PageState>({ status: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);
  const [isFavorite, setIsFavorite] = useState(false);
  const [reaction, setReaction] = useState<CharacterReaction | null>(null);
  // Latest reaction for rapid clicks (each toggles from the last one, not
  // from a stale render's value) and the rollback target on a failed write.
  const reactionRef = useRef<CharacterReaction | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadCharacterPageData(currentIdParam(), t).then(result => {
      if (cancelled) return;
      if (result.status === 'redirect') {
        const targetUrl = new URL(window.location.href);
        targetUrl.searchParams.set('id', result.targetId);
        window.location.replace(targetUrl.toString());
        return;
      }
      if (result.status === 'error') {
        setState({ status: 'error', message: result.message, layout: 'block' });
        return;
      }
      const { data } = result;
      setIsFavorite(data.isFavorite);
      setReaction(data.reaction);
      reactionRef.current = data.reaction;
      setAvatarUrl(data.customImageUrl || data.stickyImage);
      setState(prev => ({ status: 'ready', data, loadCount: prev.status === 'ready' ? prev.loadCount + 1 : 0 }));
    }).catch((err: unknown) => {
      if (cancelled) return;
      console.error('Error in loadCharacterData:', err);
      const message = err instanceof Error ? err.message : String(err);
      setState({ status: 'error', message, layout: 'flex' });
    });
    return () => { cancelled = true; };
  }, [reloadToken, t]);

  // The globally mounted character editor announces a save; reload when it
  // concerns this page's own character.
  useEffect(() => {
    const onSaved = (e: Event) => {
      const detail = (e as CustomEvent<{ externalId?: string } | undefined>).detail;
      if (characterSavedMatchesPage(currentIdParam(), detail?.externalId)) setReloadToken(n => n + 1);
    };
    window.addEventListener('metadea:character-saved', onSaved);
    return () => window.removeEventListener('metadea:character-saved', onSaved);
  }, []);

  const data = state.status === 'ready' ? state.data : null;
  // Spoiler shield (lib/spoilers/): the editor opened from this page is
  // never shielded — only the page itself.
  const spoiler = useCharacterSpoilers(data);

  const handleToggleFavorite = useCallback(async () => {
    if (!data) return;
    const next = !isFavorite;
    setIsFavorite(next);
    await syncFavorites('character', data.externalId, next).catch(console.error);
  }, [data, isFavorite]);

  // Optimistic: the button flips at once and flips back if the write fails.
  const handleReaction = useCallback(async (clicked: CharacterReaction) => {
    if (!data) return;
    const previous = reactionRef.current;
    const next = toggleReaction(previous, clicked);
    reactionRef.current = next;
    setReaction(next);
    try {
      await setCharacterReaction(data.externalId, next);
    } catch (err) {
      if (reactionRef.current === next) {
        reactionRef.current = previous;
        setReaction(previous);
      }
      showToast(formatAppError(err, getT()), 'error');
    }
  }, [data]);

  const handleEditAvatar = useCallback(async () => {
    if (!data) return;
    const currentCustom = await getFavoriteCustomImage(data.externalId).catch(() => null);
    const res = await openFavoriteImageEditor(data.externalId, data.stickyImage || '', currentCustom ?? undefined);
    if (res.action === 'saved') {
      setAvatarUrl(wrapAssetUrl(res.image.image_url));
    } else if (res.action === 'removed') {
      setAvatarUrl(data.stickyImage);
    }
  }, [data]);

  const handleEdit = useCallback(() => {
    if (data) window.__metadeaCharacterEditor?.open(data.externalId);
  }, [data]);

  return (
    <>
      {state.status === 'loading' && (
        <div id="character-loading" className="media-loading">
          <p>{t.loading}</p>
        </div>
      )}

      {state.status === 'error' && (
        <div id="character-error" className="media-error" style={{ display: state.layout }}>
          <p style={{ fontWeight: 700, marginBottom: '0.5rem' }}>{t.load_error}</p>
          <p id="character-error-text" style={{ fontSize: '0.85rem', opacity: 0.8 }}>{state.message}</p>
        </div>
      )}

      {state.status === 'ready' && (
        <CharacterPageView
          // A fresh key per reload resets the per-section UI state (carousel
          // index, language tab, appearance page) like the old full re-render did.
          key={state.loadCount}
          t={t}
          data={state.data}
          avatarUrl={avatarUrl}
          isFavorite={isFavorite}
          reaction={reaction}
          onToggleFavorite={handleToggleFavorite}
          onReaction={handleReaction}
          onEditAvatar={handleEditAvatar}
          onEdit={handleEdit}
          spoiler={spoiler}
        />
      )}
    </>
  );
}
