import type { MediaCatalogEntry } from '../../../lib/tauri/catalog';
import type { Translations } from '../../../i18n/index';
import type { SortableListActions } from '../../shared/SortableList';
import { PrEditorRelationCardList } from './PrEditorRelationCardList';
import type { BundledRelation } from '../../../lib/media/editor/pr-editor-types';

interface Props {
  pe: Translations['pr_editor'];
  entry: MediaCatalogEntry;
  issueRelations: BundledRelation[];
  isLoadingIssuePreview: boolean;
  issuePreviewError: string | null;
  sortable: SortableListActions;
  onRemove: (id: string) => void;
  onSelectVolume: () => void;
  onResetSource: () => void;
  onEditWork?: (externalId: string) => void;
}

// ComicVine issues - split out into their own section since their titles
// are often just a bare issue number, which used to clutter the general
// Relations grid.
export function PrEditorIssuesSection({
  pe, entry, issueRelations, isLoadingIssuePreview, issuePreviewError,
  sortable, onRemove, onSelectVolume, onResetSource, onEditWork,
}: Props) {
  return (
    <div className="pr-editor-section">
      {(entry.type === 'comic' || entry.type === 'manga') && (
        <div className="pr-editor-source-mapping-row">
          <span>{pe.source_comicvine} {entry.issue_source_id ? `#${entry.issue_source_id}` : pe.source_automatic}</span>
          <button type="button" className="pr-editor-add-btn" onClick={onSelectVolume}>{pe.select_volume}</button>
          {entry.issue_source_id && <button type="button" className="pr-editor-add-btn" onClick={onResetSource}>{pe.reset}</button>}
        </div>
      )}
      {isLoadingIssuePreview && <div className="pr-editor-search-loading">{pe.loading_issues}</div>}
      {issuePreviewError && <div className="pr-editor-search-empty">{issuePreviewError}</div>}
      {!isLoadingIssuePreview && issueRelations.length === 0 && entry.issue_source_id && !issuePreviewError && (
        <div className="pr-editor-search-empty">{pe.no_issues_with_cover}</div>
      )}
      {!isLoadingIssuePreview && (
        <PrEditorRelationCardList
          relations={issueRelations}
          sortable={sortable}
          onRemove={onRemove}
          onEditWork={onEditWork}
        />
      )}
    </div>
  );
}
