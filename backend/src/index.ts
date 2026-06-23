import { Router } from "itty-router";
import { handleCors, jsonResponse } from "./lib/cors";
import { syncLibrary } from "./routes/library";
import type { CloudflareEnv } from "./types/index";

const router = Router<{ Bindings: CloudflareEnv }>();

// Middleware: CORS
router.options("*", handleCors);

// Routes
router.get("/api/health", () => {
  return jsonResponse({ status: "ok", timestamp: new Date().toISOString() });
});

router.post("/api/library/sync", (request, env) => syncLibrary(request, env));

// 404
router.all("*", () => {
  return jsonResponse({ error: "Not found" }, 404);
});

export default router;
