// The Overview's character view: the three reaction lists (like /
// interested / dislike) as three round buttons joined by a line
// (●—●—●), each with its count. A button opens a panel with every
// character in that list as a portrait grid (the Favorites tab's card
// markup and styles); on your own profile each card can be removed, moved
// to another reaction or dragged to reorder. `readOnly` (someone else's
// profile) shows the same lists without any of that.
import { Fragment, useState, type ReactNode } from 'react';
import { Eye, ThumbsDown, ThumbsUp } from 'lucide-react';
import { getT } from '../../i18n/runtime';
import { interpolate } from '../../lib/shared/text/interpolate';
import { formatAppError } from '../../lib/errors/format-error';
import { showToast } from '../../lib/dom/toast';
import { wrapAssetUrl, setCharacterReaction, reorderCharacterReactions } from '../../lib/tauri';
import {
  CHARACTER_REACTIONS, characterPageUrl, movedIds, reactionCounts, reactionGroupsReducer,
  type CharacterReaction, type CharacterReactionGroups, type CharacterReactionItem, type ReactionAction,
} from '../../lib/character/character-reactions';
import { ModalShell } from '../shared/ModalShell';
import { SortableItem, SortableList, type SortableHandleProps } from '../shared/SortableList';
import { IconX } from '../local/ui/icons';

function reactionLabel(reaction: CharacterReaction): string {
  const c = getT().character;
  return reaction === 'like' ? c.action_like : reaction === 'interest' ? c.action_interested : c.action_dislike;
}

function ReactionIcon({ reaction, size }: { reaction: CharacterReaction; size: number }) {
  if (reaction === 'like') return <ThumbsUp size={size} strokeWidth={2} />;
  if (reaction === 'interest') return <Eye size={size} strokeWidth={2} />;
  return <ThumbsDown size={size} strokeWidth={2} />;
}

interface CardProps {
  item: CharacterReactionItem;
  reaction: CharacterReaction;
  readOnly: boolean;
  handleProps?: SortableHandleProps;
  isDragging?: boolean;
  onSet?: (item: CharacterReactionItem, reaction: CharacterReaction | null) => void;
}

