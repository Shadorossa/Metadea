import { X } from 'lucide-react';
import type { PlayerSessionInfo } from '../../lib/player/player-status';
import { fileBasename } from '../../lib/player/queue';
import { playerPlayIndex } from '../../lib/tauri/player';
import type { Translations } from '../../i18n/index';

interface Props {
  session: PlayerSessionInfo;
  currentIndex: number;
  onClose: () => void;
  t: Translations['player'];
}

export function PlayerQueuePanel({ session, currentIndex, onClose, t }: Props) {
  return (
    <aside className="player-queue" aria-label={t.queue}>
      <header className="player-queue__header">
        <h2 className="player-queue__title">{t.queue}</h2>
        <button type="button" className="player-icon-btn" onClick={onClose} aria-label={t.close_queue} title={t.close_queue}>
          <X size={16} />
        </button>
      </header>
      <ol className="player-queue__list">
        {session.queue.map((path, index) => {
          const label = session.episode_labels[index] ?? '';
          const title = session.titles[index]?.trim() || fileBasename(path);
          const current = index === currentIndex;
          return (
            <li key={`${index}-${path}`}>
              <button
                type="button"
                className={`player-queue__item${current ? ' player-queue__item--current' : ''}`}
                aria-current={current ? 'true' : undefined}
                onClick={() => playerPlayIndex(index).catch(err => console.error('Queue jump failed', err))}
              >
                <span className="player-queue__label">{label}</span>
                <span className="player-queue__name">{title}</span>
                {current && <span className="player-queue__now">{t.queue_now_playing}</span>}
              </button>
            </li>
          );
        })}
      </ol>
      <p className="player-queue__hint">{t.shortcuts_hint}</p>
    </aside>
  );
}
