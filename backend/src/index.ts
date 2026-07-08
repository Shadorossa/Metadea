import { Router } from "itty-router";
import { handleCors, jsonResponse } from "./middleware/cors";
import { syncLibrary } from "./routes/library";
import { searchGamesRoute } from "./routes/search";
import { googleAuthRedirect, googleAuthCallback, exchangeAuthCode, getMe } from "./routes/auth";
import type { CloudflareEnv } from "./types";

const router = Router<{ Bindings: CloudflareEnv }>();

router.options("*", handleCors);

router.get("/api/health", () =>
  jsonResponse({ status: "ok", timestamp: new Date().toISOString() })
);

// Auth
router.get("/api/auth/google",          (req, env) => googleAuthRedirect(req, env as CloudflareEnv));
router.get("/api/auth/google/callback", (req, env) => googleAuthCallback(req, env as CloudflareEnv));
router.post("/api/auth/exchange",       (req, env) => exchangeAuthCode(req, env as CloudflareEnv));
router.get("/api/auth/me",              (req, env) => getMe(req, env as CloudflareEnv));

// Search
router.get("/api/search/games", (req, env) => searchGamesRoute(req, env as CloudflareEnv));

// Library
router.post("/api/library/sync", syncLibrary);

router.all("*", () => jsonResponse({ error: "Not found" }, 404));

export default router;
