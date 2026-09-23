import { useEffect, useState } from 'react';
import { getAllTierLists, type TierListInfo } from '../../lib/tauri/tier-lists';
import { getT } from '../../i18n/runtime';
import { TierListPreview } from './TierListPreview';

// Profile › Lists: the tier lists the user chose to "Show on my profile",
// as mini previews linking to the editor. Local profile only — tier lists
// are not part of the synced public profile yet, so /user never shows them.

export function TierProfileSection() {
  const t = getT().tier;
  const [lists, setLists] = useState<TierListInfo[]>([]);

  useEffect(() => {
    let cancelled = false;
    getAllTierLists().then(all => { if (!cancelled) setLists(all.filter(l => l.is_public)); });
    return () => { cancelled = true; };
  }, []);

  if (lists.length === 0) return null;

  return (
    <section className="tier-profile" aria-labelledby="tier-profile-title">
      <header className="tier-profile-header">
        <h2 id="tier-profile-title" className="tier-profile-title">{t.profile_section}</h2>
        <a className="tier-link-btn" href="/tier">{t.profile_see_all}</a>
      </header>
      <ul className="tier-profile-grid">
        {lists.map(list => (
          <li key={list.id} className="tier-card tier-card--compact">
            <a className="tier-card-link" href={`/tier/new?id=${encodeURIComponent(list.id)}`}>
              <TierListPreview list={list} />
              <span className="tier-card-title">{list.name}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
