import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { Translations } from '../../i18n/index';
import { listOpenProposalPulls, mergePull, closePull, type GitHubPull } from '../../lib/github/api';
import { openUrlInBrowser } from '../../lib/github/submitCollaborativeProposal';
import { externalIdFromFilename } from '../../lib/github/catalogPaths';
import { PrPreviewModal } from './PrPreviewModal';
import { IconEye, IconExternalLink, IconCheck, IconX } from '../local/ui/icons';

interface Props {
  token: string;
  i18n: Pick<Translations, 'media' | 'discord' | 'notifications' | 'admin'>;
}

// branch name convention set by submitCollaborativeProposal.ts:
// `proposal-${externalId.replace(/:/g,'-')}-${username}`. Stripping the
// *exact known* username (from pr.user.login) instead of guessing where the
// id ends via regex — a username containing its own hyphens (e.g.
// "ToniGB-8") made the old lazy-match regex swallow part of the username
// into the reconstructed id (e.g. "949704-ToniGB" instead of "949704"),
// which then 404'd looking up a catalog file that never existed.
function externalIdFromBranch(ref: string, username: string | null | undefined): string | null {
  if (!username || !ref.startsWith('proposal-')) return null;
  const suffix = `-${username}`;
  if (!ref.endsWith(suffix)) return null;
  const stem = ref.slice('proposal-'.length, ref.length - suffix.length);
  return stem ? externalIdFromFilename(`${stem}.json`) : null;
}

import { getT } from '../../i18n/client';

export function PullRequestList({ token, i18n }: Props) {
  const t = getT().notifications;
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [pulls, setPulls] = useState<GitHubPull[]>([]);
  const [previewPr, setPreviewPr] = useState<GitHubPull | null>(null);
  const [actioningNumber, setActioningNumber] = useState<number | null>(null);
  const [pendingAction, setPendingAction] = useState<{ pr: GitHubPull; action: 'accept' | 'reject' } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const requestAction = (pr: GitHubPull, action: 'accept' | 'reject') => {
    setActionError(null);
    setPendingAction({ pr, action });
  };

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

  useEffect(() => {
    if (state !== 'ready') return;
    const currentUrl = new URL(window.location.href);
    const requestedNumber = Number(currentUrl.searchParams.get('preview'));
    if (!Number.isInteger(requestedNumber) || requestedNumber <= 0) return;

    const requestedPull = pulls.find(pr => pr.number === requestedNumber);
    if (requestedPull) setPreviewPr(requestedPull);

    currentUrl.searchParams.delete('preview');
    window.history.replaceState(window.history.state, '', `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`);
  }, [state, pulls]);

  const previewExternalId = previewPr ? externalIdFromBranch(previewPr.head.ref, previewPr.user?.login) : null;

  const performPendingAction = async () => {
    if (!pendingAction) return;
    const { pr, action } = pendingAction;
    setActioningNumber(pr.number);
    setPendingAction(null);
    setActionError(null);
    try {
      if (action === 'accept') await mergePull(token, pr.number);
      else await closePull(token, pr.number);
      setPulls(prev => prev.filter(p => p.number !== pr.number));
      setPreviewPr(current => current?.number === pr.number ? null : current);
    } catch (err) {
      console.error(`[PullRequestList] Failed to ${action === 'accept' ? 'merge' : 'close'} PR:`, err);
      setActionError(action === 'accept' ? t.accept_error : t.reject_error);
    } finally {
      setActioningNumber(null);
    }
  };

  return (
    <div className="pr-list-panel">
      <h2 className="pr-list-title">{t.pr_list_title}</h2>
      {actionError && <p className="pr-list-status pr-list-status--error" role="alert">{actionError}</p>}

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
                {externalIdFromBranch(pr.head.ref, pr.user?.login) && (
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
                  onClick={() => requestAction(pr, 'accept')}
                  title={t.accept_button}
                >
                  <IconCheck size={15} strokeWidth={2.5} />
                  {t.accept_button}
                </button>
                <button
                  type="button"
                  className="pr-list-reject-btn"
                  disabled={actioningNumber === pr.number}
                  onClick={() => requestAction(pr, 'reject')}
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

      {pendingAction && createPortal(
        <div
          className="pr-action-confirm-overlay"
          onMouseDown={event => {
            if (event.target === event.currentTarget) setPendingAction(null);
          }}
        >
          <section className="pr-action-confirm" role="alertdialog" aria-modal="true">
            <p>{pendingAction.action === 'accept' ? t.accept_confirm : t.reject_confirm}</p>
            <div className="pr-action-confirm-buttons">
              <button type="button" className="pr-action-confirm-cancel" onClick={() => setPendingAction(null)}>
                {i18n.admin.cancel_button}
              </button>
              <button
                type="button"
                className={pendingAction.action === 'accept' ? 'pr-list-accept-btn' : 'pr-list-reject-btn'}
                onClick={() => void performPendingAction()}
                disabled={actioningNumber !== null}
              >
                {pendingAction.action === 'accept' ? t.accept_button : t.reject_button}
              </button>
            </div>
          </section>
        </div>,
        document.body,
      )}

      {previewPr && previewExternalId && (
        <PrPreviewModal
          pr={previewPr}
          token={token}
          externalId={previewExternalId}
          i18n={i18n}
          onAccept={() => requestAction(previewPr, 'accept')}
          onReject={() => requestAction(previewPr, 'reject')}
          actioning={actioningNumber === previewPr.number}
          actionError={actionError}
          onClose={() => setPreviewPr(null)}
        />
      )}
    </div>
  );
}
