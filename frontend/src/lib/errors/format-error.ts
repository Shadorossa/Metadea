import type { Translations } from '../../i18n/types';
import { isErrorCode, type ErrorCode } from './error-codes';

export interface ParsedAppError {
  code: ErrorCode;
  // The technical part after "E_CODE: " (an io/zip/HTTP error), if any.
  detail: string | null;
}

// A Tauri command rejects with its `Err(String)` as-is (a plain string, not
// an Error), but callers also route ordinary thrown Errors through here.
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string') return err.message;
  return String(err);
}

// "E_CODE" or "E_CODE: detail" (see error_codes::with_detail in Rust).
// Anything else — an English message from a command not yet migrated, a
// network error, a plain Error — is not an app error and returns null.
export function parseAppError(message: string): ParsedAppError | null {
  const trimmed = message.trim();
  const separator = trimmed.indexOf(':');
  const code = separator === -1 ? trimmed : trimmed.slice(0, separator);
  if (!isErrorCode(code)) return null;
  const detail = separator === -1 ? '' : trimmed.slice(separator + 1).trim();
  return { code, detail: detail || null };
}

/** The message to show the user for a caught backend error: the code's
 *  translation (`t.errors.<CODE>`) with the technical detail appended, or
 *  the raw message when it carries no known code. A code is never shown
 *  bare — every code has a key in es.ts, which `t.errors[code]` enforces
 *  at compile time. */
export function formatAppError(err: unknown, t: Pick<Translations, 'errors'>): string {
  const raw = errorMessage(err);
  const parsed = parseAppError(raw);
  if (!parsed) return raw;
  const label = t.errors[parsed.code];
  return parsed.detail ? `${label}: ${parsed.detail}` : label;
}
