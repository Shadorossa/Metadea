import { describe, expect, it } from 'vitest';
import vocabulary from '../../../../src-tauri/src/fixtures/relations/relation-vocabulary.json';
import { CANONICAL_RELATION_LABELS, RELATION_TYPE_RECIPROCAL } from './canonical-relations';

// The same table media_catalog.rs's reciprocal_relation() is tested against.
describe('relation vocabulary parity with the Rust side', () => {
  it('reciprocals match reciprocal_relation()', () => {
    const expected = Object.fromEntries(Object.entries(vocabulary.reciprocals).map(([type, [other]]) => [type, other]));
    expect(RELATION_TYPE_RECIPROCAL).toEqual(expected);
  });

  it('canonical labels match the labels the backend writes', () => {
    expect(CANONICAL_RELATION_LABELS).toEqual(vocabulary.labels);
  });
});
