import { jsonResponse, jsonError } from '../middleware/cors';
import { getGoogleAuthUrl, exchangeCodeForUser, createToken, verifyToken } from '../services/auth';
import { getTursoClient } from '../services/database';
import type { CloudflareEnv } from '../types';

// ── Exchange code (keeps the session JWT out of the redirect URL) ─────────
// The 90-day session JWT must never ride in a URL — browser history, server/
// proxy access logs, and the Referer header of any third-party resource the
// callback page loads would all end up holding a long-lived bearer credential.
// Instead the redirect carries a random, single-use, short-lived opaque code;
// the frontend POSTs it back to exchangeAuthCode below, which is the only
// place the actual JWT ever appears — in a JSON response body, not a URL.

const EXCHANGE_CODE_TTL_MS = 2 * 60 * 1000; // just long enough for the callback page to load and POST back

// Memoized per warm Worker isolate — CREATE TABLE IF NOT EXISTS is safe to
// call repeatedly, but there's no reason to pay that extra Turso roundtrip on
// every single login once this isolate has already confirmed the table
// exists. Resets to false on a cold start, so the table still gets created
// the first time a fresh isolate handles a request.
let exchangeCodesTableReady = false;

async function ensureExchangeCodesTable(env: CloudflareEnv): Promise<void> {
  if (exchangeCodesTableReady) return;
  const db = getTursoClient(env);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS auth_exchange_codes (
      code       TEXT PRIMARY KEY,
      token      TEXT NOT NULL,
      username   TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  exchangeCodesTableReady = true;
}

// ── OAuth `state` cookie (CSRF protection) ─────────────────────────────────
// Google's `state` round-trip only works as CSRF protection if the value
// came from *this* browser's own redirect, not just any UUID an attacker can
// also generate and paste into a crafted callback URL. Binding it to a
// short-lived, HMAC-signed, httpOnly cookie set during the redirect — and
// requiring the callback's `state` query param to match what's inside that
// cookie — ties the two ends of the flow to the same browser session.

const STATE_COOKIE = 'oauth_state';
const STATE_TTL_SECONDS = 10 * 60; // Google logins are a same-session hop, not a long-lived flow.

function parseCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie') ?? '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function stateCookieHeader(value: string, env: CloudflareEnv, maxAgeSeconds: number): string {
  const secure = env.API_URL.startsWith('https://') ? ' Secure;' : '';
  return `${STATE_COOKIE}=${value}; HttpOnly;${secure} SameSite=Lax; Max-Age=${maxAgeSeconds}; Path=/api/auth/google`;
}

function redirectWithHeaders(location: string, headers: Record<string, string>): Response {
  return new Response(null, { status: 302, headers: { Location: location, ...headers } });
}

// Same memoization rationale as exchangeCodesTableReady above.
let usersTableReady = false;

async function ensureUsersTable(env: CloudflareEnv): Promise<void> {
  if (usersTableReady) return;
  const db = getTursoClient(env);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id         TEXT PRIMARY KEY,
      username   TEXT NOT NULL,
      email      TEXT UNIQUE NOT NULL,
      avatar_url TEXT,
      google_id  TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  usersTableReady = true;
}

function getCallbackUri(env: CloudflareEnv): string {
  return `${env.API_URL}/api/auth/google/callback`;
}

export async function googleAuthRedirect(_req: Request, env: CloudflareEnv): Promise<Response> {
  const state = crypto.randomUUID();
  const url   = getGoogleAuthUrl(env.GOOGLE_CLIENT_ID, getCallbackUri(env), state);

  // The cookie carries a signed copy of `state` so the callback can verify
  // the round-trip actually started in this browser (see verifyToken below),
  // instead of trusting whatever `state` value shows up in the query string.
  const stateToken = await createToken({ state }, env.JWT_SECRET, STATE_TTL_SECONDS / 86400);
  return redirectWithHeaders(url, { 'Set-Cookie': stateCookieHeader(stateToken, env, STATE_TTL_SECONDS) });
}

export async function googleAuthCallback(request: Request, env: CloudflareEnv): Promise<Response> {
  const url   = new URL(request.url);
  const code  = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  const state = url.searchParams.get('state');

  // Cleared on every response path (success, cancel, or CSRF failure) so a
  // captured callback URL can't be replayed against a fresh cookie later.
  const clearStateCookie = stateCookieHeader('', env, 0);

  const fail = (reason: string) =>
    redirectWithHeaders(`${env.APP_URL}/auth/callback?error=${encodeURIComponent(reason)}`, { 'Set-Cookie': clearStateCookie });

  if (error || !code) return fail('cancelled');

  const stateCookie = parseCookie(request, STATE_COOKIE);
  const statePayload = stateCookie ? await verifyToken(stateCookie, env.JWT_SECRET) : null;
  if (!state || !statePayload || statePayload.state !== state) {
    return fail('invalid_state');
  }

  let step = 'init';
  try {
    step = 'exchange_code';
    const googleUser = await exchangeCodeForUser(
      code,
      env.GOOGLE_CLIENT_ID,
      env.GOOGLE_CLIENT_SECRET,
      getCallbackUri(env),
    );

    step = 'ensure_table';
    await ensureUsersTable(env);

    step = 'select_user';
    const db = getTursoClient(env);
    const existing = await db.execute({
      sql:  'SELECT id, username FROM users WHERE google_id = ?',
      args: [googleUser.id],
    });

    let userId:   string;
    let username: string;

    step = 'upsert_user';
    if (existing.rows.length === 0) {
      // New user — insert (ignore if raced by a duplicate request)
      const newUserId  = crypto.randomUUID();
      const newUsername = googleUser.name
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-zA-Z0-9]/g, '')
        .toLowerCase()
        .slice(0, 20) || `user${Date.now().toString(36)}`;

      await db.execute({
        sql:  `INSERT OR IGNORE INTO users (id, username, email, avatar_url, google_id, created_at)
               VALUES (?, ?, ?, ?, ?, ?)`,
        args: [newUserId, newUsername, googleUser.email, googleUser.picture ?? null, googleUser.id, new Date().toISOString()],
      });
    }

    // Always re-select to get the definitive userId/username (handles new + existing)
    const user = await db.execute({
      sql:  'SELECT id, username FROM users WHERE google_id = ?',
      args: [googleUser.id],
    });
    userId   = user.rows[0].id as string;
    username = user.rows[0].username as string;

    step = 'create_token';
    const token = await createToken(
      { userId, username, email: googleUser.email, avatar: googleUser.picture ?? null },
      env.JWT_SECRET,
      90,
    );

    step = 'store_exchange_code';
    await ensureExchangeCodesTable(env);
    const exchangeCode = crypto.randomUUID();
    await db.execute({
      sql:  'INSERT INTO auth_exchange_codes (code, token, username, created_at) VALUES (?, ?, ?, ?)',
      args: [exchangeCode, token, username, new Date().toISOString()],
    });
    // Best-effort cleanup of anything nobody ever redeemed — keeps the table
    // from growing unbounded without needing a separate scheduled job.
    await db.execute({
      sql:  "DELETE FROM auth_exchange_codes WHERE created_at < ?",
      args: [new Date(Date.now() - EXCHANGE_CODE_TTL_MS).toISOString()],
    }).catch(() => {});

    step = 'redirect';
    const redirect = `${env.APP_URL}/auth/callback?code=${encodeURIComponent(exchangeCode)}`;
    return redirectWithHeaders(redirect, { 'Set-Cookie': clearStateCookie });

  } catch (err) {
    const message = err instanceof Error
      ? err.message
      : typeof err === 'object'
        ? JSON.stringify(err)
        : String(err);
    console.error(`[auth] FAILED at step "${step}":`, message);
    // Only the step name reaches the client's redirect URL — the full
    // error message (table names, query fragments if Turso ever returns a
    // verbose one) stays server-side in the console.error above.
    return fail(step);
  }
}

