export interface CloudflareEnv {
  TURSO_URL:            string;
  TURSO_TOKEN:          string;
  IGDB_CLIENT_ID:       string;
  IGDB_CLIENT_SECRET:   string;
  IGDB_ACCESS_TOKEN?:   string;
  GOOGLE_CLIENT_ID:     string;
  GOOGLE_CLIENT_SECRET: string;
  JWT_SECRET:           string;
  API_URL:              string;
  APP_URL:              string;
}

// userId is deliberately not part of this request body — it's derived from
// the verified JWT (see middleware/auth.ts's requireAuth), never trusted from
// the client, so a caller can't read/overwrite another user's library by
// guessing their id.
export interface LibrarySyncRequest {
  items: LibraryItemInput[];
}

export interface LibraryItemInput {
  externalId:        string;
  type:              string;
  status?:           string;
  rating?:           number;
  progress?:         number;
  minutes_spent?:    number;
  is_favorite?:      boolean;
  is_platinum?:      boolean;
  tags?:             string;
  notes?:            string;
  selected_platform?: string;
  selected_version?:  string;
  started_at?:       string;
  finished_at?:      string;
}

export interface SyncResponse {
  success:     boolean;
  saved:       number;
  rejected:    number;
  rejectedIds: string[];
}
