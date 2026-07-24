import { useState, useEffect } from 'react';
import type { Translations } from '../../i18n/index';
import { listOpenProposalPulls, mergePull, closePull, type GitHubPull } from '../../lib/github/api';
import { openUrlInBrowser } from '../../lib/github/submitCollaborativeProposal';
import { PrPreviewModal } from './PrPreviewModal';
import { IconEye, IconExternalLink, IconCheck, IconX } from '../local/ui/icons';

interface Props {
  token: string;
  i18n: Pick<Translations, 'media' | 'discord' | 'notifications'>;
}

// branch name convention set by submitCollaborativeProposal.ts:
// `proposal-${externalId.replace(':','-')}-${username}`
function externalIdFromBranch(ref: string): string | null {
  const match = ref.match(/^proposal-([a-z]+)-(.+?)-[^-]+$/);
  if (!match) return null;
  return `${match[1]}:${match[2]}`;
}

import { getT } from '../../i18n/client';

export function PullRequestList({ token, i18n }: Props) {
  const t = getT().notifications;
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [pulls, setPulls] = useState<GitHubPull[]>([]);
  const [previewPr, setPreviewPr] = useState<GitHubPull | null>(null);
  const [actioningNumber, setActioningNumber] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    listOpenProposalPulls(token)
      .then(list => { if (!cancelled) { setPulls(list); setState('ready'); } })
      .catch(err => {
        console.error('[PullRequestList] Failed to list open PRs:', err);
        if (!cancelled) setState('error');
      });
    return () => { cancelled = true; };
  }, [token]);

  const previewExternalId = previewPr ? externalIdFromBranch(previewPr.head.ref) : null;

  const handleAccept = async (pr: GitHubPull) => {
    if (!window.confirm(t.accept_confirm)) return;
    setActioningNumber(pr.number);
    try {
      await mergePull(token, pr.number);
      setPulls(prev => prev.filter(p => p.number !== pr.number));
    } catch (err) {
      console.error('[PullRequestList] Failed to merge PR:', err);
      alert(t.accept_error);
    } finally {
      setActioningNumber(null);
    }
  };

  const handleReject = async (pr: GitHubPull) => {
    if (!window.confirm(t.reject_confirm)) return;
    setActioningNumber(pr.number);
    try {
      await closePull(token, pr.number);
      setPulls(prev => prev.filter(p => p.number !== pr.number));
    } catch (err) {
      console.error('[PullRequestList] Failed to close PR:', err);
      alert(t.reject_error);
    } finally {
      setActioningNumber(null);
    }
  };

  return (
    <div className="pr-list-panel">
      <h2 className="pr-list-title">{t.pr_list_title}</h2>

      {state === 'loading' && <p className="pr-list-status">{t.loading_prs}</p>}
      {state === 'error' && <p className="pr-list-status">{t.preview_error}</p>}
      {state === 'ready' && pulls.length === 0 && <p className="pr-list-status">{t.no_open_prs}</p>}

      {state === 'ready' && pulls.length > 0 && (
        <div className="pr-list">
          {pulls.map(pr => (
            <div key={pr.number} className="pr-list-item">
              <div className="pr-list-item-info">
                <span className="pr-list-item-title">{pr.title}</span>
                <span className="pr-list-item-meta">
                  {t.by_user.replace('{username}', pr.user?.login ?? '?')}
                </span>
              </div>
              <div className="pr-list-item-actions">
                {externalIdFromBranch(pr.head.ref) && (
                  <button type="button" className="pr-list-icon-btn" onClick={() => setPreviewPr(pr)} aria-label={t.preview_button} title={t.preview_button}>
                    <IconEye size={16} />
                  </button>
                )}
                <button type="button" className="pr-list-icon-btn" onClick={() => openUrlInBrowser(pr.html_url)} aria-label={t.view_on_github} title={t.view_on_github}>
                  <IconExternalLink size={16} />
                </button>
                <button
                  type="button"
                  className="pr-list-accept-btn"
                  disabled={actioningNumber === pr.number}
                  onClick={() => handleAccept(pr)}
                  title={t.accept_button}
                >
                  <IconCheck size={15} strokeWidth={2.5} />
                  {t.accept_button}
                </button>
                <button
                  type="button"
                  className="pr-list-reject-btn"
                  disabled={actioningNumber === pr.number}
                  onClick={() => handleReject(pr)}
                  title={t.reject_button}
                >
                  <IconX size={13} strokeWidth={2.5} />
                  {t.reject_button}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {previewPr && previewExternalId && (
        <PrPreviewModal
          pr={previewPr}
          token={token}
          externalId={previewExternalId}
          i18n={i18n}
          onClose={() => setPreviewPr(null)}
        />
      )}
    </div>
  );
}
