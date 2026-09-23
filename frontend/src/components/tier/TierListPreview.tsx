import type { TierListInfo } from '../../lib/tauri/tier-lists';
import { labelTextColor } from '../../lib/tier/tier-palette';
import { tileCoverSrc } from './TierTile';
import { CoverImage } from '../shared/CoverImage';

// Mini board for index/profile cards: the first rows with their coloured
// label and the first covers of each, packed like the real board.

const PREVIEW_ROWS = 4;
const PREVIEW_TILES = 8;

export function TierListPreview({ list }: { list: TierListInfo }) {
  const rows = list.tiers.slice(0, PREVIEW_ROWS);
  return (
    <div className="tier-preview" aria-hidden="true">
      {rows.map(row => {
        const items = list.preview.filter(p => p.tier_key === row.id).slice(0, PREVIEW_TILES);
        return (
          <div key={row.id} className="tier-preview-row">
            <span className="tier-preview-label" style={{ background: row.color, color: labelTextColor(row.color) }}>{row.label}</span>
            <span className="tier-preview-items">
              {items.map(item => {
                const src = tileCoverSrc(item.cover_url, 'small');
                return src
                  ? <CoverImage key={item.external_id} externalId={item.external_id} src={src} alt="" className="tier-preview-img cover-image-fill" loading="lazy" />
                  : <span key={item.external_id} className="tier-preview-img tier-preview-img--empty" />;
              })}
            </span>
          </div>
        );
      })}
    </div>
  );
}
