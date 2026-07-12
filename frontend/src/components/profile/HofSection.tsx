import { useState } from 'react';
import { typeLabel } from '../../lib/profile/utils';
import { wrapAssetUrl } from '../../lib/tauri';
import type { getAllLibraryEntries, MediaCatalogEntry, CharacterEntry, FavoriteCustomImage } from '../../lib/tauri';
import { ICON_CROWN, ICON_PERSON } from '../../lib/shared/icon-strings';
import type { getT } from '../../i18n/client';

type Items = Awaited<ReturnType<typeof getAllLibraryEntries>>;
type P     = ReturnType<typeof getT>['profile'];

// Gradients used for fallback backgrounds by media type
const HOF_GRADIENTS: Record<string, string> = {
  anime:  'linear-gradient(160deg, #4f46e5 0%, #7c3aed 100%)',
  manga:  'linear-gradient(160deg, #be185d 0%, #7c3aed 100%)',
  game:   'linear-gradient(160deg, #047857 0%, #1d4ed8 100%)',
  movie:  'linear-gradient(160deg, #b45309 0%, #dc2626 100%)',
  series: 'linear-gradient(160deg, #1d4ed8 0%, #0891b2 100%)',
  book:   'linear-gradient(160deg, #4d7c0f 0%, #0f766e 100%)',
  novel:  'linear-gradient(160deg, #c2410c 0%, #ca8a04 100%)',
  vnovel: 'linear-gradient(160deg, #a21caf 0%, #e11d48 100%)',
};

const DEFAULT_GRADIENT = 'linear-gradient(160deg, #374151, #1f2937)';

// Pads the ranked items array with nulls to always render exactly 10 slots
function padTo10<T>(items: T[]): (T | null)[] {
  const padded: (T | null)[] = items.slice(0, 10);
  while (padded.length < 10) padded.push(null);
  return padded;
}

interface CardBg {
  imgEl: React.ReactNode;
  fallbackBg: string;
}

// Same approach as the Favorites tab's proven-working cards: a real <img>
// for the raw cover (custom crops use a background-image div instead, since
// bg_size/pos_x/pos_y are CSS background-position/size percentages) — never
// a background-image set on the card itself, which silently failed to
// render in the packaged production build.
function coverStyle(rawCover: string, customImg: FavoriteCustomImage | undefined, fallbackBg: string): CardBg {
  if (customImg) {
    return {
      imgEl: (
        <div
          className="hof-card-bg hof-card-bg--custom"
          style={{
            backgroundImage: `url('${wrapAssetUrl(customImg.image_url)}')`,
            backgroundSize: `${customImg.bg_size}% auto`,
            backgroundPosition: `${customImg.pos_x}% ${customImg.pos_y}%`,
          }}
        />
      ),
      fallbackBg,
    };
  }
  if (rawCover) {
    return { imgEl: <img className="hof-card-bg" src={wrapAssetUrl(rawCover)} />, fallbackBg };
  }
  return { imgEl: null, fallbackBg };
}

interface HofCardProps {
  rank: number;
  cover: CardBg | null;
  label: string;
  type?: string;
}

function HofCard({ rank, cover, label, type }: HofCardProps) {
  if (!cover) {
    return (
      <div className="hof-card hof-card--empty">
        <span className="hof-card-rank">#{rank}</span>
      </div>
    );
  }

  // Only set the fallback gradient as the card's own background when
  // there's no image to draw on top of it — themes with a double/dashed
  // border style (e.g. newspaper-dark) paint the element's own background
  // in the gaps of that border, so leaving the gradient set underneath a
  // fully-covering image bleeds through as a colored ring around the card.
  const style = cover.imgEl ? undefined : { background: cover.fallbackBg };

  return (
    <div className="hof-card" style={style}>
      {cover.imgEl}
      <div className="hof-card-overlay" />
      <span className="hof-card-rank">#{rank}</span>
      <div className="hof-card-label">{label}</div>
      <div className="hof-card-content">
        {type && <span className="hof-card-type">{typeLabel(type)}</span>}
        <span className="hof-card-id">{label}</span>
      </div>
    </div>
  );
}

interface Props {
  items: Items;
  catalogMap: Map<string, MediaCatalogEntry>;
  p: P;
  charFavIds?: string[];
  characterMap?: Map<string, CharacterEntry>;
  customImageMap?: Map<string, FavoriteCustomImage>;
}

export function HofSection({
  items,
  catalogMap,
  p,
  charFavIds = [],
  characterMap = new Map(),
  customImageMap = new Map(),
}: Props) {
  const [view, setView] = useState<'works' | 'chars'>('works');

  const workSlots = padTo10(items).map((item, i) => {
    if (!item) return { rank: i + 1, cover: null, label: '', type: undefined };
    const meta  = catalogMap.get(item.external_id);
    const title = meta?.title_main ?? item.external_id;
    const bg    = HOF_GRADIENTS[item.type] ?? DEFAULT_GRADIENT;
    const cover = coverStyle(meta?.cover_url ?? '', customImageMap.get(item.external_id), bg);
    return { rank: i + 1, cover, label: title, type: item.type };
  });

  const charSlots = padTo10(charFavIds.map(id => characterMap.get(id) ?? null)).map((char, i) => {
    if (!char) return { rank: i + 1, cover: null, label: '', type: undefined };
    const cover = coverStyle(char.image_url ?? '', customImageMap.get(char.external_id), DEFAULT_GRADIENT);
    return { rank: i + 1, cover, label: char.name, type: undefined };
  });

  const slots = view === 'works' ? workSlots : charSlots;

  return (
    <div className="hof-wrapper">
      <div className="hof-row">
        <div className="hof-view-stack">
          <div className="hof-container" id="hof-view">
            {slots.map(s => <HofCard key={s.rank} rank={s.rank} cover={s.cover} label={s.label} type={s.type} />)}
          </div>
        </div>
        <div className="hof-sidebar">
          <button
            type="button"
            className={`hof-btn ${view === 'works' ? 'hof-btn--active' : ''}`}
            title={p.stat_total}
            onClick={() => setView('works')}
            dangerouslySetInnerHTML={{ __html: ICON_CROWN }}
          />
          <div className="hof-sidebar-divider" />
          <button
            type="button"
            className={`hof-btn ${view === 'chars' ? 'hof-btn--active' : ''}`}
            title={p.stat_total}
            onClick={() => setView('chars')}
            dangerouslySetInnerHTML={{ __html: ICON_PERSON }}
          />
        </div>
      </div>
    </div>
  );
}
