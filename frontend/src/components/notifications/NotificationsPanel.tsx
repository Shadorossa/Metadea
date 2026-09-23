import { useHydrated } from '../shared/hooks/useHydrated';
import type { Translations } from '../../i18n/index';
import { useOwnerGate } from '../shared/hooks/useOwnerGate';
import { isRepoOwner } from '../../lib/github/ownership';
import { PullRequestList } from './PullRequestList';

import { getT } from '../../i18n/runtime';

interface Props {
  i18n: Pick<Translations, 'media' | 'discord' | 'notifications' | 'admin'>;
}

// Only the literal repository owner can merge/close catalog PRs from the app.
// Other write collaborators can still submit proposals through GitHub.
// Every other state (loading, signed-out, not-owner)
// falls back to the same "coming soon" placeholder the page used to show statically.
export function NotificationsPanel({ i18n }: Props) {
  const isMounted = useHydrated();

  const gate = useOwnerGate();
  const t = isMounted ? getT().notifications : i18n.notifications;

  if (gate.state === 'owner' && gate.token && isRepoOwner(gate.username)) {
    return <PullRequestList token={gate.token} i18n={i18n} />;
  }

  return (
    <main className="placeholder-page">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-dim)' }}>
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
      <h1 className="placeholder-title">{t.title}</h1>
      <p className="placeholder-text">{t.coming_soon}</p>
    </main>
  );
}
