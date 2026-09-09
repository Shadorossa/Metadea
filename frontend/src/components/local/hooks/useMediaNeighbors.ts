import { useEffect, useState } from 'react';
import { getMediaRelationsForEditor } from '../../../lib/tauri';
import { CONTAINS_RELATION_TYPES } from '../../../lib/media/sagaTypes';
import { normalizeForMatch } from '../utils/folderMatch';

export interface NeighborInfo { externalId: string; title: string; cover: string | null }

export interface MediaNeighbors {
  prequel:        NeighborInfo | null;
  sequel:         NeighborInfo | null;
  bundleChildren: NeighborInfo[];
}

// Resolves the "what comes before/after this" (or, for a bundle, "what's
// inside it") neighbor row shown by both GameDetailPanel and
// LocalMediaDetailPanel — was independently reimplemented by each (Game's own
// version being the fuller one: PARENT/edition-matching/bundle-children,
// Local's own a simpler PREQUEL/SEQUEL-only subset that missed VN-adjacent
// bundles and remaster/remake chains entirely). Pulled out here so a fix to
// this logic reaches every category, not just whichever panel it was
// originally written for.
export function useMediaNeighbors(relationsExternalId: string | undefined, selfTitle: string): MediaNeighbors {
  const [prequel, setPrequel] = useState<NeighborInfo | null>(null);
  const [sequel,  setSequel]  = useState<NeighborInfo | null>(null);
  const [bundleChildren, setBundleChildren] = useState<NeighborInfo[]>([]);

  useEffect(() => {
    setPrequel(null);
    setSequel(null);
    setBundleChildren([]);
    if (!relationsExternalId) return;
    let cancelled = false;
    getMediaRelationsForEditor(relationsExternalId).then(async relations => {
      if (cancelled) return;
      const children = relations.filter(r => CONTAINS_RELATION_TYPES.includes(r.relation_type));
      if (children.length > 0) {
        setBundleChildren(children.map(c => ({ externalId: c.related_media_external_id, title: c.title, cover: c.cover ?? null })));
        return;
      }
      let prequelRel = relations.find(r => r.relation_type === 'PREQUEL');
      let sequelRel = relations.find(r => r.relation_type === 'SEQUEL');
      // A remaster/remake never carries its own PREQUEL/SEQUEL/CONTAINS —
      // those live on the original it's an edition of (see PARENT, the
      // reverse-direction label REMASTER/REMAKE gets recorded under on the
      // edition's own side). Same "borrow the original's saga identity"
      // fallback library-grouping.ts's refineSagaGroups already relies on
      // for the profile grid — and, like that same code, the neighbor
      // itself gets swapped for ITS OWN remaster/remake edition when one
      // exists (a Hou remaster's sequel should point at the next chapter's
      // own Hou remaster, not the bare original release), falling back to
      // the original only when it has no edition of its own.
      let viaParent = false;
      // Which edition family this entry itself belongs to (REMASTER vs
      // REMAKE) — a base work can have both (Higurashi has its Hou remaster
      // AND its separate Matsuri remake), so the neighbor lookup below needs
      // to match the SAME family, not just grab whichever edition happens
      // to come back first.
      let selfEditionType: string | undefined;
      if (!prequelRel && !sequelRel) {
        const parent = relations.find(r => r.relation_type === 'PARENT');
        if (parent) {
          const parentRelations = await getMediaRelationsForEditor(parent.related_media_external_id).catch(() => []);
          if (cancelled) return;
          prequelRel = parentRelations.find(r => r.relation_type === 'PREQUEL');
          sequelRel = parentRelations.find(r => r.relation_type === 'SEQUEL');
          viaParent = true;
          selfEditionType = parentRelations.find(r => r.related_media_external_id === relationsExternalId)?.relation_type;
        }
      }
      // Self's own title, tokenized once — used below to pick the right one
      // out of SEVERAL same-type editions of the same neighbor (e.g. an EN
      // and a JP remaster both existing for the same base game), since
      // relation_type alone (REMASTER/REMAKE) can't tell those apart.
      const selfTokens = new Set(normalizeForMatch(selfTitle).split(' ').filter(Boolean));
      const bestByTitleOverlap = (candidates: typeof relations) => candidates.reduce((best, c) => {
        const score = normalizeForMatch(c.title).split(' ').filter(tok => tok && selfTokens.has(tok)).length;
        return !best || score > best.score ? { rel: c, score } : best;
      }, undefined as { rel: (typeof relations)[number]; score: number } | undefined)?.rel;
      const resolveNeighbor = async (rel: NonNullable<typeof prequelRel>): Promise<NeighborInfo> => {
        if (!viaParent) return { externalId: rel.related_media_external_id, title: rel.title, cover: rel.cover ?? null };
        const neighborRelations = await getMediaRelationsForEditor(rel.related_media_external_id).catch(() => []);
        const editionTypes = ['REMASTER', 'REMAKE'];
        const orderedTypes = selfEditionType ? [selfEditionType, ...editionTypes.filter(t => t !== selfEditionType)] : editionTypes;
        let edition: (typeof relations)[number] | undefined;
        for (const t of orderedTypes) {
          const candidates = neighborRelations.filter(r => r.relation_type === t);
          if (candidates.length === 1) { edition = candidates[0]; break; }
          if (candidates.length > 1) { edition = bestByTitleOverlap(candidates); break; }
        }
        return edition
          ? { externalId: edition.related_media_external_id, title: edition.title, cover: edition.cover ?? null }
          : { externalId: rel.related_media_external_id, title: rel.title, cover: rel.cover ?? null };
      };
      if (prequelRel) setPrequel(await resolveNeighbor(prequelRel));
      if (cancelled) return;
      if (sequelRel) setSequel(await resolveNeighbor(sequelRel));
    }).catch(() => {});
    return () => { cancelled = true; };
    // selfTitle intentionally not a dep — it always changes in lockstep with
    // relationsExternalId (a selection/identity change), same as the
    // original GameDetailPanel effect this was pulled out of.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relationsExternalId]);

  return { prequel, sequel, bundleChildren };
}
