import { tauriCmd, tauriRun } from './core';

export interface DbMediaStaffMember {
  external_id: string;
  name: string;
  image_url?: string | null;
  role?: string | null;
}

// Get all staff cached locally for a specific media
export async function getMediaStaff(mediaExternalId: string): Promise<DbMediaStaffMember[]> {
  return tauriCmd<DbMediaStaffMember[]>('get_media_staff', [], { mediaExternalId });
}

export interface SkeletonStaffMember {
  external_id: string;
  name: string;
  image_url?: string | null;
  role?: string | null;
}

export async function saveStaffSkeleton(mediaExternalId: string, staff: SkeletonStaffMember[]): Promise<void> {
  return tauriRun('save_staff_skeleton', { mediaExternalId, staff });
}
