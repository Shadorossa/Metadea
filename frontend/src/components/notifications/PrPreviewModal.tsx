import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Translations } from '../../i18n/index';
import type { GitHubPull } from '../../lib/github/api';
import { fetchFileAtRef } from '../../lib/github/api';
import { catalogFilePath } from '../../lib/github/catalogPaths';
import { getCatalogEntry } from '../../lib/tauri/catalog';
import { getCharacter, type CharacterEntry } from '../../lib/tauri/characters';
import { buildPreviewMediaPageData, fetchMediaDataInternal } from '../../lib/media/mediaService';
import type { ProposalBundle, CharacterProposalBundle, CharacterProposalAppearance } from '../../lib/github/submitCollaborativeProposal';
import type { MediaPageData } from '../../lib/media/types';
import { CharacterPreviewCard } from '../character/CharacterPreviewCard';
import { IconX } from '../local/ui/icons';
import MediaPage from '../media/MediaPage';

interface Props {
  pr: GitHubPull;
  token: string;
  externalId: string;
  i18n: Pick<Translations, 'media' | 'discord' | 'notifications'>;
  onClose: () => void;
}

type State = 'loading' | 'ready' | 'error';

export function PrPreviewModal({ pr, token, externalId, i18n, onClose }: Props) {
  const t = i18n.notifications;
  const isCharacter = externalId.startsWith('character:');
  const [state, setState] = useState<State>('loading');
  const [previewData, setPreviewData] = useState<MediaPageData | null>(null);
  const [previewCharacter, setPreviewCharacter] = useState<CharacterEntry | null>(null);
  const [previewAppearances, setPreviewAppearances] = useState<CharacterProposalAppearance[]>([]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const filePath = catalogFilePath(externalId);
        // A contributor without push access gets forked+PR'd instead (see
        // GitHubPull.head's own doc comment) — pr.head.ref then names a
        // branch that only exists in their fork, not the base repo.
        const content = await fetchFileAtRef(token, filePath, pr.head.ref, pr.head.repo?.full_name);

        if (isCharacter) {
          // A character has no owning media_catalog row (see
          // catalogPaths.ts) — its proposal file is a CharacterProposalBundle,
          // not a ProposalBundle, so it can't go through
          // buildPreviewMediaPageData/MediaPage at all.
          const bundle = JSON.parse(content) as CharacterProposalBundle;
          const baseline = await getCharacter(externalId).catch(() => null);
          if (cancelled) return;
          // baseline fills in fields this specific proposal didn't touch —
          // same "overlay only what changed" contract buildPreviewMediaPageData
          // uses for media_catalog, just for a character's own fields instead.
          setPreviewCharacter({
            id: baseline?.id ?? '', created_at: baseline?.created_at ?? '', updated_at: baseline?.updated_at ?? '',
            ...baseline,
            ...bundle.character,
            name: bundle.character.name ?? baseline?.name ?? externalId,
          });
          setPreviewAppearances(bundle.appearances ?? []);
        } else {
          const bundle = JSON.parse(content) as ProposalBundle;
          const [baseline, sourceData] = await Promise.all([
            getCatalogEntry(externalId).catch(() => null),
            // Preview the proposal on top of the work as provided by its
            // source (AniList/TMDB/IGDB/etc.). A proposal bundle is a sparse
            // community overlay, not a complete copy of the work's data.
            fetchMediaDataInternal(externalId).catch(() => null),
          ]);
          if (cancelled) return;
          setPreviewData(buildPreviewMediaPageData(bundle, baseline, sourceData));
        }
        setState('ready');
      } catch (err) {
        console.error('[PrPreviewModal] Failed to build preview:', err);
        if (!cancelled) setState('error');
      }
    })();

    return () => { cancelled = true; };
  }, [pr.head.ref, externalId, token, isCharacter]);

  const modal = (
    <div className="me-overlay pr-preview-overlay" onClick={onClose}>
      <div className="pr-preview-container" onClick={e => e.stopPropagation()}>
        <div className="pr-preview-banner">
          <span>{t.preview_banner.replace('{number}', String(pr.number))}</span>
          <button type="button" className="pr-preview-close" onClick={onClose} title={t.close_preview}>
            <IconX size={18} />
          </button>
        </div>
        <div className="pr-preview-body">
          {state === 'loading' && <div className="pr-preview-status">{t.preview_loading}</div>}
          {state === 'error' && <div className="pr-preview-status">{t.preview_error}</div>}
          {state === 'ready' && isCharacter && previewCharacter && (
            <CharacterPreviewCard character={previewCharacter} appearances={previewAppearances} />
          )}
          {state === 'ready' && !isCharacter && previewData && (
            <MediaPage i18n={{ media: i18n.media, discord: i18n.discord }} previewData={previewData} previewMode />
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
