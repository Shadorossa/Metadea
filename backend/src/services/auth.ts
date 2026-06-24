// ── JWT ───────────────────────────────────────────────────────────────────────

const b64url = (input: string | ArrayBuffer): string => {
  const str = typeof input === 'string'
    ? input
    : String.fromCharCode(...new Uint8Array(input));
  return btoa(str).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
};

const b64urlDecode = (input: string): string =>
  atob(input.replace(/-/g, '+').replace(/_/g, '/'));

export async function createToken(
  payload: Record<string, unknown>,
  secret: string,
  expiresInDays = 90,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { ...payload, iat: now, exp: now + expiresInDays * 86400 };

  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body   = b64url(JSON.stringify(fullPayload));

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${header}.${body}`));
  return `${header}.${body}.${b64url(sig)}`;
}

export async function verifyToken(
  token: string,
  secret: string,
): Promise<Record<string, unknown> | null> {
  try {
    const [header, body, signature] = token.split('.');
    if (!header || !body || !signature) return null;

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );

    const sigBytes = Uint8Array.from(
      atob(signature.replace(/-/g, '+').replace(/_/g, '/')),
      c => c.charCodeAt(0),
    );
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      sigBytes,
      new TextEncoder().encode(`${header}.${body}`),
    );
    if (!valid) return null;

    const parsed = JSON.parse(b64urlDecode(body)) as Record<string, unknown>;
    if (parsed.exp && (parsed.exp as number) < Math.floor(Date.now() / 1000)) return null;

    return parsed;
  } catch {
    return null;
  }
}

// ── Google OAuth ───────────────────────────────────────────────────────────────

export interface GoogleUser {
  id:       string;
  email:    string;
  name:     string;
  picture:  string;
}

interface GoogleTokenResponse {
  access_token: string;
}

interface GoogleUserInfoResponse {
  id:      string;
  email:   string;
  name:    string;
  picture: string;
}

export function getGoogleAuthUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  redirectUri,
    response_type: 'code',
    scope:         'openid email profile',
    state,
    access_type:   'online',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeCodeForUser(
  code:         string,
  clientId:     string,
  clientSecret: string,
  redirectUri:  string,
): Promise<GoogleUser> {
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      code,
      client_id:     clientId,
      client_secret: clientSecret,
      redirect_uri:  redirectUri,
      grant_type:    'authorization_code',
    }),
  });

  if (!tokenRes.ok) throw new Error(`Token exchange failed: ${await tokenRes.text()}`);
  const tokens = await tokenRes.json() as GoogleTokenResponse;

  const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  if (!userRes.ok) throw new Error('Failed to fetch Google user info');
  const info = await userRes.json() as GoogleUserInfoResponse;

  return { id: info.id, email: info.email, name: info.name, picture: info.picture };
}
