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
  // Local display order only — save_story_arc never lets an update change it
  // (see its own comment), so this never round-trips through a GitHub sync.
  sort_order: number;
}

export async function getStoryArcsForMedia(mediaExternalId: string): Promise<StoryArc[]> {
  return tauriCmd<StoryArc[]>('get_story_arcs_for_media', [], { mediaExternalId });
}

// Same result shape as calling getStoryArcsForMedia once per id and merging
// by arc.id, but one IPC call/one DB-lock acquisition instead of N — see the
// Rust-side comment on get_story_arcs_for_media_batch for why that matters
// for a saga with many members (e.g. SagaViewerModal).
export async function getStoryArcsForMediaBatch(mediaExternalIds: string[]): Promise<StoryArc[]> {
  return tauriCmd<StoryArc[]>('get_story_arcs_for_media_batch', [], { mediaExternalIds });
}

// Empty arc.id creates a new arc; a non-empty id updates it in place,
// replacing its whole item list (see save_story_arc's own Rust-side comment).
export async function saveStoryArc(arc: StoryArc): Promise<string> {
  return tauriCmd<string>('save_story_arc', arc.id, { arc });
}

// arcIds in the desired final order — only touches those ids' sort_order.
export async function reorderStoryArcs(arcIds: string[]): Promise<void> {
  return tauriRun('reorder_story_arcs', { arcIds });
}

export async function deleteStoryArc(arcId: string): Promise<void> {
  return tauriRun('delete_story_arc', { arcId });
}
