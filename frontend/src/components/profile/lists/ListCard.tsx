import { wrapAssetUrl, type FavoriteCustomImage } from '../../../lib/tauri';
import type { CatalogSummary, ListInfo } from '../../../lib/tauri';
import type { CharacterEntry } from '../../../lib/tauri/characters';
import { getT } from '../../../i18n/runtime';
import { fallbackGradient } from '../../../lib/profile/list-display';
import { CoverImage } from '../../shared/CoverImage';

type P = ReturnType<typeof getT>['profile'];

export function ListCard({ list, catalogMap, charactersMap, customImagesMap, p, active, onClick }: {
  list: ListInfo;
  catalogMap: Map<string, CatalogSummary>;
  charactersMap?: Map<string, CharacterEntry>;
  customImagesMap?: Map<string, FavoriteCustomImage>;
  p: P;
  active?: boolean;
  onClick: () => void;
}) {
  const isCharacters = list.list_type === 'characters';
  const isEpisodes = list.list_type === 'episodes';
  const firstId = list.preview_ids.length > 0 ? list.preview_ids[0] : undefined;
  const firstCustom = firstId && customImagesMap ? customImagesMap.get(firstId) : undefined;
  const firstMeta = firstId ? catalogMap.get(firstId) : undefined;
  const firstChar = firstId && charactersMap ? charactersMap.get(firstId) : undefined;
  // A character portrait (getAllCharactersLight) is a local file path;
  // media covers are remote URLs that wrapAssetUrl passes through untouched.
  const rawCoverUrl = isCharacters ? (firstChar?.image_url ?? firstMeta?.cover_url) : firstMeta?.cover_url;
  const coverUrl = firstCustom ? wrapAssetUrl(firstCustom.image_url) : rawCoverUrl ? wrapAssetUrl(rawCoverUrl) : rawCoverUrl;

  return (
    <div className={`list-card${active ? ' list-card--active' : ''}`} onClick={onClick}>
      <div className={`list-card-collage${list.preview_ids.length === 0 ? ' list-card-collage--empty' : ''}`}>
        {list.preview_ids.length > 0
          ? (coverUrl
              ? <CoverImage externalId={firstCustom || isCharacters ? null : firstId} className="list-card-collage-img" src={coverUrl} alt="" loading="lazy" decoding="async" />
              : <div className="list-card-collage-img list-card-collage-fallback" style={{ background: fallbackGradient(firstMeta?.type) }} />)
          : <span className="list-card-empty-icon">{isCharacters ? '👤' : isEpisodes ? '📺' : '📋'}</span>}
      </div>
      <div className="list-card-info">
        <span className="list-card-title">{list.name}</span>
        <span className="list-card-count">
          {list.item_count} {isCharacters ? p.lists_characters_count : isEpisodes ? (p.lists_episodes_count || 'episodios') : p.lists_items}
        </span>
      </div>
    </div>
  );
}