// POSTed by the /auth/callback page with the opaque code from the redirect
// query string — the only place the actual session JWT is handed over, in a
// JSON body rather than a URL. Single-use: the row is deleted as soon as it's
// read, so a code that leaks (e.g. captured before the frontend redeems it)
// can't be replayed.
export async function exchangeAuthCode(request: Request, env: CloudflareEnv): Promise<Response> {
  let code: string | undefined;
  try {
    ({ code } = await request.json() as { code?: string });
  } catch {
    return jsonError('Invalid request body', 400);
  }
  if (!code || typeof code !== 'string') return jsonError('Missing code', 400);

  // DELETE ... RETURNING makes the read and the single-use consumption one
  // atomic statement — a second request racing on the same code finds no row
  // left to delete instead of both requests reading it before either deletes.
  const db = getTursoClient(env);
  const result = await db.execute({
    sql:  'DELETE FROM auth_exchange_codes WHERE code = ? RETURNING token, username, created_at',
    args: [code],
  });
  if (result.rows.length === 0) return jsonError('Invalid or already-used code', 401);

  const row = result.rows[0];
  const createdAt = new Date(row.created_at as string).getTime();
  if (Date.now() - createdAt > EXCHANGE_CODE_TTL_MS) {
    return jsonError('Code expired', 401);
  }

  return jsonResponse({ token: row.token, username: row.username });
}

export async function getMe(request: Request, env: CloudflareEnv): Promise<Response> {
  const auth = request.headers.get('Authorization') ?? '';
  const token = auth.replace('Bearer ', '');

  if (!token) return jsonError('Unauthorized', 401);

  const payload = await verifyToken(token, env.JWT_SECRET);
  if (!payload) return jsonError('Invalid or expired token', 401);

  return new Response(JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json' },
  });
}
