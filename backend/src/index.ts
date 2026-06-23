import { Router } from "itty-router";
import { handleCors, jsonResponse } from "./lib/cors";
import { syncLibrary } from "./routes/library";
import { searchGamesRoute } from "./routes/search";
import type { CloudflareEnv } from "./types/index";

const router = Router<{ Bindings: CloudflareEnv }>();

router.options("*", handleCors);

router.get("/api/health", () =>
  jsonResponse({ status: "ok", timestamp: new Date().toISOString() })
);

router.get("/api/search/games", (req, env) => searchGamesRoute(req, env as CloudflareEnv));

router.post("/api/library/sync", syncLibrary);

router.all("*", () => jsonResponse({ error: "Not found" }, 404));

export default router;
