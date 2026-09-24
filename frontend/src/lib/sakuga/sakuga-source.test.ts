import { describe, expect, it } from 'vitest';
import { parseSakugaSource, sourceEpisodeParts } from './sakuga-source';

describe('parseSakugaSource', () => {
  it('reads the episode, medium and role from a typical source', () => {
    const info = parseSakugaSource('#06 (BD) (Action AD: Toru Iwazawa)');
    expect(info.episode).toBe(6);
    expect(info.medium).toBe('BD');
    expect(info.roles).toEqual(['Action AD']);
    expect(sourceEpisodeParts(info)).toEqual({ season: null, episode: 6 });
  });

  it('prefers the in-season numbering when both are given', () => {
    const info = parseSakugaSource('#023 (S2 #10) (BD) ');
    expect(info.episode).toBe(23);
    expect([info.season, info.seasonEpisode]).toEqual([2, 10]);
    expect(sourceEpisodeParts(info)).toEqual({ season: 2, episode: 10 });
  });

  it('recognises TV, segments and several roles', () => {
    const info = parseSakugaSource('OP (TV) (Key Animation: A) (Effects: B) (Key Animation: C)');
    expect(info.medium).toBe('TV');
    expect(info.segment).toBe('OP');
    expect(info.roles).toEqual(['Key Animation', 'Effects']);
    expect(info.episode).toBeNull();
    expect(sourceEpisodeParts(info)).toBeNull();
  });

  it('does not mistake words containing OP/ED for segments', () => {
    expect(parseSakugaSource('Opening Theme').segment).toBeNull();
    expect(parseSakugaSource('Movie (Ending)').segment).toBeNull();
    expect(parseSakugaSource('ED2 (BD)').segment).toBe('ED');
  });

  it('degrades to nothing for empty or free text', () => {
    expect(parseSakugaSource('')).toEqual({ episode: null, season: null, seasonEpisode: null, medium: null, segment: null, roles: [] });
    expect(parseSakugaSource(null).roles).toEqual([]);
    expect(parseSakugaSource('https://twitter.com/x/status/1').episode).toBeNull();
  });
});
