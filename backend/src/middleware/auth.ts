import { jsonError } from './cors';
import { verifyToken } from '../services/auth';
import type { CloudflareEnv } from '../types';

export interface AuthPayload {
  userId:   string;
  username: string;
  email:    string;
  avatar:   string | null;
}

// Verifies the Bearer token on `request` and returns the decoded JWT payload,
// or a ready-to-return 401 Response if it's missing/invalid/expired — every
// route that needs auth does `const auth = await requireAuth(request, env);
// if (auth instanceof Response) return auth;` before touching the DB, then
// uses `auth.userId` instead of trusting whatever the client sent in the body.
export async function requireAuth(
  request: Request,
  env: CloudflareEnv,
): Promise<AuthPayload | Response> {
  const authHeader = request.headers.get('Authorization') ?? '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) return jsonError('Unauthorized', 401);

  const payload = await verifyToken(token, env.JWT_SECRET);
  if (!payload || typeof payload.userId !== 'string') {
    return jsonError('Invalid or expired token', 401);
  }

  return payload as unknown as AuthPayload;
}
