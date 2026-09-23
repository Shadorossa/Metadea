import { useState, type ImgHTMLAttributes } from 'react';
import { useTextlessCover } from './hooks/useTextlessCover';

type CoverImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  /** The work this cover belongs to (`movie:603`, `game:1942`, ...). */
  externalId: string | null | undefined;
  /** The cover the card would render anyway — always painted first. */
  src: string;
};

// The one <img> for a work's cover: renders `src` as-is, and swaps in the
// textless version (Settings > Preferences > Library, "Prefer clean covers")
// once it resolves. Same element, same CSS box, so the swap never shifts
// layout; key art is marked `data-textless="art"` and center-cropped by
// components.css. A textless URL that fails to load falls back to `src`
// without reaching the caller's onError.
export function CoverImage({ externalId, src, onError, ...imgProps }: CoverImageProps) {
  const { observe, ...cover } = useTextlessCover(externalId, src);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const textlessSrc = cover.textless && cover.src !== failedUrl ? cover.src : null;
  const showTextless = !!textlessSrc;
  return (
    <img
      {...imgProps}
      ref={observe}
      src={textlessSrc ?? src}
      data-textless={showTextless ? (cover.cropped ? 'art' : 'poster') : undefined}
      onError={e => {
        if (textlessSrc) { setFailedUrl(textlessSrc); return; }
        onError?.(e);
      }}
    />
  );
}
