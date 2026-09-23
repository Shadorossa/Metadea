import type { MediaCatalogEntry } from '../../../lib/tauri/catalog';
import type { MediaEpisode } from '../../../lib/tauri/episodes';
import type { MediaTheme } from '../../../lib/tauri/themes';
import type { Translations } from '../../../i18n/index';
import type { MediaMeta } from '../../../lib/media/saga/saga-grouping';
import { EDITABLE_RELATION_OPTIONS } from '../../../lib/media/saga/saga-relation-types';
import type { MediaSourceMappingKind } from '../../search-popups/MediaSourceMappingSearchPopup';
import { PrEditorRelationCardList } from './PrEditorRelationCardList';
import { PrEditorStoryArcsSection } from './PrEditorStoryArcsSection';
import { PrEditorSagaOrderSection } from './PrEditorSagaOrderSection';
import { PrEditorAddButton } from './PrEditorAddButton';
import { PrEditorRelationsSection } from './PrEditorRelationsSection';
import { PrEditorEpisodesSection } from './PrEditorEpisodesSection';
import { PrEditorThemesSection } from './PrEditorThemesSection';
import { PrEditorIssuesSection } from './PrEditorIssuesSection';
import type { RelationsSubtab } from './PrEditorSidebar';
import type { PrEditorSearchPopupMode } from './PrEditorSearchPopups';
import type { PrEditorDraft } from './pr-editor-state';
import type { PrEditorDraftActions } from './usePrEditorDraftActions';

interface Props {
  t: Translations;
  externalId: string;
  entry: MediaCatalogEntry;
  draft: PrEditorDraft;
  actions: PrEditorDraftActions;
  subtab: RelationsSubtab;
  resolveMeta: (id: string) => MediaMeta;
  issuePreview: { loading: boolean; error: string | null };
  previews: {
    episodePreview: MediaEpisode[];
    episodePreviewLoading: boolean;
    episodeSourceTitle: string;
    themePreview: MediaTheme[];
    themePreviewLoading: boolean;
  };
  onOpenSearch: (mode: PrEditorSearchPopupMode) => void;
  onOpenSourceMapping: (kind: MediaSourceMappingKind) => void;
  onResetIssueSource: () => void;
  onResetEpisodeSource: () => void;
  onArcDeleted: (arcId: string) => void;
  onEditWork?: (externalId: string) => void;
}

