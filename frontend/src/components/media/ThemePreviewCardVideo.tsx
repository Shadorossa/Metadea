import { useRef } from 'react';

interface Props {
  src: string;
}

// Muted, no controls, seeks to the video's midpoint once its duration is
// known and manually loops just the 3s from there — native `loop` only
// repeats the WHOLE clip, and starting from 0 would show mostly the
// still title-card frame every OP/ED opens on instead of an actual preview
// of the song.
const PREVIEW_SECONDS = 3;

export function ThemePreviewCardVideo({ src }: Props) {
  const midpointRef = useRef(0);

  const handleLoadedMetadata = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = e.currentTarget;
    midpointRef.current = video.duration / 2;
    video.currentTime = midpointRef.current;
  };

  const handleTimeUpdate = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = e.currentTarget;
    if (video.currentTime - midpointRef.current >= PREVIEW_SECONDS) {
      video.currentTime = midpointRef.current;
    }
  };

  return (
    <video
      className="media-theme-preview-video"
      src={src}
      muted
      autoPlay
      playsInline
      preload="metadata"
      onLoadedMetadata={handleLoadedMetadata}
      onTimeUpdate={handleTimeUpdate}
    />
  );
}
