// "Share image" button for the tier list board and the yearly bingo: a
// small icon button with a menu (Save PNG / Copy image / Preview). The PNG
// is rendered on demand by lib/share-image from whatever `build` returns,
// once per menu opening, and reused by every action in that opening.
import '../../styles/components/share-image.css';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Copy, Download, Eye, ImageDown, LoaderCircle, X } from 'lucide-react';
import { getT } from '../../i18n/runtime';
import type { Translations } from '../../i18n/types';
import { interpolateTranslation } from '../../lib/i18n-dom/apply-translations';
import { showToast } from '../../lib/dom/toast';
import { formatAppError } from '../../lib/errors/format-error';
import { copySharePng, renderShareImage, saveSharePng, type RenderedShareImage, type ShareImageInput, type ShareImageStrings } from '../../lib/share-image';
import { ModalShell } from './ModalShell';

export interface ShareImageButtonProps {
  /** Collects the data at click time (fresh board / bingo state). */
  build: () => Promise<ShareImageInput>;
  /** e.g. tierListImageFileName(title) / bingoImageFileName(year). */
  fileName: string;
  /** Visible text next to the icon; icon-only when omitted. */
  label?: string;
  className?: string;
  disabled?: boolean;
}

type Busy = 'save' | 'copy' | 'preview' | null;

function shareStrings(t: Translations['share_image']): ShareImageStrings {
  return {
    tierUnplaced: t.tier_unplaced,
    bingoTitle: t.bingo_title,
    bingoPercent: t.bingo_percent,
    bingoLinesOne: t.bingo_lines_one,
    bingoLinesOther: t.bingo_lines_other,
    bingoPicks: t.bingo_picks,
  };
}

export function ShareImageButton({ build, fileName, label, className, disabled }: ShareImageButtonProps) {
  const t = getT();
  const s = t.share_image;
  const menuId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const renderRef = useRef<Promise<RenderedShareImage> | null>(null);
  // Cleared on close, so a render that finishes afterwards is dropped.
  const previewWantedRef = useRef(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState<{ url: string; width: number; height: number } | null>(null);

  // Rendered once per menu opening; a failed render is not cached.
  const getRendered = useCallback((): Promise<RenderedShareImage> => {
    if (!renderRef.current) {
      const pending = build().then(input => renderShareImage(input, shareStrings(getT().share_image)));
      renderRef.current = pending;
      pending.catch(() => {
        if (renderRef.current === pending) renderRef.current = null;
      });
    }
    return renderRef.current;
  }, [build]);

  const reportRenderError = (err: unknown) => {
    showToast(`${s.render_failed}: ${formatAppError(err, t)}`, 'error');
  };

  // Outside click / Escape closes the menu.
  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  // Each preview URL is released when it is replaced, cleared or unmounted.
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

  const toggleMenu = () => {
    if (!menuOpen && !busy && !previewOpen) renderRef.current = null;
    setMenuOpen(open => !open);
  };

  const save = async () => {
    setMenuOpen(false);
    setBusy('save');
    try {
      let rendered: RenderedShareImage;
      try {
        rendered = await getRendered();
      } catch (err) {
        reportRenderError(err);
        return;
      }
      const path = await saveSharePng(rendered.blob, fileName);
      if (path) showToast(s.saved, 'success');
    } catch (err) {
      showToast(formatAppError(err, t), 'error');
    } finally {
      setBusy(null);
    }
  };

  const copy = async () => {
    setMenuOpen(false);
    setBusy('copy');
    // Started inside the click so the clipboard write keeps the gesture.
    const pending = getRendered();
    const copied = copySharePng(pending.then(r => r.blob));
    try {
      await pending;
    } catch (err) {
      reportRenderError(err);
      setBusy(null);
      return;
    }
    if (await copied) showToast(s.copied, 'success');
    else showToast(s.copy_unsupported, 'error');
    setBusy(null);
  };

  const openPreview = async () => {
    setMenuOpen(false);
    previewWantedRef.current = true;
    setPreviewOpen(true);
    setBusy('preview');
    try {
      const rendered = await getRendered();
      if (!previewWantedRef.current) return;
      setPreview({ url: URL.createObjectURL(rendered.blob), width: rendered.width, height: rendered.height });
    } catch (err) {
      setPreviewOpen(false);
      reportRenderError(err);
    } finally {
      setBusy(null);
    }
  };

  const closePreview = () => {
    previewWantedRef.current = false;
    setPreviewOpen(false);
    setPreview(null);
  };

  const working = busy !== null;
  const triggerLabel = label ?? s.button_label;

  return (
    <div className={`share-image${className ? ` ${className}` : ''}`} ref={wrapRef}>
      <button
        type="button"
        className={`share-image-trigger${label ? '' : ' share-image-trigger--icon'}`}
        onClick={toggleMenu}
        disabled={disabled || working}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-controls={menuOpen ? menuId : undefined}
        aria-busy={working}
        aria-label={label ? undefined : triggerLabel}
        title={working ? s.rendering : triggerLabel}
      >
        {working
          ? <LoaderCircle size={16} className="share-image-spin" aria-hidden="true" />
          : <ImageDown size={16} aria-hidden="true" />}
        {label && <span>{label}</span>}
      </button>

      {menuOpen && (
        <div className="share-image-menu" id={menuId} role="menu" aria-label={s.menu_label}>
          <button type="button" role="menuitem" className="share-image-menu-item" onClick={save}>
            <Download size={15} aria-hidden="true" />
            <span>{s.save}</span>
          </button>
          <button type="button" role="menuitem" className="share-image-menu-item" onClick={copy}>
            <Copy size={15} aria-hidden="true" />
            <span>{s.copy}</span>
          </button>
          <button type="button" role="menuitem" className="share-image-menu-item" onClick={openPreview}>
            <Eye size={15} aria-hidden="true" />
            <span>{s.preview}</span>
          </button>
        </div>
      )}

      <ModalShell
        open={previewOpen}
        onClose={closePreview}
        label={s.preview_title}
        overlayClassName="share-image-overlay"
        panelClassName="share-image-panel"
      >
        <header className="share-image-panel-header">
          <h2 className="share-image-panel-title">{s.preview_title}</h2>
          <button type="button" className="share-image-close" onClick={closePreview} aria-label={s.close}>
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        <div className="share-image-preview" aria-busy={!preview}>
          {preview
            ? <img src={preview.url} alt={s.preview_alt} />
            : (
              <div className="share-image-preview-loading" role="status">
                <LoaderCircle size={22} className="share-image-spin" aria-hidden="true" />
                <span>{s.rendering}</span>
              </div>
            )}
        </div>
        <footer className="share-image-panel-footer">
          <span className="share-image-dimensions">
            {preview ? interpolateTranslation(s.dimensions, { width: preview.width, height: preview.height }) : ''}
          </span>
          <div className="share-image-actions">
            <button type="button" className="share-image-action" onClick={copy} disabled={!preview || working}>
              <Copy size={15} aria-hidden="true" />
              <span>{s.copy}</span>
            </button>
            <button type="button" className="share-image-action share-image-action--primary" onClick={save} disabled={!preview || working}>
              <Download size={15} aria-hidden="true" />
              <span>{s.save}</span>
            </button>
          </div>
        </footer>
      </ModalShell>
    </div>
  );
}
