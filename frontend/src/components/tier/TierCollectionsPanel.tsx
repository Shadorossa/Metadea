import { useEffect, useMemo, useState } from 'react';
import { getAllUserLists, getListItemsFullLight, type ListInfo } from '../../lib/tauri/lists';
import { getAllSagas, type SagaListEntry } from '../../lib/tauri/catalog';
import { getCharacterReactions, emptyCharacterReactionGroups, type CharacterReactionGroups } from '../../lib/tauri/character-reactions';
import { getAllCharactersLight, type CharacterEntry } from '../../lib/tauri/characters';
import { readUserFavoritesTyped } from '../../lib/tauri/favorites';
import type { TierCandidate } from '../../lib/tier/tier-candidates';
import type { Translations } from '../../i18n/types';
import { CandidatePreview } from './TierLibraryPanel';

// "Lists & sagas" and "Characters" tabs of the add-items dialog. Each pick
// shows what it would add (minus what is already on the board) before the
// user confirms.

function typeOfId(id: string): string {
  return id.split(':')[0] || 'anime';
}

function PickAndAdd({ candidates, loading, exclude, onAdd, t }: {
  candidates: TierCandidate[] | null;
  loading: boolean;
  exclude: ReadonlySet<string>;
  onAdd: (c: TierCandidate[]) => void;
  t: Translations['tier'];
}) {
  const fresh = useMemo(() => (candidates ?? []).filter(c => !exclude.has(c.id)), [candidates, exclude]);
  if (loading) return <p className="tier-filler-empty">{t.loading}</p>;
  if (!candidates) return null;
  if (fresh.length === 0) return <p className="tier-filler-empty">{candidates.length ? t.nothing_new : t.collection_empty}</p>;
  return (
    <>
      <div className="tier-filler-summary">
        <span>{t.matches.replace('{count}', String(fresh.length))}</span>
        <button type="button" className="tier-btn tier-btn--primary" onClick={() => onAdd(fresh)}>
          {t.add_matches.replace('{count}', String(fresh.length))}
        </button>
      </div>
      <CandidatePreview candidates={fresh} />
    </>
  );
}

interface PanelProps {
  exclude: ReadonlySet<string>;
  onAdd: (c: TierCandidate[]) => void;
  t: Translations['tier'];
}

export function TierCollectionsPanel({ exclude, onAdd, t }: PanelProps) {
  const [lists, setLists] = useState<ListInfo[]>([]);
  const [sagas, setSagas] = useState<SagaListEntry[]>([]);
  const [choice, setChoice] = useState('');
  const [candidates, setCandidates] = useState<TierCandidate[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getAllUserLists().catch(() => [] as ListInfo[]),
      getAllSagas().catch(() => [] as SagaListEntry[]),
    ]).then(([allLists, allSagas]) => {
      if (cancelled) return;
      setLists(allLists.filter(l => l.item_count > 0));
      setSagas(allSagas.filter(s => s.members.length > 0).sort((a, b) => a.name.localeCompare(b.name)));
    });
    return () => { cancelled = true; };
  }, []);

  const pick = async (value: string) => {
    setChoice(value);
    setCandidates(null);
    if (!value) return;
    const [kind, key] = [value.slice(0, value.indexOf(':')), value.slice(value.indexOf(':') + 1)];
    if (kind === 'saga') {
      const saga = sagas.find(s => s.id === key);
      setCandidates((saga?.members ?? []).map(m => ({ id: m.external_id, title: m.title, cover: m.cover, type: typeOfId(m.external_id), rating: null })));
      return;
    }
    setLoading(true);
    const items = await getListItemsFullLight(key).catch(() => []);
    setLoading(false);
    setCandidates(items.map(i => ({ id: i.external_id, title: i.title_main, cover: i.cover_url, type: i.media_type ?? typeOfId(i.external_id), rating: i.rating })));
  };

  return (
    <div className="tier-filler-panel">
      <label className="tier-field tier-field--wide">
        <span>{t.filler_tab_collections}</span>
        <select value={choice} onChange={e => { void pick(e.target.value); }}>
          <option value="">{t.collection_pick}</option>
          {lists.length > 0 && (
            <optgroup label={t.collection_lists}>
              {lists.map(l => <option key={l.key} value={`list:${l.key}`}>{l.name} ({l.item_count})</option>)}
            </optgroup>
          )}
          {sagas.length > 0 && (
            <optgroup label={t.collection_sagas}>
              {sagas.map(s => <option key={s.id} value={`saga:${s.id}`}>{s.name || s.anchor_title} ({s.members.length})</option>)}
            </optgroup>
          )}
        </select>
      </label>
      <PickAndAdd candidates={candidates} loading={loading} exclude={exclude} onAdd={onAdd} t={t} />
    </div>
  );
}

type CharacterSource = 'favorites' | keyof CharacterReactionGroups;

export function TierCharactersPanel({ exclude, onAdd, t }: PanelProps) {
  const [groups, setGroups] = useState<CharacterReactionGroups>(emptyCharacterReactionGroups());
  const [favorites, setFavorites] = useState<TierCandidate[]>([]);
  const [source, setSource] = useState<CharacterSource>('favorites');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getCharacterReactions().catch(() => emptyCharacterReactionGroups()),
      readUserFavoritesTyped().catch(() => ({} as Record<string, string[]>)),
      getAllCharactersLight().catch(() => [] as CharacterEntry[]),
    ]).then(([reactions, favs, characters]) => {
      if (cancelled) return;
      const byId = new Map(characters.map(c => [c.external_id, c]));
      setGroups(reactions);
      setFavorites((favs.character ?? []).map(id => ({ id, title: byId.get(id)?.name ?? null, cover: byId.get(id)?.image_url ?? null, type: 'character', rating: null })));
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const candidates: TierCandidate[] = source === 'favorites'
    ? favorites
    : groups[source].map(c => ({ id: c.external_id, title: c.name, cover: c.image_url, type: 'character', rating: null }));

  const labels: Record<CharacterSource, string> = {
    favorites: t.characters_favorites,
    like: t.characters_like,
    interest: t.characters_interest,
    dislike: t.characters_dislike,
  };

  return (
    <div className="tier-filler-panel">
      <div className="tier-segmented" role="radiogroup" aria-label={t.filler_tab_characters}>
        {(Object.keys(labels) as CharacterSource[]).map(key => (
          <button key={key} type="button" role="radio" aria-checked={source === key}
            className={`tier-segmented-btn${source === key ? ' tier-segmented-btn--active' : ''}`}
            onClick={() => setSource(key)}>
            {labels[key]}
          </button>
        ))}
      </div>
      <PickAndAdd candidates={candidates} loading={loading} exclude={exclude} onAdd={onAdd} t={t} />
    </div>
  );
}
