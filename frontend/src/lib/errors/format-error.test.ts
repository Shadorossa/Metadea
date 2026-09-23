import { describe, it, expect } from 'vitest';
import { formatAppError, parseAppError } from './format-error';
import { es } from '../../i18n/es';

describe('parseAppError', () => {
  it('splits a bare code', () => {
    expect(parseAppError('E_COMIC_NO_PAGES')).toEqual({ code: 'E_COMIC_NO_PAGES', detail: null });
  });

  it('splits a code with technical detail, keeping colons inside the detail', () => {
    expect(parseAppError('E_BACKUP_ZIP_OPEN: The system cannot find the file (os error 2): x'))
      .toEqual({ code: 'E_BACKUP_ZIP_OPEN', detail: 'The system cannot find the file (os error 2): x' });
  });

  it('rejects anything that is not a known code', () => {
    expect(parseAppError('Failed to launch the player: boom')).toBeNull();
    expect(parseAppError('E_NOT_A_REAL_CODE')).toBeNull();
    expect(parseAppError('')).toBeNull();
  });
});

describe('formatAppError', () => {
  it('translates a code and appends the detail', () => {
    expect(formatAppError('E_GOG_LAUNCH: access denied', es)).toBe(`${es.errors.E_GOG_LAUNCH}: access denied`);
  });

  it('translates a bare code without a trailing colon', () => {
    expect(formatAppError('E_GITHUB_SESSION_EXPIRED', es)).toBe(es.errors.E_GITHUB_SESSION_EXPIRED);
  });

  it('accepts an Error carrying the code', () => {
    expect(formatAppError(new Error('E_COMIC_READ_FILE: ENOENT'), es)).toBe(`${es.errors.E_COMIC_READ_FILE}: ENOENT`);
  });

  it('falls back to the raw message for unknown errors', () => {
    expect(formatAppError('Tauri not available', es)).toBe('Tauri not available');
    expect(formatAppError(new Error('boom'), es)).toBe('boom');
    expect(formatAppError(42, es)).toBe('42');
  });
});
