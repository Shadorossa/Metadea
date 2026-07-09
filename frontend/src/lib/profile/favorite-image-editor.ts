import { saveFavoriteCustomImage, deleteFavoriteCustomImage, type FavoriteCustomImage } from '../tauri';

// Local-only cover editor for the profile Favorites tab. Renders a modal
// where the user pastes an image URL, then drags to pan and uses a slider to
// zoom — both directly drive CSS background-size/background-position
// percentages, so the live preview here and the final card render in
// render-favorites.ts use the exact same formula (no separate crop math to
// keep in sync).

const MIN_ZOOM = 100;
const MAX_ZOOM = 400;

export type EditorResult =
  | { action: 'saved'; image: FavoriteCustomImage }
  | { action: 'removed' }
  | { action: 'cancelled' };

export function openFavoriteImageEditor(
  externalId: string,
  fallbackImageUrl: string,
  existing: FavoriteCustomImage | undefined,
): Promise<EditorResult> {
  return new Promise(resolve => {
    let bgSize = existing?.bg_size ?? 100;
    let posX = existing?.pos_x ?? 50;
    let posY = existing?.pos_y ?? 50;
    let imageUrl = existing?.image_url || fallbackImageUrl;

    const overlay = document.createElement('div');
    overlay.className = 'fav-img-editor-overlay';
    overlay.innerHTML = `
      <div class="fav-img-editor-modal">
        <h3 class="fav-img-editor-title">Editar imagen</h3>
        <input type="text" class="fav-img-editor-url" placeholder="URL de la imagen..." value="${escapeAttr(imageUrl)}" />
        <div class="fav-img-editor-viewport">
          <div class="fav-img-editor-preview"></div>
          <div class="fav-img-editor-empty">Pega una URL de imagen arriba</div>
        </div>
        <label class="fav-img-editor-zoom-label">
          Zoom
          <input type="range" class="fav-img-editor-zoom" min="${MIN_ZOOM}" max="${MAX_ZOOM}" value="${bgSize}" />
        </label>
        <div class="fav-img-editor-actions">
          <button type="button" class="list-btn list-btn--ghost" id="fav-img-editor-reset">Quitar imagen personalizada</button>
          <div class="fav-img-editor-actions-right">
            <button type="button" class="list-btn list-btn--ghost" id="fav-img-editor-cancel">Cancelar</button>
            <button type="button" class="list-btn list-btn--primary" id="fav-img-editor-save">Guardar</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const urlInput   = overlay.querySelector<HTMLInputElement>('.fav-img-editor-url')!;
    const viewport    = overlay.querySelector<HTMLElement>('.fav-img-editor-viewport')!;
    const preview     = overlay.querySelector<HTMLElement>('.fav-img-editor-preview')!;
    const emptyState  = overlay.querySelector<HTMLElement>('.fav-img-editor-empty')!;
    const zoomSlider  = overlay.querySelector<HTMLInputElement>('.fav-img-editor-zoom')!;
    const resetBtn    = overlay.querySelector<HTMLButtonElement>('#fav-img-editor-reset')!;
    const cancelBtn   = overlay.querySelector<HTMLButtonElement>('#fav-img-editor-cancel')!;
    const saveBtn     = overlay.querySelector<HTMLButtonElement>('#fav-img-editor-save')!;

    const applyPreview = () => {
      if (!imageUrl) {
        preview.style.backgroundImage = '';
        emptyState.style.display = 'flex';
        return;
      }
      emptyState.style.display = 'none';
      preview.style.backgroundImage = `url("${imageUrl}")`;
      preview.style.backgroundSize = `${bgSize}%`;
      preview.style.backgroundPosition = `${posX}% ${posY}%`;
    };
    applyPreview();

    urlInput.addEventListener('input', () => {
      imageUrl = urlInput.value.trim();
      applyPreview();
    });

    zoomSlider.addEventListener('input', () => {
      bgSize = Number(zoomSlider.value);
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

    const close = (result: EditorResult) => {
      overlay.remove();
      resolve(result);
    };

    cancelBtn.addEventListener('click', () => close({ action: 'cancelled' }));
    overlay.addEventListener('click', e => { if (e.target === overlay) close({ action: 'cancelled' }); });

    resetBtn.addEventListener('click', async () => {
      await deleteFavoriteCustomImage(externalId).catch(console.error);
      close({ action: 'removed' });
    });

    saveBtn.addEventListener('click', async () => {
      if (!imageUrl) { urlInput.focus(); return; }
      saveBtn.disabled = true;
      try {
        const image = await saveFavoriteCustomImage(externalId, imageUrl, bgSize, posX, posY);
        close({ action: 'saved', image });
      } catch (err) {
        console.error('Failed to save custom favorite image:', err);
        saveBtn.disabled = false;
      }
    });
  });
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;');
}
