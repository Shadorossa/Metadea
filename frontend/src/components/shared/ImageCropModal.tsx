// Generic pan/zoom image picker modal — paste a URL, drag to pan, slider to
// zoom, both driving CSS width/left/top/transform percentages on the
// preview <img> (background-size/background-position math, but on a real
// element instead of a background-image — background-image on the card
// itself silently failed to render in the packaged production build).
// Shared by the profile Favorites custom-image editor (which persists the
// resulting crop) and the character photo editor (which only wants the
// picked URL, previewed at the right aspect ratio — see callers for how the
// result is used).
import { useEffect, useRef, useState, createElement, type PointerEvent as ReactPointerEvent } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { wrapAssetUrl } from '../../lib/tauri';

// Fallback bounds while the image's natural size hasn't loaded yet.
const DEFAULT_MIN_ZOOM = 100;
const DEFAULT_MAX_ZOOM = 400;

export interface ImageCropModalOptions {
  title: string;
  initialUrl: string;
  /** width / height, e.g. 3/4 for a portrait card. Defaults to 3/4. */
  aspectRatio?: number;
  initialBgSize?: number;
  initialPosX?: number;
  initialPosY?: number;
  /** Shows a left-aligned "remove" button (e.g. "Quitar imagen personalizada"). */
  removeLabel?: string;
  saveLabel?: string;
}

export type ImageCropModalResult =
  | { action: 'saved'; imageUrl: string; bgSize: number; posX: number; posY: number }
  | { action: 'removed' }
  | { action: 'cancelled' };

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

interface Props {
  opts: ImageCropModalOptions;
  onResolve: (result: ImageCropModalResult) => void;
}

