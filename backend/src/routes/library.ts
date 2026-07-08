import type { IRequest } from "itty-router";
import { jsonResponse, jsonError } from "../middleware/cors";
import { requireAuth } from "../middleware/auth";
import { validateExternalId } from "../services/validation";
import { getTursoClient, saveLibraryItem } from "../services/database";
import type { CloudflareEnv, LibrarySyncRequest, SyncResponse } from "../types";

const MAX_ITEMS_PER_SYNC = 500;

export async function syncLibrary(
  request: IRequest,
  env: CloudflareEnv
): Promise<Response> {
  try {
    const auth = await requireAuth(request, env);
    if (auth instanceof Response) return auth;
    const userId = auth.userId;

    const body = (await request.json()) as LibrarySyncRequest;
    const { items } = body;

    if (!Array.isArray(items) || items.length === 0) {
      return jsonError("Empty items array", 400);
    }

    if (items.length > MAX_ITEMS_PER_SYNC) {
      return jsonError(`Max ${MAX_ITEMS_PER_SYNC} items per sync`, 400);
    }

    // Validate all items in parallel
    const validationResults = await Promise.all(
      items.map(async (item) => ({
        item,
        valid: await validateExternalId(item.externalId, item.type),
      }))
    );

    const validatedItems = validationResults.filter((r) => r.valid).map((r) => r.item);
    const rejectedIds    = validationResults.filter((r) => !r.valid).map((r) => r.item.externalId);

    const db = getTursoClient(env);

    // Save all valid items in parallel
    await Promise.all(validatedItems.map((item) => saveLibraryItem(db, userId, item)));

    const response: SyncResponse = {
      success: true,
      saved: validatedItems.length,
      rejected: rejectedIds.length,
      rejectedIds,
    };

    return jsonResponse(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return jsonError(`Sync failed: ${message}`, 500);
  }
}
