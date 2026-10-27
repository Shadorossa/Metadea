import { describe, expect, it } from 'vitest';
import fixture from '../../../src-tauri/src/fixtures/external-id-sources.json';
import { sourceOfExternalId, typeOfExternalId } from './external-id';

// The same table media_catalog.rs's infer_type_from_id / infer_source_from_id
// are tested against.
describe('external_id type and source parity with the Rust side', () => {
  for (const [id, [type, source]] of Object.entries(fixture.cases)) {
    it(id, () => {
      expect(typeOfExternalId(id)).toBe(type);
      expect(sourceOfExternalId(id)).toBe(source);
    });
  }
});
