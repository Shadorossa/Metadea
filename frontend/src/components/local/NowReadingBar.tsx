// Global "now reading" bar -- mirrors NowPlayingBar but for the comic reader
// stand-by state. Mounted once in BaseLayout.astro (transition:persist) so
// it survives page transitions. Resume re-opens ComicReaderModal at the saved page.
import { useState } from 'react';
import { useReadingSession, clearReadingSession, setReadingSession } from '../../lib/local/reading-session';
import { usePlaybackState } from '../../lib/local/playback-service';
import { wrapAssetUrl } from '../../lib/tauri';
import { toSmallCover } from '../../lib/shared/small-cover';
import { ComicReaderModal } from './ComicReaderModal';
import { IconX } from './ui/icons';

export function NowReadingBar() {
  const session = useReadingSession();
  const playback = usePlaybackState();
  const [resumeOpen, setResumeOpen] = useState(false);

  if (!session) return null;

  const cover = session.cover
    ? wrapAssetUrl(session.cover.startsWith('http') ? toSmallCover(session.cover) : session.cover)
    : null;

  const mediaUrl = `/media?id=${encodeURIComponent(session.externalId)}`;

  const progressPct = session.totalSpreads > 1
    ? Math.min(100, (session.spreadIndex / (session.totalSpreads - 1)) * 100)
    : 0;

  const pageLabel = session.pageCount > 0
    ? `Pag. ${Math.min(session.spreadIndex * 2 + 1, session.pageCount)} / ${session.pageCount}`
    : '';

  return (
    <>
      <div className={`now-reading-bar${playback ? ' now-reading-bar--above-player' : ''}`}>
        <div className="now-reading-progress-track">
          <div className="now-reading-progress-fill" style={{ width: `${progressPct}%` }} />
        </div>
        <div className="now-playing-content">
          <a className="now-playing-cover-link" href={mediaUrl}>
            {cover
              ? <img className="now-playing-cover" src={cover} alt="" />
              : <div className="now-playing-cover now-playing-cover--empty" />}
          </a>
          <div className="now-playing-info">
            <a className="now-playing-title" href={mediaUrl}>{session.title}</a>
            <span className="now-playing-episode">{pageLabel} &middot; En pausa</span>
          </div>
          <div className="now-playing-controls">
            <button
              type="button"
              className="now-playing-btn"
              onClick={() => setResumeOpen(true)}
              aria-label="Continuar leyendo"
              title="Continuar leyendo"
            >
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
              </svg>
            </button>
            <button
              type="button"
              className="now-playing-btn now-playing-btn--close"
              onClick={clearReadingSession}
              aria-label="Cerrar sesion de lectura"
              title="Cerrar"
            >
              <IconX size={14} />
            </button>
          </div>
        </div>
      </div>

      {resumeOpen && (
        <ComicReaderModal
          externalId={session.externalId}
          title={session.title}
          filePath={session.filePath}
          episodeNumber={session.episodeNumber}
          totalCount={session.totalCount}
          libraryEntry={session.libraryEntry}
          isSingleTomo={session.isSingleTomo}
          cover={session.cover}
          onClose={() => { clearReadingSession(); setResumeOpen(false); }}
          onStandBy={(spreadIndex, totalSpreads, pageCount) => {
            setReadingSession({ ...session, spreadIndex, totalSpreads, pageCount });
            setResumeOpen(false);
          }}
          onProgressSaved={() => {}}
        />
      )}
    </>
  );
}
