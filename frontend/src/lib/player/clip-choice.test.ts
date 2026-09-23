import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CLIP_CHOICE, getLastClipChoice, parseClipChoice, rememberClipChoice } from './clip-choice';

describe('clip choice', () => {
  it('defaults to MP4, 480p, with audio', () => {
    expect(parseClipChoice(null)).toEqual(DEFAULT_CLIP_CHOICE);
    expect(parseClipChoice('not json')).toEqual(DEFAULT_CLIP_CHOICE);
    expect(parseClipChoice('{"format":"webm","size":"4k"}')).toEqual(DEFAULT_CLIP_CHOICE);
  });

  it('reads back what was remembered', () => {
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => { data.set(key, value); },
    });
    rememberClipChoice({ format: 'gif', size: '720p', includeAudio: false });
    expect(getLastClipChoice()).toEqual({ format: 'gif', size: '720p', includeAudio: false });
    vi.unstubAllGlobals();
  });
});
