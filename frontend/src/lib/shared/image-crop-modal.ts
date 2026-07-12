// Generic pan/zoom image picker modal — paste a URL, drag to pan, slider to
// zoom, both driving CSS background-size/background-position percentages.
// Shared by the profile Favorites custom-image editor (which persists the
// resulting crop) and the character photo editor (which only wants the
// picked URL, previewed at the right aspect ratio — see callers for how the
// result is used).
import { wrapAssetUrl } from '../tauri';

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

export function openImageCropModal(opts: ImageCropModalOptions): Promise<ImageCropModalResult> {
  const aspectRatio = opts.aspectRatio ?? 3 / 4;

  return new Promise(resolve => {
    let bgSize = opts.initialBgSize ?? DEFAULT_MIN_ZOOM;
    let posX = opts.initialPosX ?? 50;
    let posY = opts.initialPosY ?? 50;
    let imageUrl = opts.initialUrl;
    let hasCustomBgSize = opts.initialBgSize != null;

    const overlay = document.createElement('div');
    overlay.className = 'img-crop-overlay';
    overlay.innerHTML = `
      <div class="img-crop-modal">
        <h3 class="img-crop-title">${escapeHtml(opts.title)}</h3>
        <input type="text" class="img-crop-url" placeholder="URL de la imagen..." value="${escapeAttr(imageUrl)}" />
        <div class="img-crop-viewport" style="aspect-ratio: ${aspectRatio};">
          <div class="img-crop-preview"></div>
          <div class="img-crop-empty">Pega una URL de imagen arriba</div>
        </div>
        <label class="img-crop-zoom-label">
          Zoom
          <input type="range" class="img-crop-zoom" min="${DEFAULT_MIN_ZOOM}" max="${DEFAULT_MAX_ZOOM}" value="${bgSize}" />
        </label>
        <div class="img-crop-actions">
          ${opts.removeLabel ? `<button type="button" class="list-btn list-btn--ghost" id="img-crop-remove">${escapeHtml(opts.removeLabel)}</button>` : '<span></span>'}
          <div class="img-crop-actions-right">
            <button type="button" class="list-btn list-btn--ghost" id="img-crop-cancel">Cancelar</button>
            <button type="button" class="list-btn list-btn--primary" id="img-crop-save">${escapeHtml(opts.saveLabel ?? 'Guardar')}</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const urlInput   = overlay.querySelector<HTMLInputElement>('.img-crop-url')!;
    const viewport    = overlay.querySelector<HTMLElement>('.img-crop-viewport')!;
    const preview     = overlay.querySelector<HTMLElement>('.img-crop-preview')!;
    const emptyState  = overlay.querySelector<HTMLElement>('.img-crop-empty')!;
    const zoomSlider  = overlay.querySelector<HTMLInputElement>('.img-crop-zoom')!;
    const removeBtn   = overlay.querySelector<HTMLButtonElement>('#img-crop-remove');
    const cancelBtn   = overlay.querySelector<HTMLButtonElement>('#img-crop-cancel')!;
    const saveBtn     = overlay.querySelector<HTMLButtonElement>('#img-crop-save')!;

    const applyPreview = () => {
      if (!imageUrl) {
        preview.style.backgroundImage = '';
        emptyState.style.display = 'flex';
        return;
      }
      emptyState.style.display = 'none';
      preview.style.backgroundImage = `url("${wrapAssetUrl(imageUrl)}")`;
      preview.style.backgroundSize = `${bgSize}%`;
      preview.style.backgroundPosition = `${posX}% ${posY}%`;
    };
    applyPreview();

    // Recomputes the zoom range from the image's own natural resolution so:
    //  - the minimum always fully covers the frame (same crop math as
    //    object-fit: cover, no gaps at rest), and
    //  - the maximum never scales the image past its native pixel size,
    //    which is what produces soft/jagged ("dientes de sierra") edges.
    let loadToken = 0;
    const recomputeZoomBounds = (url: string) => {
      const token = ++loadToken;
      const probe = new Image();
      probe.onload = () => {
        if (token !== loadToken) return; // a newer URL loaded meanwhile
        const naturalW = probe.naturalWidth || 0;
        const naturalH = probe.naturalHeight || 0;
        if (!naturalW || !naturalH) return;

        const rect = viewport.getBoundingClientRect();
        const viewportW = rect.width || 300;
        const imgAspect = naturalW / naturalH;

        // background-size: X% sets displayed width to X% of the container
        // and scales height to preserve the image's own aspect ratio, so
        // covering the frame vertically needs X% >= (Hc/Wc) * imgAspect.
        const coverPercent = Math.round(Math.max(100, (1 / aspectRatio) * imgAspect * 100));
        const nativePercent = Math.round((naturalW / viewportW) * 100);
        const newMin = coverPercent;
        const newMax = Math.max(newMin, Math.min(DEFAULT_MAX_ZOOM, nativePercent));

        zoomSlider.min = String(newMin);
        zoomSlider.max = String(newMax);
        if (!hasCustomBgSize) bgSize = newMin;
        bgSize = Math.min(Math.max(bgSize, newMin), newMax);
        zoomSlider.value = String(bgSize);
        applyPreview();
      };
      probe.src = wrapAssetUrl(url);
    };
    recomputeZoomBounds(imageUrl);

    urlInput.addEventListener('input', () => {
      imageUrl = urlInput.value.trim();
      hasCustomBgSize = false;
      applyPreview();
      if (imageUrl) recomputeZoomBounds(imageUrl);
    });

    zoomSlider.addEventListener('input', () => {
      bgSize = Number(zoomSlider.value);
      hasCustomBgSize = true;
      applyPreview();
    });

    // Drag-to-pan — pixel delta is converted to a background-position percent
    // delta relative to the viewport's own size, which reads as a natural
    // "grab and drag the image" motion without needing the image's real
    // pixel dimensions.
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    viewport.addEventListener('pointerdown', (e: PointerEvent) => {
      if (!imageUrl) return;
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      viewport.setPointerCapture(e.pointerId);
      viewport.classList.add('dragging');
    });

    viewport.addEventListener('pointermove', (e: PointerEvent) => {
      if (!dragging) return;
      const rect = viewport.getBoundingClientRect();
      const dxPercent = ((e.clientX - lastX) / rect.width) * 100;
      const dyPercent = ((e.clientY - lastY) / rect.height) * 100;
      lastX = e.clientX;
      lastY = e.clientY;
      // Dragging right moves the visible window left, so the image appears
      // to follow the pointer — hence the position moving opposite the delta.
      posX = clamp(posX - dxPercent, 0, 100);
      posY = clamp(posY - dyPercent, 0, 100);
      applyPreview();
    });

    const stopDrag = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      viewport.classList.remove('dragging');
      try { viewport.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    };
    viewport.addEventListener('pointerup', stopDrag);
    viewport.addEventListener('pointercancel', stopDrag);

    const close = (result: ImageCropModalResult) => {
      overlay.remove();
      resolve(result);
    };

    cancelBtn.addEventListener('click', () => close({ action: 'cancelled' }));
    overlay.addEventListener('click', e => { if (e.target === overlay) close({ action: 'cancelled' }); });

    removeBtn?.addEventListener('click', () => close({ action: 'removed' }));

    saveBtn.addEventListener('click', () => {
      if (!imageUrl) { urlInput.focus(); return; }
      close({ action: 'saved', imageUrl, bgSize, posX, posY });
    });
  });
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
