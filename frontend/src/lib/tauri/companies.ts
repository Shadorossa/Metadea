import { tauriCmd, tauriRun } from './core';

export interface DbMediaCompany {
  external_id: string;
  name: string;
  logo_url?: string | null;
  /** 'developer' | 'publisher' — see MediaCompany's own doc comment (lib/media/types.ts) for the full per-provider mapping. */
  role: string;
}

// Get all companies (developer/publisher) cached locally for a specific media
export async function getMediaCompanies(mediaExternalId: string): Promise<DbMediaCompany[]> {
  return tauriCmd<DbMediaCompany[]>('get_media_companies', [], { mediaExternalId });
}

export async function saveMediaCompanies(mediaExternalId: string, companies: DbMediaCompany[]): Promise<void> {
  return tauriRun('save_media_companies', { mediaExternalId, companies });
}
