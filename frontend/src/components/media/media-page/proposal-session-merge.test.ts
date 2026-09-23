import { describe, it, expect } from 'vitest';
import type { MediaCatalogEntry } from '../../../lib/tauri/catalog';
import type { ProposalFileEntry } from '../../../lib/github/submit-collaborative-proposal';
import { mergeProposalSessionBatches } from './proposal-session-merge';

type MediaEntry = Extract<ProposalFileEntry, { kind: 'media' }>;
type CharacterEntry = Extract<ProposalFileEntry, { kind: 'character' }>;

function relation(id: string, type = 'SEQUEL') {
  return { media_external_id: 'anime:1', related_media_external_id: id, relation_type: type, type_label: type, title: id };
}

function mediaEntry(
  externalId: string,
  catalog: Partial<MediaCatalogEntry> = {},
  bundle: Partial<MediaEntry['bundle']> = {},
  extra: Partial<Omit<MediaEntry, 'kind' | 'externalId' | 'bundle'>> = {},
): MediaEntry {
  return {
    kind: 'media', externalId,
    bundle: {
      media_catalog: { id: '', external_id: externalId, type: 'anime', created_at: '', updated_at: '', ...catalog },
      media_relations: [], characters: [], media_authors: [], ...bundle,
    },
    ...extra,
  };
}

function characterEntry(
  externalId: string,
  bundle: Partial<CharacterEntry['bundle']> = {},
  extra: Partial<Omit<CharacterEntry, 'kind' | 'externalId' | 'bundle'>> = {},
): CharacterEntry {
  return { kind: 'character', externalId, bundle: { character: { external_id: externalId }, appearances: [], actors: [], ...bundle }, ...extra };
}

function mergeMedia(batches: Array<{ ownerId: string; entries: ProposalFileEntry[] }>): MediaEntry {
  const [entry] = mergeProposalSessionBatches(batches);
  if (entry.kind !== 'media') throw new Error('expected a media entry');
  return entry;
}

function mergeCharacter(batches: Array<{ ownerId: string; entries: ProposalFileEntry[] }>): CharacterEntry {
  const [entry] = mergeProposalSessionBatches(batches);
  if (entry.kind !== 'character') throw new Error('expected a character entry');
  return entry;
}

