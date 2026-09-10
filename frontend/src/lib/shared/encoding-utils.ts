// Encoding/decoding utilities for tokens, payloads, and data formats.

// Decode a JWT token payload (the middle segment between dots).
// Returns empty object on any parsing error instead of throwing.
export function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const [, p] = token.split('.');
    return JSON.parse(atob(p.replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return {};
  }
}

// Safe JSON.parse wrapper — returns null instead of throwing on invalid JSON.
export function safeJsonParse<T>(json: string, fallback: T | null = null): T | null {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

// Safe parseInt wrapper — returns fallback value instead of NaN on invalid input.
export function safeParseInt(value: string | null | undefined, fallback = 0): number {
  const parsed = parseInt(value ?? '', 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}
