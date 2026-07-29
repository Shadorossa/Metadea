import { tauriCmd, tauriRun } from './core';

export interface StoryArcItem {
  id: string;
  media_external_id: string;
  ep_start: number | null;
  ep_end: number | null;
  position: number;
}

export interface StoryArc {
  id: string;
  name: string;
  image_base64: string | null;
  items: StoryArcItem[];
}

export async function getStoryArcsForMedia(mediaExternalId: string): Promise<StoryArc[]> {
  return tauriCmd<StoryArc[]>('get_story_arcs_for_media', [], { mediaExternalId });
}

// Empty arc.id creates a new arc; a non-empty id updates it in place,
// replacing its whole item list (see save_story_arc's own Rust-side comment).
export async function saveStoryArc(arc: StoryArc): Promise<string> {
  return tauriCmd<string>('save_story_arc', arc.id, { arc });
}

export async function deleteStoryArc(arcId: string): Promise<void> {
  return tauriRun('delete_story_arc', { arcId });
}
