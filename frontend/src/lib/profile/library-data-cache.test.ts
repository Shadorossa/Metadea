import { describe, it, expect, vi } from 'vitest';

vi.mock('../tauri/library', () => ({ getAllLibraryEntries: vi.fn() }));
vi.mock('../tauri/catalog', () => ({ getCatalogEntriesForLibrary: vi.fn(), getCatalogEntriesByIds: vi.fn() }));
vi.mock('./relations-scope', () => ({ collectSeedIds: vi.fn(), loadScopedMediaRelations: vi.fn() }));

import { collectMissingCatalogIds } from './library-data-cache';
import type { DbMediaRelation } from '../tauri/catalog';

function rel(owner: string, target: string): DbMediaRelation {
  return { media_external_id: owner, related_media_external_id: target, relation_type: 'CONTAINS', type_label: 'CONTAINS', title: target };
}

describe('collectMissingCatalogIds', () => {
  it('returns ids on either end of a relation that have no catalog row, once each, in order', () => {
    const catalog = [{ external_id: 'game:1' }, { external_id: 'game:2' }];
    const relations = [rel('game:bundle', 'game:1'), rel('game:bundle', 'game:2'), rel('game:2', 'game:remaster')];
    expect(collectMissingCatalogIds(relations, catalog)).toEqual(['game:bundle', 'game:remaster']);
  });

  it('is empty when every id is already known', () => {
    const catalog = [{ external_id: 'a' }, { external_id: 'b' }];
    expect(collectMissingCatalogIds([rel('a', 'b')], catalog)).toEqual([]);
  });

  it('ignores relations without an owner id', () => {
    const relations = [{ ...rel('x', 'b'), media_external_id: undefined as unknown as string }];
    expect(collectMissingCatalogIds(relations, [{ external_id: 'b' }])).toEqual([]);
  });
});
