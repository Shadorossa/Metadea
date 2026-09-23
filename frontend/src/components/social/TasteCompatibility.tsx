// Taste compatibility on a visited profile: the heart button next to Follow
// that opens the full comparison (TasteCompatibilityModal). A high score
// makes the filled heart beat softly (CSS, off with reduced motion).
// Scoring is lib/social/taste-compatibility.ts; the data is
// get_taste_compatibility, fetched once by UserProfileView.
import { useState } from 'react';
import type { CatalogSummary } from '../../lib/tauri';
import { isHighAffinity, type TasteCompatibility } from '../../lib/social/taste-compatibility';
import { TasteCompatibilityModal } from './TasteCompatibilityModal';
import type { getT } from '../../i18n/runtime';

type SocialStrings = ReturnType<typeof getT>['social'];

interface HeartButtonProps {
  /** undefined while loading (disabled, same box), null when unavailable. */
  taste: TasteCompatibility | null | undefined;
  catalogMap: Map<string, CatalogSummary> | undefined;
  theirName: string;
  theirAvatarUrl: string | null | undefined;
  theirBannerUrl?: string | null;
  s: SocialStrings;
}

export function TasteHeartButton({ taste, catalogMap, theirName, theirAvatarUrl, theirBannerUrl, s }: HeartButtonProps) {
  const [open, setOpen] = useState(false);
  if (taste === null) return null;
  const loading = taste === undefined;
  const high = isHighAffinity(taste);
  return (
    <>
      <button
        type="button"
        className={`taste-heart-btn${high ? ' taste-heart-btn--high' : ''}`}
        data-tooltip={s.taste_label}
        aria-label={s.taste_open}
        aria-haspopup="dialog"
        aria-busy={loading || undefined}
        disabled={loading}
        onClick={() => setOpen(true)}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path d="M12 20.5s-7.5-4.6-9.2-9.3C1.7 8 3.6 4.5 7.1 4.5c2 0 3.6 1.1 4.9 2.9 1.3-1.8 2.9-2.9 4.9-2.9 3.5 0 5.4 3.5 4.3 6.7-1.7 4.7-9.2 9.3-9.2 9.3z" />
        </svg>
      </button>
      {open && taste && catalogMap && (
        <TasteCompatibilityModal
          taste={taste}
          catalogMap={catalogMap}
          theirName={theirName}
          theirAvatarUrl={theirAvatarUrl}
          theirBannerUrl={theirBannerUrl}
          s={s}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
