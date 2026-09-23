import type { CharacterStrings } from '../../../lib/character/character-stat-labels';

interface Props {
  t: CharacterStrings;
  isFavorite: boolean;
  reaction: string | null;
  onToggleFavorite: () => void;
  onReaction: (reaction: string) => void;
}

const REACTIONS = ['like', 'interested', 'dislike'] as const;

export function CharacterActionRow({ t, isFavorite, reaction, onToggleFavorite, onReaction }: Props) {
  const reactionLabel: Record<(typeof REACTIONS)[number], string> = {
    like: t.action_like,
    interested: t.action_interested,
    dislike: t.action_dislike,
  };
  return (
    <div className="character-action-row" id="char-action-row">
      <button
        className={`char-action-btn${isFavorite ? ' active' : ''}`}
        id="char-fav-btn"
        data-action="favorite"
        title={t.action_favorite}
        onClick={onToggleFavorite}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
        </svg>
        <span>{t.action_favorite}</span>
      </button>
      {REACTIONS.map(r => (
        <button
          key={r}
          className={`char-action-btn${reaction === r ? ' active' : ''}`}
          id={`char-${r}-btn`}
          data-action={r}
          data-reaction={r}
          title={reactionLabel[r]}
          disabled
          onClick={() => onReaction(r)}
        >
          {r === 'like' && (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/>
            </svg>
          )}
          {r === 'interested' && (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>
            </svg>
          )}
          {r === 'dislike' && (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L14 22a3.13 3.13 0 0 1-3-3.88Z"/>
            </svg>
          )}
          <span>{reactionLabel[r]}</span>
        </button>
      ))}
    </div>
  );
}