function ImageCropModal({ opts, onResolve }: Props) {
  const aspectRatio = opts.aspectRatio ?? 3 / 4;

  const [imageUrl, setImageUrl] = useState(opts.initialUrl);
  const [bgSize, setBgSize] = useState(opts.initialBgSize ?? DEFAULT_MIN_ZOOM);
  const [posX, setPosX] = useState(opts.initialPosX ?? 50);
  const [posY, setPosY] = useState(opts.initialPosY ?? 50);
  const [zoomMin, setZoomMin] = useState(DEFAULT_MIN_ZOOM);
  const [zoomMax, setZoomMax] = useState(DEFAULT_MAX_ZOOM);

  const hasCustomBgSizeRef = useRef(opts.initialBgSize != null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const draggingRef = useRef(false);
  const lastRef = useRef({ x: 0, y: 0 });
  const loadTokenRef = useRef(0);

  // Recomputes the zoom range from the image's own natural resolution
  // whenever the URL changes, so:
  //  - the minimum always fully covers the frame (same crop math as
  //    object-fit: cover, no gaps at rest), and
  //  - the maximum never scales the image past its native pixel size,
  //    which is what produces soft/jagged ("dientes de sierra") edges.
  useEffect(() => {
    if (!imageUrl) return;
    const token = ++loadTokenRef.current;
    const probe = new Image();
    probe.onload = () => {
      if (token !== loadTokenRef.current) return; // a newer URL loaded meanwhile
      const naturalW = probe.naturalWidth || 0;
      const naturalH = probe.naturalHeight || 0;
      if (!naturalW || !naturalH) return;

      const rect = viewportRef.current?.getBoundingClientRect();
      const viewportW = rect?.width || 300;
      const imgAspect = naturalW / naturalH;

      // background-size: X% sets displayed width to X% of the container and
      // scales height to preserve the image's own aspect ratio, so covering
      // the frame vertically needs X% >= (Hc/Wc) * imgAspect.
      const coverPercent = Math.round(Math.max(100, (1 / aspectRatio) * imgAspect * 100));
      const nativePercent = Math.round((naturalW / viewportW) * 100);
      const newMin = coverPercent;
      const newMax = Math.max(newMin, Math.min(DEFAULT_MAX_ZOOM, nativePercent));

      setZoomMin(newMin);
      setZoomMax(newMax);
      setBgSize(prev => clamp(hasCustomBgSizeRef.current ? prev : newMin, newMin, newMax));
    };
    probe.src = wrapAssetUrl(imageUrl);
  }, [imageUrl, aspectRatio]);

  // Drag-to-pan — pixel delta is converted to a background-position percent
  // delta relative to the viewport's own size, which reads as a natural
  // "grab and drag the image" motion without needing the image's real
  // pixel dimensions.
  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!imageUrl) return;
    draggingRef.current = true;
    lastRef.current = { x: e.clientX, y: e.clientY };
    viewportRef.current?.setPointerCapture(e.pointerId);
    viewportRef.current?.classList.add('dragging');
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current || !viewportRef.current) return;
    const rect = viewportRef.current.getBoundingClientRect();
    const dxPercent = ((e.clientX - lastRef.current.x) / rect.width) * 100;
    const dyPercent = ((e.clientY - lastRef.current.y) / rect.height) * 100;
    lastRef.current = { x: e.clientX, y: e.clientY };
    // Dragging right moves the visible window left, so the image appears to
    // follow the pointer — hence the position moving opposite the delta.
    setPosX(p => clamp(p - dxPercent, 0, 100));
    setPosY(p => clamp(p - dyPercent, 0, 100));
  };

  const stopDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    viewportRef.current?.classList.remove('dragging');
    try { viewportRef.current?.releasePointerCapture(e.pointerId); } catch { /* already released */ }
  };

  const close = (result: ImageCropModalResult) => onResolve(result);

  return (
    <div className="img-crop-overlay" onClick={e => { if (e.target === e.currentTarget) close({ action: 'cancelled' }); }}>
      <div className="img-crop-modal">
        <h3 className="img-crop-title">{opts.title}</h3>
        <input
          ref={urlInputRef}
          type="text"
          className="img-crop-url"
          placeholder="URL de la imagen..."
          value={imageUrl}
          onChange={e => {
            hasCustomBgSizeRef.current = false;
            setImageUrl(e.target.value.trim());
          }}
        />
        <div
          ref={viewportRef}
          className="img-crop-viewport"
          style={{ aspectRatio: String(aspectRatio) }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={stopDrag}
          onPointerCancel={stopDrag}
        >
          <img
            className="img-crop-preview"
            alt=""
            src={imageUrl ? wrapAssetUrl(imageUrl) : undefined}
            style={imageUrl ? {
              visibility: 'visible',
              width: `${bgSize}%`,
              left: `${posX}%`,
              top: `${posY}%`,
              transform: `translate(-${posX}%, -${posY}%)`,
            } : { visibility: 'hidden' }}
          />
          {!imageUrl && <div className="img-crop-empty">Pega una URL de imagen arriba</div>}
        </div>
        <label className="img-crop-zoom-label">
          Zoom
          <input
            type="range"
            className="img-crop-zoom"
            min={zoomMin}
            max={zoomMax}
            value={bgSize}
            onChange={e => {
              hasCustomBgSizeRef.current = true;
              setBgSize(Number(e.target.value));
            }}
          />
        </label>
        <div className="img-crop-actions">
          {opts.removeLabel
            ? <button type="button" className="list-btn list-btn--ghost" onClick={() => close({ action: 'removed' })}>{opts.removeLabel}</button>
            : <span />}
          <div className="img-crop-actions-right">
            <button type="button" className="list-btn list-btn--ghost" onClick={() => close({ action: 'cancelled' })}>Cancelar</button>
            <button
              type="button"
              className="list-btn list-btn--primary"
              onClick={() => {
                if (!imageUrl) { urlInputRef.current?.focus(); return; }
                close({ action: 'saved', imageUrl, bgSize, posX, posY });
              }}
            >
              {opts.saveLabel ?? 'Guardar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Preserves the old imperative "open a modal, await the result" API so
// non-React callers (favorite-image-editor.ts) and React ones
// (CharacterPrEditorModal.tsx) don't need to change at all — this just
// mounts a fresh React root into a detached container appended to
// document.body for the lifetime of the modal, and tears it down on close.
export function openImageCropModal(opts: ImageCropModalOptions): Promise<ImageCropModalResult> {
  return new Promise(resolve => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    const handleResolve = (result: ImageCropModalResult) => {
      root.unmount();
      container.remove();
      resolve(result);
    };

    root.render(createElement(ImageCropModal, { opts, onResolve: handleResolve }));
  });
}
