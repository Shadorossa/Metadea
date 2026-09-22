import type { ProposalFileEntry } from '../../../lib/github/submitCollaborativeProposal';

// A proposal session can touch the same entry from several open editors at
// once. Each batch names the entry its editor "owns", and that owner's draft
// wins field-by-field over any copy another editor produced as a side effect,
// while list members (relations, appearances, ...) are unioned so no editor's
// additions are lost.
export function mergeProposalSessionBatches(batches: Array<{ ownerId: string; entries: ProposalFileEntry[] }>): ProposalFileEntry[] {
  const merged = new Map<string, { entry: ProposalFileEntry; hasOwnerDraft: boolean }>();

  for (const batch of batches) {
    for (const incoming of batch.entries) {
      const key = `${incoming.kind}:${incoming.externalId}`;
      const existing = merged.get(key);
      const incomingIsOwner = incoming.externalId === batch.ownerId;
      if (!existing) {
        merged.set(key, { entry: incoming, hasOwnerDraft: incomingIsOwner });
        continue;
      }
      if (existing.entry.kind !== incoming.kind) continue;

      const preferIncoming = incomingIsOwner || !existing.hasOwnerDraft;
      const ownerEntry = preferIncoming ? incoming : existing.entry;
      const otherEntry = preferIncoming ? existing.entry : incoming;
      if (incoming.kind === 'media' && ownerEntry.kind === 'media' && otherEntry.kind === 'media') {
        const relations = new Map<string, (typeof incoming.bundle.media_relations)[number]>();
        [...otherEntry.bundle.media_relations, ...ownerEntry.bundle.media_relations].forEach(relation => {
          relations.set(relation.related_media_external_id, relation);
        });
        merged.set(key, {
          hasOwnerDraft: existing.hasOwnerDraft || incomingIsOwner,
          entry: {
            ...ownerEntry,
            bundle: {
              ...otherEntry.bundle,
              ...ownerEntry.bundle,
              media_catalog: { ...otherEntry.bundle.media_catalog, ...ownerEntry.bundle.media_catalog },
              media_relations: [...relations.values()],
            },
            removedRelationIds: [...new Set([...(otherEntry.removedRelationIds ?? []), ...(ownerEntry.removedRelationIds ?? [])])].filter(id => !relations.has(id)),
            removedCharacterIds: [...new Set([...(otherEntry.removedCharacterIds ?? []), ...(ownerEntry.removedCharacterIds ?? [])])]
              .filter(id => !ownerEntry.bundle.characters.some(character => character.external_id === id)),
            removedAuthorIds: [...new Set([...(otherEntry.removedAuthorIds ?? []), ...(ownerEntry.removedAuthorIds ?? [])])]
              .filter(id => !ownerEntry.bundle.media_authors.some(author => author.external_id === id)),
            removedArcIds: [...new Set([...(otherEntry.removedArcIds ?? []), ...(ownerEntry.removedArcIds ?? [])])],
          },
        });
      } else if (incoming.kind === 'character' && ownerEntry.kind === 'character' && otherEntry.kind === 'character') {
        const appearances = new Map<string, (typeof incoming.bundle.appearances)[number]>();
        [...otherEntry.bundle.appearances, ...ownerEntry.bundle.appearances].forEach(item => appearances.set(item.media_external_id, item));
        const actors = new Map<string, (typeof incoming.bundle.actors)[number]>();
        [...otherEntry.bundle.actors, ...ownerEntry.bundle.actors].forEach(item => actors.set(item.external_id, item));
        merged.set(key, {
          hasOwnerDraft: existing.hasOwnerDraft || incomingIsOwner,
          entry: {
            ...ownerEntry,
            bundle: {
              ...otherEntry.bundle,
              ...ownerEntry.bundle,
              appearances: [...appearances.values()],
              actors: [...actors.values()],
            },
            removedAppearanceIds: [...new Set([...(otherEntry.removedAppearanceIds ?? []), ...(ownerEntry.removedAppearanceIds ?? [])])]
              .filter(id => !appearances.has(id)),
            removedActorIds: [...new Set([...(otherEntry.removedActorIds ?? []), ...(ownerEntry.removedActorIds ?? [])])]
              .filter(id => !actors.has(id)),
            removedMergedCharacterIds: [...new Set([...(otherEntry.removedMergedCharacterIds ?? []), ...(ownerEntry.removedMergedCharacterIds ?? [])])]
              .filter(id => !ownerEntry.bundle.merged_character_external_ids?.includes(id)),
          },
        });
      }
    }
  }

  return [...merged.values()].map(item => item.entry);
}
