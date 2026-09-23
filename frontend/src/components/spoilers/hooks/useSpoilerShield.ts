import { useCallback, useEffect, useMemo, useState } from 'react';
import { useExternalStore } from '../../shared/hooks/useExternalStore';
import { loadSpoilerIndexInput } from '../../../lib/spoilers/spoiler-data';
import { buildSpoilerIndex, type SpoilerFranchise, type SpoilerIndexInput, type SpoilerRelation } from '../../../lib/spoilers/spoiler-franchises';
import { createSpoilerEvaluator, type SpoilerEvaluator } from '../../../lib/spoilers/spoiler-evaluator';
import { getSpoilerReveals } from '../../../lib/spoilers/spoiler-reveals';
import {
  DEFAULT_SPOILER_SETTINGS,
  readSpoilerSettings,
  SPOILER_SETTINGS_CHANGED_EVENT,
  type SpoilerSettings,
} from '../../../lib/spoilers/spoiler-settings';

export interface SpoilerShieldHandle {
  /** Null while the shield is off or its data is still loading. */
  evaluator: SpoilerEvaluator | null;
  /** The shield is on but the library data has not arrived yet: callers
   *  keep synopses/biographies invisible instead of flashing them. */
  pending: boolean;
  isRevealed: (key: string) => boolean;
  reveal: (key: string) => void;
  revealFranchise: (franchise: SpoilerFranchise) => void;
}

interface Options {
  /** Editors, PR previews and anything the user authors never hide. */
  disabled?: boolean;
  /** Chain edges the page knows before the shared cache does (its own
   *  PREQUEL/SEQUEL rows, a saga viewer's order). */
  extraRelations?: readonly SpoilerRelation[];
}

type BaseInput = Omit<SpoilerIndexInput, 'currentYear'>;

// Events after which the library/relations cache reloads (see
// lib/profile/library-data-cache.ts, whose own listeners drop it first).
const DATA_CHANGED_EVENTS = ['refresh-profile-library', 'media-relations-changed'];

function useSpoilerSettings(): SpoilerSettings {
  const [settings, setSettings] = useState<SpoilerSettings>(() =>
    typeof window === 'undefined' ? DEFAULT_SPOILER_SETTINGS : readSpoilerSettings());
  useEffect(() => {
    const refresh = () => setSettings(readSpoilerSettings());
    window.addEventListener(SPOILER_SETTINGS_CHANGED_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(SPOILER_SETTINGS_CHANGED_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);
  return settings;
}

const NO_RELATIONS: readonly SpoilerRelation[] = [];

export function useSpoilerShield({ disabled = false, extraRelations = NO_RELATIONS }: Options = {}): SpoilerShieldHandle {
  const settings = useSpoilerSettings();
  const reveals = getSpoilerReveals();
  const revealState = useExternalStore(reveals.store);
  const active = !disabled && settings.enabled;
  const [base, setBase] = useState<BaseInput | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const load = () => {
      loadSpoilerIndexInput()
        .then(input => { if (!cancelled) setBase(input); })
        // Read-only: without the data nothing is hidden, as before the shield
        // (an empty input also ends `pending`, so nothing stays invisible).
        .catch(err => {
          console.error('[spoilers] failed to load library data:', err);
          if (!cancelled) setBase(prev => prev ?? { library: [], catalog: [], relations: [] });
        });
    };
    load();
    for (const name of DATA_CHANGED_EVENTS) window.addEventListener(name, load);
    return () => {
      cancelled = true;
      for (const name of DATA_CHANGED_EVENTS) window.removeEventListener(name, load);
    };
  }, [active]);

  const extraKey = extraRelations.map(r => `${r.media_external_id}>${r.related_media_external_id}:${r.relation_type}`).join('|');
  const index = useMemo(() => {
    if (!active || !base) return null;
    return buildSpoilerIndex(extraRelations.length > 0 ? { ...base, relations: [...base.relations, ...extraRelations] } : base);
    // extraKey stands in for extraRelations, which callers rebuild per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, base, extraKey]);

  const evaluator = useMemo(() => {
    if (!index) return null;
    return createSpoilerEvaluator({ index, settings, isFranchiseRevealed: reveals.isFranchiseRevealed });
    // revealState.franchiseIds: a franchise reveal must rebuild the answers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, settings, revealState.franchiseIds, reveals]);

  const isRevealed = useCallback((key: string) => revealState.items.has(key), [revealState.items]);
  const revealFranchise = useCallback((franchise: SpoilerFranchise) => reveals.revealFranchise(franchise.memberIds), [reveals]);

  return {
    evaluator,
    pending: active && !base,
    isRevealed,
    reveal: reveals.revealItem,
    revealFranchise,
  };
}