// The "Relations" tab: one panel per relations subtab (saga chain, editable
// relations, recommendations, bundled-in, arcs, issues, episodes, themes,
// bundle children, contains).
export function PrEditorRelationsTab({
  t, externalId, entry, draft, actions, subtab, resolveMeta, issuePreview, previews,
  onOpenSearch, onOpenSourceMapping, onResetIssueSource, onResetEpisodeSource, onArcDeleted, onEditWork,
}: Props) {
  const pe = t.pr_editor;
  const { sagaOrder, sagaGroups, sagaName, editableRelations, recommendations, bundledRelations, bundleChildren, containedRelations, issueRelations } = draft;

  const cardList = (list: typeof actions.bundled, relations: PrEditorDraft['bundledRelations'], popupMode: PrEditorSearchPopupMode) => (
    <div className="pr-editor-section">
      <PrEditorRelationCardList
        relations={relations}
        sortable={list.sortable}
        onRemove={list.remove}
        onAdd={() => onOpenSearch(popupMode)}
        onEditWork={onEditWork}
      />
    </div>
  );

  return (
    <div className="pr-editor-relations-content">
      <div className="pr-editor-relations-grid">
      {subtab === 'saga' && (
      <div className="pr-editor-section">
        <PrEditorSagaOrderSection
          externalId={externalId}
          sagaOrder={sagaOrder}
          sagaGroups={sagaGroups}
          sortable={actions.saga.dragHandlers.sortable}
          onRemove={actions.saga.remove}
          onUngroup={actions.saga.ungroup}
          onEditWork={onEditWork}
          resolveMeta={resolveMeta}
        />
        <div className="pr-editor-saga-name-row">
          <label htmlFor="pr-editor-saga-name">{pe.saga_name_label}</label>
          <input
            id="pr-editor-saga-name"
            type="text"
            placeholder={pe.saga_name_placeholder}
            value={sagaName}
            onChange={e => actions.saga.setName(e.target.value)}
            className="pr-editor-media-card-group-input pr-editor-saga-name-input"
          />
          <PrEditorAddButton onClick={() => onOpenSearch('saga')} />
        </div>
      </div>
      )}

      {subtab === 'relations' && <div className="pr-editor-section">
        <PrEditorRelationsSection
          editableRelations={editableRelations}
          relationOptions={EDITABLE_RELATION_OPTIONS}
          relationLabels={actions.canonicalRelationLabels}
          draggedIndex={actions.editable.draggedIndex}
          dragHandlers={actions.editable.dragHandlers}
          onRemove={actions.editable.remove}
          onUpdateType={actions.editable.updateType}
          onAdd={() => onOpenSearch('relations')}
          onEditWork={onEditWork}
        />
      </div>}

      {subtab === 'recommendations' && cardList(actions.recommendation, recommendations, 'recommendations')}

      {subtab === 'bundled' && cardList(actions.bundled, bundledRelations, 'bundled')}

      {subtab === 'arcs' && <PrEditorStoryArcsSection
        externalId={externalId}
        currentTitle={entry.title_main || externalId}
        currentCover={entry.cover_url || null}
        sagaOrder={sagaOrder}
        resolveSagaMeta={resolveMeta}
        onArcDeleted={onArcDeleted}
      />}

      {subtab === 'issues' && (issueRelations.length > 0 || entry.type === 'comic' || entry.type === 'manga' || entry.type === 'lnovel') && (
        <PrEditorIssuesSection
          pe={pe}
          entry={entry}
          issueRelations={issueRelations}
          isLoadingIssuePreview={issuePreview.loading}
          issuePreviewError={issuePreview.error}
          draggedIndex={actions.issue.draggedIndex}
          dragHandlers={actions.issue.dragHandlers}
          onRemove={actions.issue.remove}
          onSelectVolume={() => onOpenSourceMapping('issues')}
          onResetSource={onResetIssueSource}
          onEditWork={onEditWork}
        />
      )}

      {subtab === 'episodes' && (entry.type === 'anime' || entry.type === 'series') && (
        <PrEditorEpisodesSection
          pe={pe}
          entry={entry}
          episodePreview={previews.episodePreview}
          episodePreviewLoading={previews.episodePreviewLoading}
          episodeSourceTitle={previews.episodeSourceTitle}
          onSelectSource={() => onOpenSourceMapping('episodes')}
          onResetSource={onResetEpisodeSource}
        />
      )}

      {subtab === 'themes' && entry.type === 'anime' && (
        <PrEditorThemesSection t={t} entry={entry} themePreview={previews.themePreview} themePreviewLoading={previews.themePreviewLoading} />
      )}

      {/* Only shown once a bundle is actually referenced above - lets
          you fill in the rest of that bundle's own contents right
          here (this entry is already implied) instead of having to
          separately open the bundle's own editor afterward. */}
      {subtab === 'bundle-children' && bundledRelations.length > 0 && (
        <div className="pr-editor-section">
          <p className="pr-editor-bundle-children-hint">
            Esta obra ya queda incluida automáticamente — añade aquí el resto de obras del bundle.
          </p>
          <PrEditorRelationCardList
            relations={bundleChildren}
            sortable={actions.bundleChild.sortable}
            onRemove={actions.bundleChild.remove}
            onAdd={() => onOpenSearch('bundle-children')}
            onEditWork={onEditWork}
          />
        </div>
      )}

      {/* Contains only makes sense for an entry that's itself a
          container (format BUNDLE) — anything else "containing"
          other works doesn't apply. */}
      {subtab === 'contains' && entry.format === 'BUNDLE' && cardList(actions.contained, containedRelations, 'contains')}
      </div>
    </div>
  );
}
