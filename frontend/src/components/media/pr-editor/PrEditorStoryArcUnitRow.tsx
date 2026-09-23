import { Unlink2 } from 'lucide-react';
import type { StoryArcDisplayUnit, UnifiedEpisode } from '../../../lib/media/editor/story-arc-units';
import { SortableItem } from '../../shared/SortableList';
import { getT } from '../../../i18n/runtime';

interface Props {
  unit: StoryArcDisplayUnit;
  unifiedEps: UnifiedEpisode[];
  globalStart: number | null;
  globalEnd: number | null;
  isPopoverOpen: boolean;
  onTogglePopover: (position: { top: number; left: number }) => void;
  onUpdateItemRange: (id: string, field: 'ep_start' | 'ep_end', value: string) => void;
  onUngroup: () => void;
  onRemove: () => void;
}

// One row of the arc editor's item list: a single work or a grouped set of
// works (stacked covers), its episode range (a popover trigger when the
// works have an episode list, two number inputs otherwise) and the
// ungroup/remove actions. Must render inside the parent's SortableList.
export function PrEditorStoryArcUnitRow({
  unit, unifiedEps, globalStart, globalEnd, isPopoverOpen, onTogglePopover, onUpdateItemRange, onUngroup, onRemove,
}: Props) {
  const t = getT().pr_editor.story_arcs;
  const hasEpisodes = unifiedEps.length > 0;

  const rangeLabel = globalStart != null && globalEnd != null
    ? (globalStart === globalEnd
      ? t.ep_single.replace('{n}', String(globalStart))
      : t.ep_range.replace('{start}', String(globalStart)).replace('{end}', String(globalEnd)))
    : (globalStart != null ? t.ep_from.replace('{start}', String(globalStart)) : t.episodes);

  return (
    <SortableItem id={unit.id}>
      {({ handleProps, isDragging, groupState, dropSide }) => {
        const isGroupTarget = groupState === 'ready';
        return (
          <div
            className={`pr-editor-arc-item-row ${isDragging ? 'is-dragging' : ''} ${isGroupTarget ? 'is-drop-target-group' : ''} ${dropSide === 'before' ? 'is-drop-target-before' : ''} ${dropSide === 'after' ? 'is-drop-target-after' : ''}`}
            title={unit.items.map(i => i.title).join(' + ')}
            {...handleProps}
          >
            {isGroupTarget && (
              <div className="pr-editor-arc-group-overlay">
                {t.group_overlay}
              </div>
            )}

            <div className="pr-editor-arc-item-cover-col">
              {unit.isGroup ? (
                <div className="pr-editor-arc-stacked-covers">
                  {unit.items.slice(0, 3).map(item => (
                    <div key={item.media_external_id} className="pr-editor-arc-stacked-covers-item">
                      {item.cover ? <img className="cover-image-fill" src={item.cover} alt="" /> : <div className="pr-editor-media-card-placeholder" />}
                    </div>
                  ))}
                  <span className="pr-editor-arc-group-count-badge">{t.works_count.replace('{count}', String(unit.items.length))}</span>
                </div>
              ) : (
                <div className="pr-editor-arc-item-cover">
                  {unit.items[0].cover ? <img className="cover-image-fill" src={unit.items[0].cover} alt="" /> : <div className="pr-editor-media-card-placeholder" />}
                </div>
              )}

              {hasEpisodes ? (
                <button
                  type="button"
                  className={`pr-editor-arc-ep-trigger ${isPopoverOpen ? 'is-active' : ''}`}
                  onClick={e => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const top = rect.bottom + 6 + 280 > window.innerHeight ? Math.max(10, rect.top - 280) : rect.bottom + 6;
                    const left = Math.min(Math.max(10, rect.left - 60), window.innerWidth - 380);
                    onTogglePopover({ top, left });
                  }}
                >
                  <span>{rangeLabel}</span>
                  <span style={{ fontSize: '0.55rem', opacity: 0.7 }}>▼</span>
                </button>
              ) : (
                <div className="pr-editor-arc-item-range">
                  <input
                    type="number"
                    placeholder={t.ep_start_ph}
                    value={unit.items[0].ep_start ?? ''}
                    onChange={e => onUpdateItemRange(unit.items[0].media_external_id, 'ep_start', e.target.value)}
                    className="pr-editor-arc-item-range-input"
                  />
                  <span className="pr-editor-arc-item-range-sep">–</span>
                  <input
                    type="number"
                    placeholder={t.ep_end_ph}
                    value={unit.items[0].ep_end ?? ''}
                    onChange={e => onUpdateItemRange(unit.items[0].media_external_id, 'ep_end', e.target.value)}
                    className="pr-editor-arc-item-range-input"
                  />
                </div>
              )}
            </div>

            <div className="pr-editor-arc-item-actions">
              {unit.isGroup && (
                <button
                  type="button"
                  className="pr-editor-arc-card-action-btn"
                  onClick={e => {
                    e.stopPropagation();
                    onUngroup();
                  }}
                  title={t.ungroup_title}
                >
                  <Unlink2 size={12} strokeWidth={2.2} />
                </button>
              )}
              <button
                type="button"
                className="pr-editor-arc-card-delete"
                onClick={e => {
                  e.stopPropagation();
                  onRemove();
                }}
                title={t.remove_from_arc}
              >
                ×
              </button>
            </div>
          </div>
        );
      }}
    </SortableItem>
  );
}