describe('mergeProposalSessionBatches', () => {
  it('returns a single batch untouched', () => {
    const entries = [mediaEntry('anime:1'), characterEntry('character:a1')];
    expect(mergeProposalSessionBatches([{ ownerId: 'anime:1', entries }])).toEqual(entries);
  });

  it('returns nothing for no batches', () => {
    expect(mergeProposalSessionBatches([])).toEqual([]);
  });

  it('keeps entries for different ids side by side, in first-seen order', () => {
    const merged = mergeProposalSessionBatches([
      { ownerId: 'anime:1', entries: [mediaEntry('anime:1'), mediaEntry('anime:2')] },
      { ownerId: 'anime:3', entries: [mediaEntry('anime:3')] },
    ]);
    expect(merged.map(entry => entry.externalId)).toEqual(['anime:1', 'anime:2', 'anime:3']);
  });

  it('lets the owner draft win field-by-field over a side-effect copy, whichever batch comes first', () => {
    const owner = { ownerId: 'anime:1', entries: [mediaEntry('anime:1', { title_main: 'Owner', synopsis: 'Owner synopsis' })] };
    const side = { ownerId: 'anime:2', entries: [mediaEntry('anime:1', { title_main: 'Side', cover_url: 'side.png' })] };
    for (const batches of [[owner, side], [side, owner]]) {
      const merged = mergeMedia(batches);
      expect(merged.bundle.media_catalog.title_main).toBe('Owner');
      expect(merged.bundle.media_catalog.synopsis).toBe('Owner synopsis');
      expect(merged.bundle.media_catalog.cover_url).toBe('side.png');
    }
  });

  it('unions relations by related id with the owner draft winning ties', () => {
    const merged = mergeMedia([
      { ownerId: 'anime:2', entries: [mediaEntry('anime:1', {}, { media_relations: [relation('anime:2', 'SEQUEL'), relation('anime:3')] })] },
      { ownerId: 'anime:1', entries: [mediaEntry('anime:1', {}, { media_relations: [relation('anime:2', 'PREQUEL'), relation('anime:4')] })] },
    ]);
    expect(merged.bundle.media_relations).toEqual([relation('anime:2', 'PREQUEL'), relation('anime:3'), relation('anime:4')]);
  });

  it('drops removed relation ids that survive in the merged list', () => {
    const merged = mergeMedia([
      { ownerId: 'anime:2', entries: [mediaEntry('anime:1', {}, {}, { removedRelationIds: ['anime:3', 'anime:9'] })] },
      { ownerId: 'anime:1', entries: [mediaEntry('anime:1', {}, { media_relations: [relation('anime:3')] }, { removedRelationIds: ['anime:9', 'anime:8'] })] },
    ]);
    expect(merged.removedRelationIds).toEqual(['anime:9', 'anime:8']);
  });

  // Characterization: only relations are unioned. Characters and authors
  // are taken wholesale from the owner draft, and removed ids are filtered
  // against that owner list only.
  it('takes characters and authors from the owner draft and filters removals against them', () => {
    const merged = mergeMedia([
      { ownerId: 'anime:2', entries: [mediaEntry('anime:1', {}, {
        characters: [{ external_id: 'character:a1', name: 'Side' }],
        media_authors: [{ external_id: 'person:1', name: 'Side Author' }],
      }, { removedCharacterIds: ['character:a1', 'character:a2'], removedAuthorIds: ['person:1', 'person:2'] })] },
      { ownerId: 'anime:1', entries: [mediaEntry('anime:1', {}, {
        characters: [{ external_id: 'character:a2', name: 'Owner' }],
        media_authors: [{ external_id: 'person:2', name: 'Owner Author' }],
      })] },
    ]);
    expect(merged.bundle.characters).toEqual([{ external_id: 'character:a2', name: 'Owner' }]);
    expect(merged.bundle.media_authors).toEqual([{ external_id: 'person:2', name: 'Owner Author' }]);
    expect(merged.removedCharacterIds).toEqual(['character:a1']);
    expect(merged.removedAuthorIds).toEqual(['person:1']);
  });

  it('unions removed arc ids without filtering', () => {
    const merged = mergeMedia([
      { ownerId: 'anime:2', entries: [mediaEntry('anime:1', {}, {}, { removedArcIds: ['arc-1'] })] },
      { ownerId: 'anime:1', entries: [mediaEntry('anime:1', {}, { story_arcs: [{ id: 'arc-1', name: 'Arc', image_base64: null, items: [], sort_order: 0 }] }, { removedArcIds: ['arc-1', 'arc-2'] })] },
    ]);
    expect(merged.removedArcIds).toEqual(['arc-1', 'arc-2']);
  });

  it('lets the later side-effect copy win when neither batch owns the entry', () => {
    const merged = mergeMedia([
      { ownerId: 'anime:2', entries: [mediaEntry('anime:1', { title_main: 'First' })] },
      { ownerId: 'anime:3', entries: [mediaEntry('anime:1', { title_main: 'Second' })] },
    ]);
    expect(merged.bundle.media_catalog.title_main).toBe('Second');
  });

  it('keeps an owner draft over a later side-effect copy', () => {
    const merged = mergeMedia([
      { ownerId: 'anime:1', entries: [mediaEntry('anime:1', { title_main: 'Owner' })] },
      { ownerId: 'anime:3', entries: [mediaEntry('anime:1', { title_main: 'Side' })] },
    ]);
    expect(merged.bundle.media_catalog.title_main).toBe('Owner');
  });

  it('keeps the owner bundle-level fields such as saga_name', () => {
    const merged = mergeMedia([
      { ownerId: 'anime:2', entries: [mediaEntry('anime:1', {}, { saga_name: 'Side saga' })] },
      { ownerId: 'anime:1', entries: [mediaEntry('anime:1', {}, {})] },
    ]);
    expect(merged.bundle.saga_name).toBe('Side saga');
    const ownerNamed = mergeMedia([
      { ownerId: 'anime:2', entries: [mediaEntry('anime:1', {}, { saga_name: 'Side saga' })] },
      { ownerId: 'anime:1', entries: [mediaEntry('anime:1', {}, { saga_name: 'Owner saga' })] },
    ]);
    expect(ownerNamed.bundle.saga_name).toBe('Owner saga');
  });

  it('merges character appearances and actors by key with the owner winning', () => {
    const merged = mergeCharacter([
      { ownerId: 'anime:1', entries: [characterEntry('character:a1', {
        appearances: [{ media_external_id: 'anime:1', relation_type: 'MAIN' }],
        actors: [{ external_id: 'person:a10', name: 'Side' }],
      })] },
      { ownerId: 'character:a1', entries: [characterEntry('character:a1', {
        appearances: [{ media_external_id: 'anime:1', relation_type: 'SUPPORTING' }, { media_external_id: 'anime:2', relation_type: 'MAIN' }],
        actors: [{ external_id: 'person:a11', name: 'Owner' }],
      })] },
    ]);
    expect(merged.bundle.appearances).toEqual([
      { media_external_id: 'anime:1', relation_type: 'SUPPORTING' },
      { media_external_id: 'anime:2', relation_type: 'MAIN' },
    ]);
    expect(merged.bundle.actors).toEqual([{ external_id: 'person:a10', name: 'Side' }, { external_id: 'person:a11', name: 'Owner' }]);
  });

  it('filters character removals against the merged lists and the owner merge ids', () => {
    const merged = mergeCharacter([
      { ownerId: 'anime:1', entries: [characterEntry('character:a1', {
        appearances: [{ media_external_id: 'anime:1', relation_type: 'MAIN' }],
        merged_character_external_ids: ['character:a5'],
      }, { removedAppearanceIds: ['anime:1', 'anime:3'], removedActorIds: ['person:a10'], removedMergedCharacterIds: ['character:a5', 'character:a6'] })] },
      { ownerId: 'character:a1', entries: [characterEntry('character:a1', {
        actors: [{ external_id: 'person:a10' }],
        merged_character_external_ids: ['character:a6'],
      }, { removedAppearanceIds: ['anime:4'] })] },
    ]);
    expect(merged.removedAppearanceIds).toEqual(['anime:3', 'anime:4']);
    expect(merged.removedActorIds).toEqual([]);
    expect(merged.removedMergedCharacterIds).toEqual(['character:a5']);
    expect(merged.bundle.merged_character_external_ids).toEqual(['character:a6']);
  });

  // Characterization: unlike media_catalog, the character field object is
  // replaced wholesale by the owner draft rather than merged per field.
  it('replaces the character fields with the owner draft', () => {
    const merged = mergeCharacter([
      { ownerId: 'anime:1', entries: [characterEntry('character:a1', { character: { external_id: 'character:a1', biography: 'Side bio' } })] },
      { ownerId: 'character:a1', entries: [characterEntry('character:a1', { character: { external_id: 'character:a1', name: 'Owner' } })] },
    ]);
    expect(merged.bundle.character).toEqual({ external_id: 'character:a1', name: 'Owner' });
  });
});
