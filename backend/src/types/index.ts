export interface CloudflareEnv {
  TURSO_URL: string;
  TURSO_TOKEN: string;
}

export interface LibrarySyncRequest {
  userId: string;
  items: LibraryItemInput[];
}

export interface LibraryItemInput {
  externalId: string;
  type: string;
  status?: string;
  rating?: number;
  progress?: number;
  minutes_spent?: number;
  is_favorite?: boolean;
  is_platinum?: boolean;
  tags?: string;
  notes?: string;
  selected_platform?: string;
  selected_version?: string;
  started_at?: string;
  finished_at?: string;
}

export interface SyncResponse {
  success: boolean;
  saved: number;
  rejected: number;
  rejectedIds: string[];
}
