import type { IRequest } from "itty-router";
import { jsonResponse, jsonError, corsHeaders } from "../lib/cors";
import { validateExternalId } from "../lib/validation";
import { getTursoClient, saveLibraryItem } from "../lib/turso";
import type { CloudflareEnv, LibrarySyncRequest, SyncResponse } from "../types/index";

export async function syncLibrary(
  request: IRequest,
  env: CloudflareEnv
): Promise<Response> {
  try {
    const body = (await request.json()) as LibrarySyncRequest;
    const { userId, items } = body;

    if (!userId || !Array.isArray(items) || items.length === 0) {
      return jsonError("Missing userId or empty items array", 400);
    }

    const validatedItems = [];
    const rejectedItems: string[] = [];

    for (const item of items) {
      const isValid = await validateExternalId(item.externalId, item.type);
      if (isValid) {
        validatedItems.push(item);
      } else {
        rejectedItems.push(item.externalId);
      }
    }

    const db = getTursoClient(env);

    for (const item of validatedItems) {
      await saveLibraryItem(db, userId, item);
    }

    const response: SyncResponse = {
      success: true,
      saved: validatedItems.length,
      rejected: rejectedItems.length,
      rejectedIds: rejectedItems,
    };

    return jsonResponse(response, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return jsonError(`Sync failed: ${message}`, 500);
  }
}
