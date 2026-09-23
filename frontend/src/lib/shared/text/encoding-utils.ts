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
