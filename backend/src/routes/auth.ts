import { jsonError } from '../middleware/cors';
import { getGoogleAuthUrl, exchangeCodeForUser, createToken } from '../services/auth';
import { getTursoClient } from '../services/database';
import type { CloudflareEnv } from '../types';

async function ensureUsersTable(env: CloudflareEnv): Promise<void> {
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
}

function getCallbackUri(env: CloudflareEnv): string {
  return `${env.API_URL}/api/auth/google/callback`;
}

export async function googleAuthRedirect(_req: Request, env: CloudflareEnv): Promise<Response> {
  const state = crypto.randomUUID();
  const url   = getGoogleAuthUrl(env.GOOGLE_CLIENT_ID, getCallbackUri(env), state);
  return Response.redirect(url, 302);
}

export async function googleAuthCallback(request: Request, env: CloudflareEnv): Promise<Response> {
  const url   = new URL(request.url);
  const code  = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  const fail = (reason: string) =>
    Response.redirect(`${env.APP_URL}/auth/callback?error=${encodeURIComponent(reason)}`, 302);

  if (error || !code) return fail('cancelled');

  let step = 'init';
  try {
    step = 'exchange_code';
    const googleUser = await exchangeCodeForUser(
      code,
      env.GOOGLE_CLIENT_ID,
      env.GOOGLE_CLIENT_SECRET,
      getCallbackUri(env),
    );
    console.log('[auth] googleUser:', JSON.stringify({ id: googleUser.id, email: googleUser.email, name: googleUser.name, hasPicture: !!googleUser.picture }));

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

    step = 'redirect';
    const redirect = `${env.APP_URL}/auth/callback?token=${encodeURIComponent(token)}&username=${encodeURIComponent(username)}`;
    return Response.redirect(redirect, 302);

  } catch (err) {
    const message = err instanceof Error
      ? err.message
      : typeof err === 'object'
        ? JSON.stringify(err)
        : String(err);
    console.error(`[auth] FAILED at step "${step}":`, message);
    return fail(`[${step}] ${message}`);
  }
}

export async function getMe(request: Request, env: CloudflareEnv): Promise<Response> {
  const { verifyToken } = await import('../services/auth');
  const auth = request.headers.get('Authorization') ?? '';
  const token = auth.replace('Bearer ', '');

  if (!token) return jsonError('Unauthorized', 401);

  const payload = await verifyToken(token, env.JWT_SECRET);
  if (!payload) return jsonError('Invalid or expired token', 401);

  return new Response(JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json' },
  });
}
