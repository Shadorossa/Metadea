import type { SeekPreviewImage } from './hooks/useSeekThumbnails';

interface Props {
  // Offset from the seek bar's left edge (already clamped to the player).
  left: number;
  width: number;
  height: number;
  image: SeekPreviewImage | null;
  time: string;
  chapter: string | null;
}

// Floating frame above the seek bar (YouTube/Netflix style): the frame, the
// hovered time and the chapter under it. Purely decorative for assistive
// tech — the range input already announces the time.
export function PlayerSeekPreview({ left, width, height, image, time, chapter }: Props) {
  return (
    <div className="player-seek-preview" style={{ left, width }} aria-hidden="true">
      <div
        className={`player-seek-preview__frame${image ? '' : ' player-seek-preview__frame--loading'}`}
        style={{ height, ...(image ?? {}) }}
      />
      <div className="player-seek-preview__time">{time}</div>
      {chapter && <div className="player-seek-preview__chapter">{chapter}</div>}
    </div>
  );
}
