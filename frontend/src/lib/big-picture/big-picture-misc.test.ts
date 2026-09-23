import { describe, expect, it, vi } from 'vitest';
import { applyKeyboardKey, MAX_QUERY_LENGTH, ON_SCREEN_KEYBOARD } from './on-screen-keyboard';
import {
  bigPictureStartPath, parseBigPicturePreferences, readBigPicturePreferences, writeBigPicturePreferences,
  DEFAULT_BIG_PICTURE_PREFERENCES,
} from './big-picture-preferences';
import { hasMediaRemote, mediaRemoteCountStore, playerRemoteAction, readerRemoteAction, registerMediaRemote, sendMediaRemote } from './media-remote';
import { nextProgressStep } from './big-picture-actions';
import { SEEK_BUTTON_STEP_SECONDS } from '../player/keymap';

vi.mock('../tauri/library', () => ({ saveLibraryEntry: vi.fn() }));
vi.mock('../tauri/favorites', () => ({ syncFavorites: vi.fn() }));
vi.mock('../media/anilist-sync', () => ({ isAniListType: () => false, syncToAniList: vi.fn() }));

describe('on-screen keyboard', () => {
  it('has rows of different length ending with the action row', () => {
    expect(ON_SCREEN_KEYBOARD.map(row => row.length)).toEqual([10, 10, 9, 7, 4]);
  });

  it('types, spaces, deletes and clears', () => {
    let q = '';
    q = applyKeyboardKey(q, { kind: 'space' });
    expect(q).toBe('');
    q = applyKeyboardKey(q, { kind: 'char', value: 'a' });
    q = applyKeyboardKey(q, { kind: 'space' });
    q = applyKeyboardKey(q, { kind: 'space' });
    expect(q).toBe('a ');
    q = applyKeyboardKey(q, { kind: 'delete' });
    expect(q).toBe('a');
    expect(applyKeyboardKey(q, { kind: 'done' })).toBe('a');
    expect(applyKeyboardKey(q, { kind: 'clear' })).toBe('');
    expect(applyKeyboardKey('x'.repeat(MAX_QUERY_LENGTH), { kind: 'char', value: 'y' })).toHaveLength(MAX_QUERY_LENGTH);
  });
});

describe('big picture preferences', () => {
  const memory = () => {
    const data = new Map<string, string>();
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
  };

  it('defaults everything off and survives junk', () => {
    expect(parseBigPicturePreferences(null)).toEqual(DEFAULT_BIG_PICTURE_PREFERENCES);
    expect(parseBigPicturePreferences('{oops')).toEqual(DEFAULT_BIG_PICTURE_PREFERENCES);
    expect(parseBigPicturePreferences('{"startInBigPicture":"yes","navigationSounds":true}'))
      .toEqual({ startInBigPicture: false, startOnlyWithController: false, navigationSounds: true });
  });

  it('writes a patch over what is stored', () => {
    const storage = memory();
    writeBigPicturePreferences({ startInBigPicture: true }, storage);
    writeBigPicturePreferences({ navigationSounds: true }, storage);
    expect(readBigPicturePreferences(storage)).toEqual({ startInBigPicture: true, startOnlyWithController: false, navigationSounds: true });
    expect(readBigPicturePreferences(null)).toEqual(DEFAULT_BIG_PICTURE_PREFERENCES);
  });

  it('builds the start path only when enabled', () => {
    expect(bigPictureStartPath(DEFAULT_BIG_PICTURE_PREFERENCES)).toBeNull();
    expect(bigPictureStartPath({ ...DEFAULT_BIG_PICTURE_PREFERENCES, startInBigPicture: true })).toBe('/local?bigpicture=on');
    expect(bigPictureStartPath({ ...DEFAULT_BIG_PICTURE_PREFERENCES, startInBigPicture: true, startOnlyWithController: true })).toBe('/local?bigpicture=pad');
  });
});

describe('media remote', () => {
  it('routes to the most recent surface and counts registrations', () => {
    expect(hasMediaRemote()).toBe(false);
    expect(sendMediaRemote('confirm')).toBe(false);
    const first = vi.fn();
    const second = vi.fn();
    const offFirst = registerMediaRemote(first);
    const offSecond = registerMediaRemote(second);
    expect(mediaRemoteCountStore.get()).toBe(2);
    sendMediaRemote('next');
    expect(second).toHaveBeenCalledWith('next');
    expect(first).not.toHaveBeenCalled();
    offSecond();
    offSecond();
    sendMediaRemote('back');
    expect(first).toHaveBeenCalledWith('back');
    offFirst();
    expect(mediaRemoteCountStore.get()).toBe(0);
    expect(hasMediaRemote()).toBe(false);
  });

  it('maps pad commands to player and reader actions', () => {
    expect(playerRemoteAction('confirm')).toEqual({ type: 'toggle_pause' });
    expect(playerRemoteAction('left')).toEqual({ type: 'seek', seconds: -SEEK_BUTTON_STEP_SECONDS });
    expect(playerRemoteAction('next')).toEqual({ type: 'next' });
    expect(playerRemoteAction('back')).toEqual({ type: 'close' });
    expect(readerRemoteAction('up')).toBe('page_prev');
    expect(readerRemoteAction('confirm')).toBe('page_next');
    expect(readerRemoteAction('prev')).toBe('chapter_prev');
    expect(readerRemoteAction('back')).toBe('close');
  });
});

describe('nextProgressStep', () => {
  it('steps and completes at a known total', () => {
    expect(nextProgressStep(3, 12)).toEqual({ progress: 4, completes: false });
    expect(nextProgressStep(11, 12)).toEqual({ progress: 12, completes: true });
    expect(nextProgressStep(12, 12)).toBeNull();
    expect(nextProgressStep(40, null)).toEqual({ progress: 41, completes: false });
    expect(nextProgressStep(0, 0)).toEqual({ progress: 1, completes: false });
  });
});
