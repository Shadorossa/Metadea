import { useEffect, useState } from 'react';
import { backgroundTargetPx, highResArtUrl } from '../../lib/big-picture/hero-resolution';

// Wait before swapping the background, so skimming the grid does not
// decode (and blur) a new image for every card passed over.
const SWAP_DELAY_MS = 220;

interface Layer {
  src: string | null;
  /** Sharp key art (the PS5 skin) rather than a picture to blur. */
  art: boolean;
  id: number;
}

interface BigPictureBackdropProps {
  image: string | null;
  /** `image` is landscape key art: the PS5 skin shows it sharp. */
  art?: boolean;
  /** Override SWAP_DELAY_MS — the PS5 skin's image already follows focus
   *  late (useHeroArt). */
  delayMs?: number;
}

// Cinematic background: the focused item's art, heavily blurred (or, in
// the PS5 skin, sharp key art), cross-faded between two stacked layers
// (opacity only). A new image only takes over once it has loaded, so the
// old one never flashes to black.
export function BigPictureBackdrop({ image, art = false, delayMs = SWAP_DELAY_MS }: BigPictureBackdropProps) {
  const [layers, setLayers] = useState<{ front: Layer; back: Layer }>({
    front: { src: null, art: false, id: 0 },
    back: { src: null, art: false, id: -1 },
  });

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const swap = () => {
        if (cancelled) return;
        setLayers(prev => (prev.front.src === image && prev.front.art === art
          ? prev
          : { front: { src: image, art, id: prev.front.id + 1 }, back: prev.front }));
      };
      if (!image) { swap(); return; }
      const probe = new Image();
      probe.decoding = 'async';
      probe.onload = () => {
        swap();
        // Sharp key art: fetch the provider's largest rendition for this
        // screen and cross-fade to it once loaded (hero-resolution.ts); a
        // missing/slow large file just leaves the current one up.
        if (!art) return;
        const hiRes = highResArtUrl(image, backgroundTargetPx());
        if (hiRes === image) return;
        const upgrade = new Image();
        upgrade.decoding = 'async';
        upgrade.onload = () => {
          if (cancelled || upgrade.naturalWidth <= probe.naturalWidth) return;
          setLayers(prev => (prev.front.src !== image
            ? prev
            : { front: { src: hiRes, art, id: prev.front.id + 1 }, back: prev.front }));
        };
        upgrade.src = hiRes;
      };
      probe.onerror = () => {};
      probe.src = image;
    }, delayMs);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [image, art, delayMs]);

  return (
    <div className="bp-backdrop" aria-hidden="true">
      {[layers.back, layers.front].map((layer, i) => (
        <div
          key={layer.id}
          className={`bp-backdrop-layer${i === 1 ? ' is-front' : ''}${layer.art ? ' is-art' : ''}`}
          style={layer.src ? { backgroundImage: `url("${layer.src.replace(/"/g, '%22')}")` } : undefined}
        />
      ))}
      <div className="bp-backdrop-shade" />
    </div>
  );
}
