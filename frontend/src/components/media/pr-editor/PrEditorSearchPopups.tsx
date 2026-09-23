import { useState } from 'react';
import type { SearchResult as ApiSearchResult } from '../../../lib/search';
import type { DbMediaCharacter } from '../../../lib/tauri/characters';
import { fetchMediaDataInternal } from '../../../lib/media/media-page-data';
import type { Translations } from '../../../i18n/index';
import { MediaSearchPopup } from '../../search-popups/MediaSearchPopup';
import type { PrEditorDraft } from './pr-editor-state';

export type PrEditorSearchPopupMode = 'saga' | 'bundled' | 'contains' | 'relations' | 'recommendations' | 'bundle-children';

interface SearchPopupsProps {
  mode: PrEditorSearchPopupMode | null;
  externalId: string;
  // A remaster/remake/expanded-edition/bundle relation picked here should
  // keep this entry's own type, not always default to 'game' — a VN's
  // remaster is still a VN (see MediaSearchPopup's own comment).
  igdbRelationMediaType: 'vnovel' | 'game';
  draft: PrEditorDraft;
  onSelectSaga: (result: ApiSearchResult) => void;
  onSelectBundled: (result: ApiSearchResult) => void;
  onSelectBundleChild: (result: ApiSearchResult) => void;
  onSelectContained: (result: ApiSearchResult) => void;
  onSelectRelation: (result: ApiSearchResult) => void;
  onSelectRecommendation: (result: ApiSearchResult) => void;
  onClose: () => void;
}

// The one MediaSearchPopup instance each relation list opens to add a work,
// each with its own exclusions and IGDB inclusion flags.
export function PrEditorSearchPopups({
  mode, externalId, igdbRelationMediaType, draft,
  onSelectSaga, onSelectBundled, onSelectBundleChild, onSelectContained, onSelectRelation, onSelectRecommendation, onClose,
}: SearchPopupsProps) {
  const { sagaOrder, bundledRelations, bundleChildren, containedRelations, editableRelations, recommendations } = draft;
  return (
    <>
      {mode === 'saga' && (
        <MediaSearchPopup
          onSelect={onSelectSaga}
          onClose={onClose}
          excludeIds={sagaOrder}
          closeOnSelect={false}
          // A saga legitimately needs to reference an edition-type entry
          // (Final Fantasy VII's Expanded Edition node, say) as a member in
          // its own right, not just as a Relaciones/Bundled target — without
          // this, the regular search's own EXCLUDED_LOCAL_FORMATS/igdb_search
          // filtering (which hides these everywhere else on purpose, so a
          // plain "Persona 5" search doesn't get buried in its own editions)
          // made it impossible to find and add one here at all.
          includeIgdbExpandedEditions
          igdbRelationMediaType={igdbRelationMediaType}
        />
      )}

      {mode === 'bundled' && (
        <MediaSearchPopup
          onSelect={onSelectBundled}
          onClose={onClose}
          excludeIds={[externalId, ...bundledRelations.map(r => r.external_id)]}
          closeOnSelect={false}
          includeIgdbBundles
          igdbRelationMediaType={igdbRelationMediaType}
        />
      )}

      {mode === 'bundle-children' && (
        <MediaSearchPopup
          onSelect={onSelectBundleChild}
          onClose={onClose}
          excludeIds={[externalId, ...(bundledRelations[0] ? [bundledRelations[0].external_id] : []), ...bundleChildren.map(r => r.external_id)]}
          closeOnSelect={false}
        />
      )}

      {mode === 'contains' && (
        <MediaSearchPopup
          onSelect={onSelectContained}
          onClose={onClose}
          excludeIds={[externalId, ...containedRelations.map(r => r.external_id)]}
          closeOnSelect={false}
          includeIgdbExpandedEditions
          includeRemasters
          igdbRelationMediaType={igdbRelationMediaType}
        />
      )}

      {mode === 'relations' && (
        <MediaSearchPopup
          onSelect={onSelectRelation}
          onClose={onClose}
          excludeIds={[externalId, ...editableRelations.map(r => r.related_media_external_id), ...recommendations.map(r => r.external_id)]}
          closeOnSelect={false}
          // Unlike Bundled In/Contains, this general Relations picker isn't
          // scoped to one specific relation kind — a curator manually fixing
          // up a REMASTER/REMAKE/expanded-edition/bundle link (e.g. one the
          // live sync failed to pick up) needs to find it here too, not just
          // via those dedicated pickers.
          includeIgdbBundles
          includeIgdbExpandedEditions
          includeRemasters
          igdbRelationMediaType={igdbRelationMediaType}
        />
      )}

      {mode === 'recommendations' && (
        <MediaSearchPopup
          onSelect={onSelectRecommendation}
          onClose={onClose}
          excludeIds={[externalId, ...recommendations.map(r => r.external_id), ...editableRelations.map(r => r.related_media_external_id)]}
          closeOnSelect={false}
        />
      )}
    </>
  );
}

interface CastPickerProps {
  pe: Translations['pr_editor'];
  // Ids already in the cast list — never re-added.
  existingCharacters: DbMediaCharacter[];
  role: string;
  onAdd: (additions: DbMediaCharacter[]) => void;
  onClose: () => void;
}

// "Add from another work's cast" picker: search a work, tick characters,
// confirm. Selection is local — it starts empty every time this mounts.
export function PrEditorCastPickerPopup({ pe, existingCharacters, role, onAdd, onClose }: CastPickerProps) {
  const [selected, setSelected] = useState<Array<{ external_id: string; name: string; image_url?: string | null }>>([]);
  return (
    <MediaSearchPopup
      onSelect={() => {}}
      onClose={onClose}
      castPicker={{
        title: pe.cast_title,
        loadingLabel: pe.cast_loading,
        emptyLabel: pe.cast_empty,
        backLabel: pe.cast_back,
        errorLabel: pe.cast_error,
        confirmLabel: pe.cast_confirm,
        selectedIds: selected.map(character => character.external_id),
        loadCast: async work => {
          const data = await fetchMediaDataInternal(work.externalId, true);
          return (data?.characters ?? []).flatMap(character => character.id ? [{
            external_id: character.id,
            name: character.name,
            image_url: character.image ?? null,
          }] : []);
        },
        onToggleCharacter: character => setSelected(previous => (
          previous.some(item => item.external_id === character.external_id)
            ? previous.filter(item => item.external_id !== character.external_id)
            : [...previous, character]
        )),
        onConfirm: () => {
          const existingIds = new Set(existingCharacters.map(character => character.external_id));
          const additions = selected
            .filter(character => !existingIds.has(character.external_id))
            .map(character => ({
              external_id: character.external_id,
              name: character.name,
              image_url: character.image_url ?? null,
              relation_type: role,
              character_name: null,
            }));
          onAdd(additions);
          setSelected([]);
          onClose();
        },
      }}
    />
  );
}
