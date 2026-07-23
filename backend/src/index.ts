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

// Every route handler still sets Access-Control-Allow-Origin: "*" via
// jsonResponse/handleCors (middleware/cors.ts) — env.APP_URL isn't available
// at module scope to bake a real origin check in there, since Workers only
// expose bindings/vars per-request. Centralizing the actual origin check
// here, in the one place that DOES have `env`, means every route response
// gets corrected on the way out without having to thread env through each
// of them individually.
//
// The only real client is this project's own Tauri desktop app, not a
// browser tab — its webview origin is `https://tauri.localhost` in a built
// installer (Tauri v2's default WebView2 asset-protocol host on Windows) and
// `http://localhost:4321` in `tauri dev` (Astro's dev server — see
// devUrl in tauri.conf.json). Neither of those is guaranteed to be what
// APP_URL is actually set to (that's a Worker secret, not readable from this
// repo), so this checks both explicitly rather than trusting APP_URL alone —
// getting this wrong would silently break login/sync for every user, not
// just fail to tighten a low-risk header.
const ALLOWED_ORIGINS = new Set(["https://tauri.localhost", "http://localhost:4321"]);

export default {
  async fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext): Promise<Response> {
    const response = await router.fetch(request, env, ctx);
    const origin = request.headers.get("Origin");
    const headers = new Headers(response.headers);
    if (origin && (origin === env.APP_URL || ALLOWED_ORIGINS.has(origin))) {
      headers.set("Access-Control-Allow-Origin", origin);
      headers.append("Vary", "Origin");
    } else {
      headers.delete("Access-Control-Allow-Origin");
    }
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },
};
