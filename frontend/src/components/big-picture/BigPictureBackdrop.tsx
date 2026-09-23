import { useEffect, useState } from 'react';

// Wait before swapping the background, so skimming the grid does not
// decode (and blur) a new image for every card passed over.
const SWAP_DELAY_MS = 220;

interface Layer {
  src: string | null;
  id: number;
}

// Cinematic background: the focused item's art, heavily blurred, cross-
// faded between two stacked layers (opacity only). A new image only takes
// over once it has loaded, so the old one never flashes to black.
export function BigPictureBackdrop({ image }: { image: string | null }) {
  const [layers, setLayers] = useState<{ front: Layer; back: Layer }>({
    front: { src: null, id: 0 },
    back: { src: null, id: -1 },
  });

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const swap = () => {
        if (cancelled) return;
        setLayers(prev => (prev.front.src === image ? prev : { front: { src: image, id: prev.front.id + 1 }, back: prev.front }));
      };
      if (!image) { swap(); return; }
      const probe = new Image();
      probe.decoding = 'async';
      probe.onload = swap;
      probe.onerror = () => {};
      probe.src = image;
    }, SWAP_DELAY_MS);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [image]);

  return (
    <div className="bp-backdrop" aria-hidden="true">
      {[layers.back, layers.front].map((layer, i) => (
        <div
          key={layer.id}
          className={`bp-backdrop-layer${i === 1 ? ' is-front' : ''}`}
          style={layer.src ? { backgroundImage: `url("${layer.src.replace(/"/g, '%22')}")` } : undefined}
        />
      ))}
      <div className="bp-backdrop-shade" />
    </div>
  );
}
