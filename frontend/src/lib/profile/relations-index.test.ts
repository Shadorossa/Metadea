import { describe, expect, it } from 'vitest';
import type { DbMediaRelation } from '../tauri/catalog';
import { indexRelationsByMedia } from './relations-index';

function rel(owner: string | undefined, target: string, type = 'SEQUEL'): DbMediaRelation {
  return { media_external_id: owner, related_media_external_id: target, relation_type: type, type_label: type, title: target };
}

describe('indexRelationsByMedia', () => {
  const relations = [
    rel('anime:1', 'anime:2'),
    rel('anime:2', 'anime:1', 'PREQUEL'),
    rel(undefined, 'anime:9'),
    rel('anime:2', 'anime:3'),
    rel('game:5', 'game:6', 'REMAKE'),
  ];

  it('groups rows under their owning media, preserving input order', () => {
    const index = indexRelationsByMedia(relations);
    expect(index.get('anime:2')).toEqual([relations[1], relations[3]]);
    expect(index.get('anime:1')).toEqual([relations[0]]);
    expect(index.get('game:5')).toEqual([relations[4]]);
  });

  it('matches what a per-id filter of the full list would return', () => {
    const index = indexRelationsByMedia(relations);
    for (const id of ['anime:1', 'anime:2', 'anime:3', 'game:5', 'missing']) {
      expect(index.get(id) ?? []).toEqual(relations.filter(r => r.media_external_id === id));
    }
  });

  it('skips rows with no owning media id and returns nothing for unknown ids', () => {
    const index = indexRelationsByMedia(relations);
    expect([...index.keys()]).toEqual(['anime:1', 'anime:2', 'game:5']);
    expect(index.get('anime:9')).toBeUndefined();
    expect(indexRelationsByMedia([]).size).toBe(0);
  });
});
