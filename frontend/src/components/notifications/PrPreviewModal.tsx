import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Translations } from '../../i18n/index';
import type { GitHubPull } from '../../lib/github/api';
import { fetchFileAtRef } from '../../lib/github/api';
import { getCatalogEntry } from '../../lib/tauri/catalog';
import { buildPreviewMediaPageData } from '../../lib/media/mediaService';
import type { ProposalBundle } from '../../lib/github/submitCollaborativeProposal';
import type { MediaPageData } from '../../lib/media/types';
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
  const [state, setState] = useState<State>('loading');
  const [previewData, setPreviewData] = useState<MediaPageData | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const filePath = `database/${externalId.replace(':', '-')}.json`;
        const content = await fetchFileAtRef(token, filePath, pr.head.ref);
        const bundle = JSON.parse(content) as ProposalBundle;
        const baseline = await getCatalogEntry(externalId).catch(() => null);
        if (cancelled) return;
        setPreviewData(buildPreviewMediaPageData(bundle, baseline));
        setState('ready');
      } catch (err) {
        console.error('[PrPreviewModal] Failed to build preview:', err);
        if (!cancelled) setState('error');
      }
    })();

    return () => { cancelled = true; };
  }, [pr.head.ref, externalId, token]);

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
          {state === 'ready' && previewData && (
            <MediaPage i18n={{ media: i18n.media, discord: i18n.discord }} previewData={previewData} previewMode />
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
