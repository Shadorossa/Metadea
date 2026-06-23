import { createClient, Client } from "@libsql/client/web";
import type { CloudflareEnv, LibraryItemInput } from "../types/index";

export function getTursoClient(env: CloudflareEnv): Client {
  return createClient({
    url: env.TURSO_URL,
    authToken: env.TURSO_TOKEN,
  });
}

export async function saveLibraryItem(
  db: Client,
  userId: string,
  item: LibraryItemInput
): Promise<void> {
  const now = new Date().toISOString();

  await db.execute({
    sql: `
      INSERT OR REPLACE INTO user_library
      (user_id, external_id, type, status, rating, progress, minutes_spent,
       is_favorite, is_platinum, tags, notes, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      userId,
      item.externalId,
      item.type,
      item.status || "planning",
      item.rating ?? null,
      item.progress ?? 0,
      item.minutes_spent ?? 0,
      item.is_favorite ? 1 : 0,
      item.is_platinum ? 1 : 0,
      item.tags || "",
      item.notes || "",
      now,
    ],
  });
}
