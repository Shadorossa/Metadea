import { useReadingSession, useResumeOpen, clearReadingSession, setReadingSession, openResumeModal, closeResumeModal } from '../../lib/reader/reading-session';
import { usePlaybackState } from '../../lib/local/playback-service';
import { AnimatePresence } from 'motion/react';
import { wrapAssetUrl } from '../../lib/tauri';
import { toSmallCover } from '../../lib/shared/small-cover';
import { NowMediaBar } from '../shared/NowMediaBar';
import { ReaderModal } from './ReaderModal';
import { IconX } from '../local/ui/icons';
import { getT } from '../../i18n/client';

export function NowReadingBar() {
  const t = getT().reader;
  const session = useReadingSession();
  const resumeOpen = useResumeOpen();
  const playback = usePlaybackState();

  const cover = session?.cover
    ? wrapAssetUrl(session.cover.startsWith('http') ? toSmallCover(session.cover) : session.cover)
    : null;

  const mediaUrl = session ? `/media?id=${encodeURIComponent(session.externalId)}` : '#';

  const progressPct = session && session.totalSpreads > 1
    ? Math.min(100, (session.spreadIndex / (session.totalSpreads - 1)) * 100)
    : 0;

  const pageLabel = session && session.pageCount > 0
    ? `Pag. ${Math.min(session.spreadIndex * 2 + 1, session.pageCount)} / ${session.pageCount}`
    : '';

  return (
    <>
      <AnimatePresence>
        {session && (
          <NowMediaBar
          className={`now-reading-bar${playback ? ' now-reading-bar--above-player' : ''}`}
          progressTrackClassName="now-reading-progress-track"
          progressFillClassName="now-reading-progress-fill"
          progressPct={progressPct}
          mediaUrl={mediaUrl}
          cover={cover}
          title={session.title}
          subtitle={<>{pageLabel} &middot; {t.standby_aria}</>}
          controls={
            <>
              <button
                type="button"
                className="now-playing-btn"
                onClick={openResumeModal}
                aria-label={t.continue_reading_aria}
                title={t.continue_reading_title}
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
                aria-label={t.close_session_aria}
                title={t.close_session_title}
              >
                <IconX size={14} />
              </button>
            </>
          }
        />
      )}
      </AnimatePresence>

      {session && resumeOpen && (
        <ReaderModal
          externalId={session.externalId}
          title={session.title}
          filePath={session.filePath}
          episodeNumber={session.episodeNumber}
          totalCount={session.totalCount}
          libraryEntry={session.libraryEntry}
          isSingleTomo={session.isSingleTomo}
          cover={session.cover}
          onClose={closeResumeModal}
          onStandBy={(spreadIndex, totalSpreads, pageCount) => {
            setReadingSession({ ...session, spreadIndex, totalSpreads, pageCount });
            closeResumeModal();
          }}
          onProgressSaved={() => {}}
        />
      )}
    </>
  );
}
