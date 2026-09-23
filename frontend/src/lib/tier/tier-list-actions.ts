// Index-page actions that edit a list the editor isn't holding open.
import { getTierList, saveTierList, type TierListDetail } from '../tauri/tier-lists';

/** Rewrites a stored list unchanged except for its name (one transaction). */
export async function renameTierList(id: string, name: string): Promise<void> {
  const detail: TierListDetail = await getTierList(id);
  await saveTierList({
    id,
    name,
    description: detail.description,
    is_public: detail.is_public,
    settings: detail.settings ?? {},
    tiers: detail.tiers,
    items: detail.items.map(item => ({
      external_id: item.external_id,
      tier_key: item.tier_key,
      position: item.position,
      title: item.title_main,
      cover_url: item.cover_url,
      media_type: item.media_type,
    })),
  });
}
