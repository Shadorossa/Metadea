import { useMemo } from 'react';
import type { CharacterPageData } from '../../../lib/character/character-page-data';
import { classifySpoilerStatLine } from '../../../lib/spoilers/spoiler-stat-lines';
import { spoilerItemKey } from '../../../lib/spoilers/spoiler-reveals';
import { interpolate } from '../../../lib/shared/text/interpolate';
import { getT } from '../../../i18n/runtime';
import { useSpoilerShield } from '../../spoilers/hooks/useSpoilerShield';

/** What the character page hides, already combined with this session's
 *  reveals; null when nothing is (shield off, no followed franchise, or
 *  everything revealed). */
export interface CharacterSpoilerView {
  /** Shield data still loading: biography and stat values stay unpainted. */
  pending: boolean;
  franchiseName: string | null;
  /** "Appears in <work>" for a late debut. */
  lateDebutNote: string | null;
  hideImage: boolean;
  hideBiography: boolean;
  isStatHidden: (label: string, items: readonly string[]) => boolean;
  revealStat: (label: string) => void;
  revealImage: () => void;
  revealBiography: () => void;
  revealPage: () => void;
  revealFranchise: () => void;
}

export function useCharacterSpoilers(data: CharacterPageData | null): CharacterSpoilerView | null {
  const { evaluator, pending, isRevealed, reveal, revealFranchise } = useSpoilerShield();
  const appearanceKey = data?.appearances.map(a => a.mediaId).join('|') ?? '';
  const shield = useMemo(
    () => (evaluator && appearanceKey ? evaluator.characterShield(appearanceKey.split('|')) : null),
    [evaluator, appearanceKey],
  );

  if (!data) return null;
  const id = data.externalId;
  if (pending) {
    return {
      pending: true,
      franchiseName: null,
      lateDebutNote: null,
      hideImage: false,
      hideBiography: false,
      isStatHidden: () => false,
      revealStat: () => {},
      revealImage: () => {},
      revealBiography: () => {},
      revealPage: () => {},
      revealFranchise: () => {},
    };
  }
  if (!shield || isRevealed(spoilerItemKey.characterPage(id))) return null;

  const lateDebutTitle = shield.lateDebutWorkId
    ? data.appearances.find(a => a.mediaId === shield.lateDebutWorkId)?.title ?? null
    : null;
  return {
    pending: false,
    franchiseName: shield.franchise.name,
    lateDebutNote: lateDebutTitle ? interpolate(getT().spoilers.late_debut, { work: lateDebutTitle }) : null,
    hideImage: shield.hideImage && !isRevealed(spoilerItemKey.characterImage(id)),
    hideBiography: shield.hideBiography && !isRevealed(spoilerItemKey.characterBiography(id)),
    isStatHidden: (label, items) => shield.hideSensitiveStats
      && classifySpoilerStatLine(label, items) !== null
      && !isRevealed(spoilerItemKey.characterStat(id, label)),
    revealStat: label => reveal(spoilerItemKey.characterStat(id, label)),
    revealImage: () => reveal(spoilerItemKey.characterImage(id)),
    revealBiography: () => reveal(spoilerItemKey.characterBiography(id)),
    revealPage: () => reveal(spoilerItemKey.characterPage(id)),
    revealFranchise: () => revealFranchise(shield.franchise),
  };
}