export function ReactionCharacterCard({ item, reaction, readOnly, handleProps, isDragging, onSet }: CardProps) {
  const p = getT().profile;
  const title = item.name || item.external_id;
  const actions: ReactNode = !readOnly && onSet && (
    <div className="fav-card-icons">
      <div className="fav-card-icons-row">
        {CHARACTER_REACTIONS.filter(r => r !== reaction).map(r => (
          <button
            key={r}
            type="button"
            className="fav-edit-image-btn char-reaction-move-btn"
            title={interpolate(p.reactions_move_to, { reaction: reactionLabel(r) })}
            aria-label={interpolate(p.reactions_move_to, { reaction: reactionLabel(r) })}
            onClick={e => { e.stopPropagation(); e.preventDefault(); onSet(item, r); }}
          >
            <ReactionIcon reaction={r} size={11} />
          </button>
        ))}
        <button
          type="button"
          className="fav-remove-btn"
          title={p.reactions_remove}
          aria-label={p.reactions_remove}
          onClick={e => { e.stopPropagation(); e.preventDefault(); onSet(item, null); }}
        >
          <IconX size={11} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
  return (
    <div {...handleProps} className={`fav-card char-reaction-card${isDragging ? ' is-dragging' : ''}`}>
      <a className="fav-card-link" href={characterPageUrl(item.external_id)} draggable={false} aria-label={title} />
      {actions}
      {item.image_url ? (
        <img className="fav-cover" src={wrapAssetUrl(item.image_url)} alt={title} loading="lazy" decoding="async" draggable={false} />
      ) : (
        <div className="fav-no-cover"><span>{title.slice(0, 2).toUpperCase()}</span></div>
      )}
      <div className="fav-overlay">
        <span className="fav-title">{title}</span>
      </div>
    </div>
  );
}

interface Props {
  reactions: CharacterReactionGroups;
  readOnly?: boolean;
}

export function CharacterReactionsPanel({ reactions, readOnly = false }: Props) {
  const p = getT().profile;
  const [groups, setGroups] = useState(reactions);
  const [source, setSource] = useState(reactions);
  const [open, setOpen] = useState<CharacterReaction | null>(null);
  // Fresh data from the parent (a re-render of the tab) replaces local edits.
  if (source !== reactions) {
    setSource(reactions);
    setGroups(reactions);
  }
  const dispatch = (action: ReactionAction) => setGroups(current => reactionGroupsReducer(current, action));

  const counts = reactionCounts(groups);

  async function persist(write: () => Promise<void>, previous: CharacterReactionGroups): Promise<void> {
    try {
      await write();
    } catch (err) {
      dispatch({ type: 'reset', groups: previous });
      showToast(formatAppError(err, getT()), 'error');
    }
  }

  function setReaction(item: CharacterReactionItem, reaction: CharacterReaction | null): void {
    // The state this change started from — restored if the write fails.
    const previous = groups;
    dispatch({ type: 'set', item, reaction });
    void persist(() => setCharacterReaction(item.external_id, reaction), previous);
  }

  function reorder(reaction: CharacterReaction, from: number, to: number): void {
    const previous = groups;
    const ids = movedIds(previous[reaction], from, to);
    dispatch({ type: 'reorder', reaction, ids });
    void persist(() => reorderCharacterReactions(reaction, ids), previous);
  }

  const openItems = open ? groups[open] : [];

  return (
    <div className="char-reactions">
      <div className="char-reactions-track" role="group" aria-label={p.reactions_label}>
        {CHARACTER_REACTIONS.map((r, index) => (
          <Fragment key={r}>
            {index > 0 && <span className="char-reactions-line" aria-hidden="true" />}
            <div className="char-reactions-step">
              <button
                type="button"
                className={`char-reactions-node char-reactions-node--${r}${open === r ? ' active' : ''}`}
                title={`${reactionLabel(r)} · ${interpolate(p.reactions_count, { n: counts[r] })}`}
                aria-haspopup="dialog"
                onClick={() => setOpen(r)}
              >
                <ReactionIcon reaction={r} size={18} />
              </button>
              <span className="char-reactions-caption">
                <span className="char-reactions-name">{reactionLabel(r)}</span>
                <span className="char-reactions-count">{counts[r]}</span>
              </span>
            </div>
          </Fragment>
        ))}
      </div>

      <ModalShell
        open={open !== null}
        onClose={() => setOpen(null)}
        label={open ? reactionLabel(open) : p.reactions_label}
        overlayClassName="char-reactions-overlay"
        panelClassName="char-reactions-modal"
      >
        {open && (
          <>
            <div className="char-reactions-modal-header">
              <span className={`char-reactions-modal-icon char-reactions-node--${open}`}><ReactionIcon reaction={open} size={16} /></span>
              <h3 className="char-reactions-modal-title">{reactionLabel(open)}</h3>
              <span className="char-reactions-count">{openItems.length}</span>
              <button type="button" className="char-reactions-modal-close" title={p.reactions_close} aria-label={p.reactions_close} onClick={() => setOpen(null)}>
                <IconX size={14} strokeWidth={2.5} />
              </button>
            </div>
            {openItems.length === 0 ? (
              <div className="char-reactions-empty">
                <p>{p.reactions_empty}</p>
                {!readOnly && <p className="char-reactions-empty-hint">{p.reactions_empty_hint}</p>}
              </div>
            ) : readOnly ? (
              <div className="fav-grid char-reactions-grid">
                {openItems.map(item => (
                  <ReactionCharacterCard key={item.external_id} item={item} reaction={open} readOnly />
                ))}
              </div>
            ) : (
              <SortableList
                ids={openItems.map(item => item.external_id)}
                onReorder={(from, to) => reorder(open, from, to)}
                getLabel={id => openItems.find(item => item.external_id === id)?.name || id}
              >
                <div className="fav-grid char-reactions-grid">
                  {openItems.map(item => (
                    <SortableItem key={item.external_id} id={item.external_id}>
                      {({ handleProps, isDragging }) => (
                        <ReactionCharacterCard
                          item={item}
                          reaction={open}
                          readOnly={false}
                          handleProps={handleProps}
                          isDragging={isDragging}
                          onSet={setReaction}
                        />
                      )}
                    </SortableItem>
                  ))}
                </div>
              </SortableList>
            )}
          </>
        )}
      </ModalShell>
    </div>
  );
}
