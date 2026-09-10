import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { getCurrentWindow } from '@tauri-apps/api/window';
import * as pdfjsLib from 'pdfjs-dist';
import {
  extractComicArchive,
  readComicBinaryFile,
  getReadingProgress,
  saveReadingProgress,
  getComicBookmarks,
  toggleComicBookmark,
  saveComicPageAsPng,
  wrapAssetUrl,
  updateDiscordPresence,
  resetDiscordPresence,
  type LibraryEntry,
} from '../../lib/tauri';
import { markChapterRead } from '../../lib/local/reading-service';

if (typeof window !== 'undefined' && pdfjsLib.GlobalWorkerOptions) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
}
import { useClosingTransition } from '../../lib/shared/useClosingTransition';
import { toSmallCover } from '../../lib/shared/small-cover';
import { IconX } from './ui/icons';

interface Props {
  externalId:    string;
  title:         string;
  filePath:      string;
  episodeNumber: number;
  totalCount:    number | null;
  libraryEntry:  LibraryEntry;
  cover:         string | null;
  isSingleTomo:  boolean;
  onClose:       () => void;
  onStandBy?:    (spreadIndex: number, totalSpreads: number, pageCount: number) => void;
  onProgressSaved: () => void;
}

type LoadState = 'loading' | 'ready' | 'error';

interface PdfRenderItem {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  aspectRatio: string;
}

function buildSpreads(pageCount: number): number[][] {
  if (pageCount === 0) return [];
  const spreads: number[][] = [[0]];
  for (let i = 1; i < pageCount; i += 2) {
    spreads.push(i + 1 < pageCount ? [i, i + 1] : [i]);
  }
  return spreads;
}

async function renderPdfPage(pdfDoc: any, pageNumber: number): Promise<PdfRenderItem> {
  const page = await pdfDoc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 2.0 });
  const offscreen = document.createElement('canvas');
  offscreen.width = viewport.width;
  offscreen.height = viewport.height;
  const ctx = offscreen.getContext('2d');
  if (ctx) {
    await page.render({ canvasContext: ctx, viewport }).promise;
  }
  return {
    canvas: offscreen,
    width: viewport.width,
    height: viewport.height,
    aspectRatio: `${viewport.width} / ${viewport.height}`,
  };
}

function getOrQueuePdfRender(
  pdfDoc: any,
  pageNumber: number,
  inFlightMap: Map<number, Promise<PdfRenderItem>>,
  resolvedMap: Map<number, PdfRenderItem>,
): Promise<PdfRenderItem> {
  const existing = resolvedMap.get(pageNumber);
  if (existing) return Promise.resolve(existing);

  const pending = inFlightMap.get(pageNumber);
  if (pending) return pending;

  const promise = renderPdfPage(pdfDoc, pageNumber).then(item => {
    resolvedMap.set(pageNumber, item);
    inFlightMap.delete(pageNumber);
    return item;
  }).catch(err => {
    inFlightMap.delete(pageNumber);
    throw err;
  });

  inFlightMap.set(pageNumber, promise);
  return promise;
}

function PdfCanvasPage({
  pdfDoc,
  pageNumber,
  inFlightMap,
  resolvedMap,
  onContextMenu,
}: {
  pdfDoc: any;
  pageNumber: number;
  inFlightMap: Map<number, Promise<PdfRenderItem>>;
  resolvedMap: Map<number, PdfRenderItem>;
  onContextMenu: (e: React.MouseEvent, canvas: HTMLCanvasElement) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;
    let cancelled = false;
    const canvas = canvasRef.current;

    const cached = resolvedMap.get(pageNumber);
    if (cached) {
      canvas.width = cached.width;
      canvas.height = cached.height;
      canvas.style.aspectRatio = cached.aspectRatio;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(cached.canvas, 0, 0);
      return;
    }

    getOrQueuePdfRender(pdfDoc, pageNumber, inFlightMap, resolvedMap).then(item => {
      if (cancelled || !canvasRef.current) return;
      const c = canvasRef.current;
      c.width = item.width;
      c.height = item.height;
      c.style.aspectRatio = item.aspectRatio;
      const ctx = c.getContext('2d');
      ctx?.drawImage(item.canvas, 0, 0);
    }).catch(err => {
      if (err?.name !== 'RenderingCancelledException') {
        console.error('Error rendering PDF page', err);
      }
    });

    return () => { cancelled = true; };
  }, [pdfDoc, pageNumber, inFlightMap, resolvedMap]);

  return (
    <canvas
      ref={canvasRef}
      className="comic-reader-page"
      onContextMenu={e => {
        if (canvasRef.current) onContextMenu(e, canvasRef.current);
      }}
    />
  );
}

export function ReaderModal({
  externalId,
  title,
  filePath,
  episodeNumber,
  totalCount,
  libraryEntry,
  isSingleTomo,
  cover,
  onClose,
  onStandBy,
  onProgressSaved,
}: Props) {
  const { isClosing, close: handleClose } = useClosingTransition(onClose);

  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [pages, setPages] = useState<string[]>([]);
  const [spreadIndex, setSpreadIndex] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [bookmarks, setBookmarks] = useState<number[]>([]);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimeoutRef = useRef<number | null>(null);

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    pageNumber: number;
    pagePath: string;
  } | null>(null);

  const showToast = (msg: string) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToastMsg(msg);
    toastTimeoutRef.current = window.setTimeout(() => setToastMsg(null), 2500);
  };

  const toggleFullscreen = async () => {
    try {
      const appWindow = getCurrentWindow();
      const current = await appWindow.isFullscreen();
      await appWindow.setFullscreen(!current);
      setIsFullscreen(!current);
    } catch {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
      } else {
        document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
      }
    }
  };

  useEffect(() => {
    const appWindow = getCurrentWindow();
    appWindow.isFullscreen().then(setIsFullscreen).catch(() => {});
  }, []);

  useEffect(() => {
    document.documentElement.classList.add('comic-reader-active');
    return () => {
      document.documentElement.classList.remove('comic-reader-active');
    };
  }, []);

  const markedRef = useRef(false);
  const resumedRef = useRef(false);

  const spreads = useMemo(() => buildSpreads(pages.length), [pages.length]);
  const currentSpread = spreads[spreadIndex] ?? [];
  const pageLabel = currentSpread.length === 2
    ? `${currentSpread[0] + 1}-${currentSpread[1] + 1} / ${pages.length}`
    : `${(currentSpread[0] ?? 0) + 1} / ${pages.length}`;

  const isBookOrNovel = libraryEntry?.type === 'lnovel' || libraryEntry?.type === 'book';
  const isPdf = useMemo(() => filePath.toLowerCase().endsWith('.pdf'), [filePath]);
  const [pdfDoc, setPdfDoc] = useState<any | null>(null);
  const pdfDocRef = useRef<any | null>(null);

  const pdfInFlightRef = useRef<Map<number, Promise<PdfRenderItem>>>(new Map());
  const pdfResolvedRef = useRef<Map<number, PdfRenderItem>>(new Map());

  useEffect(() => {
    let cancelled = false;
    setLoadState('loading');
    setErrorMsg('');
    markedRef.current = false;
    resumedRef.current = false;
    pdfInFlightRef.current.clear();
    pdfResolvedRef.current.clear();

    if (isPdf) {
      (async () => {
        try {
          let bytes: Uint8Array | null = null;
          const assetUrl = wrapAssetUrl(filePath);
          if (assetUrl.startsWith('http') || assetUrl.startsWith('asset:')) {
            try {
              const res = await fetch(assetUrl);
              if (res.ok) {
                const ab = await res.arrayBuffer();
                bytes = new Uint8Array(ab);
              }
            } catch {}
          }
          if (!bytes || bytes.length === 0) {
            bytes = await readComicBinaryFile(filePath);
          }
          if (cancelled) return;

          const loadingTask = pdfjsLib.getDocument({ data: bytes });
          const doc = await loadingTask.promise;
          if (cancelled) {
            try { doc.destroy(); } catch {}
            return;
          }
          if (!doc.numPages) {
            setErrorMsg('El archivo PDF no contiene páginas.');
            setLoadState('error');
            return;
          }
          pdfDocRef.current = doc;
          setPdfDoc(doc);
          const pageArr = Array.from({ length: doc.numPages }, (_, i) => `pdf-page-${i + 1}`);
          setPages(pageArr);

          const progress = await getReadingProgress(externalId, episodeNumber).catch(() => null);
          if (cancelled) return;
          const savedSpreads = buildSpreads(doc.numPages);
          const savedPage0 = progress ? Math.min(Math.max(progress.pageNumber - 1, 0), doc.numPages - 1) : 0;
          const resumeSpread = Math.max(0, savedSpreads.findIndex(s => s.includes(savedPage0)));
          resumedRef.current = true;
          setSpreadIndex(resumeSpread);
          setLoadState('ready');

          getComicBookmarks(externalId, episodeNumber)
            .then(bm => { if (!cancelled) setBookmarks(bm); })
            .catch(() => {});
        } catch (err) {
          if (cancelled) return;
          setErrorMsg(err instanceof Error ? err.message : String(err));
          setLoadState('error');
        }
      })();

      return () => {
        cancelled = true;
        if (pdfDocRef.current) {
          try { pdfDocRef.current.destroy(); } catch {}
        }
      };
    }

    extractComicArchive(filePath)
      .then(async res => {
        if (cancelled) return;
        if (!res.pages.length) {
          setErrorMsg('No se encontraron páginas en el archivo.');
          setLoadState('error');
          return;
        }
        setPages(res.pages);

        const progress = await getReadingProgress(externalId, episodeNumber).catch(() => null);
        if (cancelled) return;
        const savedSpreads = buildSpreads(res.pages.length);
        const savedPage0 = progress ? Math.min(Math.max(progress.pageNumber - 1, 0), res.pages.length - 1) : 0;
        const resumeSpread = Math.max(0, savedSpreads.findIndex(s => s.includes(savedPage0)));
        resumedRef.current = true;
        setSpreadIndex(resumeSpread);
        setLoadState('ready');

        getComicBookmarks(externalId, episodeNumber)
          .then(bm => { if (!cancelled) setBookmarks(bm); })
          .catch(() => {});
      })
      .catch(err => {
        if (cancelled) return;
        setErrorMsg(err instanceof Error ? err.message : String(err));
        setLoadState('error');
      });

    return () => { cancelled = true; };
  }, [filePath, externalId, episodeNumber, isPdf]);

  useEffect(() => {
    if (loadState !== 'ready' || !resumedRef.current || currentSpread.length === 0) return;
    saveReadingProgress(externalId, episodeNumber, currentSpread[0] + 1, pages.length).catch(() => {});

    if (currentSpread.includes(pages.length - 1) && !markedRef.current) {
      markedRef.current = true;
      const finishNumber = isSingleTomo && totalCount ? totalCount : episodeNumber;
      markChapterRead(externalId, libraryEntry, finishNumber, totalCount, episodeNumber)
        .then(onProgressSaved)
        .catch(err => console.error('Failed to mark chapter read', err));
    }
  }, [spreadIndex, loadState, pages.length]);

  const goPrev = useCallback(() => setSpreadIndex(i => Math.max(0, i - 1)), []);
  const goNext = useCallback(() => setSpreadIndex(i => Math.min(spreads.length - 1, i + 1)), [spreads.length]);

  const jumpToPage = useCallback((pageNum: number) => {
    const sIdx = spreads.findIndex(s => s.includes(pageNum - 1));
    if (sIdx !== -1) setSpreadIndex(sIdx);
  }, [spreads]);

  // Pre-calculate adjacent PDF pages in advance to eliminate page-turn latency
  useEffect(() => {
    if (!pdfDoc || loadState !== 'ready') return;
    const targetSpreads = [
      spreads[spreadIndex],
      spreads[spreadIndex + 1],
      spreads[spreadIndex + 2],
      spreads[spreadIndex + 3],
      spreads[spreadIndex - 1],
    ];

    for (const spread of targetSpreads) {
      if (!spread) continue;
      for (const pIdx of spread) {
        const pageNum = pIdx + 1;
        if (pageNum >= 1 && pageNum <= pdfDoc.numPages) {
          getOrQueuePdfRender(pdfDoc, pageNum, pdfInFlightRef.current, pdfResolvedRef.current);
        }
      }
    }

    const keepPageNumbers = new Set<number>();
    for (let si = spreadIndex - 4; si <= spreadIndex + 8; si++) {
      const sp = spreads[si];
      if (sp) sp.forEach(p => keepPageNumbers.add(p + 1));
    }

    for (const key of pdfResolvedRef.current.keys()) {
      if (!keepPageNumbers.has(key)) {
        pdfResolvedRef.current.delete(key);
      }
    }
  }, [spreadIndex, pdfDoc, loadState, spreads]);

  // Pre-calculate and pre-decode nearby image files for instant page transitions
  const preloadedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (loadState !== 'ready' || isPdf) return;
    const targetSpreads = [
      spreads[spreadIndex],
      spreads[spreadIndex + 1],
      spreads[spreadIndex + 2],
      spreads[spreadIndex + 3],
      spreads[spreadIndex - 1],
    ];
    for (const spread of targetSpreads) {
      if (!spread) continue;
      for (const pageIdx of spread) {
        const url = wrapAssetUrl(pages[pageIdx]);
        if (preloadedRef.current.has(url)) continue;
        preloadedRef.current.add(url);
        const img = new Image();
        img.src = url;
        if (img.decode) {
          img.decode().catch(() => {});
        }
      }
    }
  }, [spreadIndex, loadState, spreads, pages, isPdf]);

  useEffect(() => {
    if (loadState !== 'ready') return;
    const coverUrl = cover && cover.startsWith('http') ? toSmallCover(cover) : undefined;
    const timer = setTimeout(() => {
      updateDiscordPresence(`Reading ${title}`, `Page ${pageLabel}`, undefined, undefined, coverUrl, title, 'metadea', 'Metadea').catch(() => {});
    }, 800);
    return () => clearTimeout(timer);
  }, [loadState, pageLabel, title, cover]);

  useEffect(() => {
    return () => { resetDiscordPresence().catch(() => {}); };
  }, []);

  const handleStandBy = () => {
    onStandBy?.(spreadIndex, spreads.length, pages.length);
    handleClose();
  };

  const handleToggleBookmark = async (pageNum: number) => {
    try {
      const added = await toggleComicBookmark(externalId, episodeNumber, pageNum);
      setBookmarks(prev => added ? [...prev, pageNum].sort((a, b) => a - b) : prev.filter(p => p !== pageNum));
      showToast(added ? `Marcador añadido en pág. ${pageNum}` : `Marcador quitado de pág. ${pageNum}`);
    } catch {
      showToast('Error al modificar marcador');
    }
  };

  const handleSavePage = async (pagePath: string, pageNum: number) => {
    try {
      showToast(`Guardando página ${pageNum}...`);
      await saveComicPageAsPng(pagePath, title, pageNum);
      showToast(`Página ${pageNum} guardada como PNG en Imágenes`);
    } catch {
      showToast('Error al guardar la página');
    }
  };

  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (contextMenu) {
          setContextMenu(null);
          return;
        }
        try {
          const appWindow = getCurrentWindow();
          if (await appWindow.isFullscreen()) {
            await appWindow.setFullscreen(false);
            setIsFullscreen(false);
            return;
          }
        } catch {}
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
          return;
        }
        handleClose();
        return;
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') { e.preventDefault(); goNext(); return; }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); goPrev(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goNext, goPrev, handleClose, contextMenu]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [contextMenu]);

  const handleImageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (contextMenu) {
      setContextMenu(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    if (clickX < rect.width * 0.45) goPrev();
    else if (clickX > rect.width * 0.55) goNext();
  };

  return createPortal(
    <div className={`comic-reader-overlay${isClosing ? ' comic-reader-overlay--closing' : ''}${isFullscreen ? ' comic-reader-overlay--fullscreen' : ''}`}>
      <div className="comic-reader-header">
        <span className="comic-reader-title" title={title}>{title}</span>
        {loadState === 'ready' && (
          <span className="comic-reader-page-count">{pageLabel}</span>
        )}
        {onStandBy && (
          <button type="button" className="comic-reader-header-btn" onClick={handleStandBy} title="Dejar en pausa (volver a la app)" aria-label="Stand by">
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
              <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
            </svg>
          </button>
        )}
        <button
          type="button"
          className="comic-reader-header-btn"
          onClick={toggleFullscreen}
          title={isFullscreen ? 'Salir de pantalla completa (Esc)' : 'Pantalla completa'}
          aria-label={isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
        >
          {isFullscreen ? (
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3"/>
            </svg>
          ) : (
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>
            </svg>
          )}
        </button>
        <button type="button" className="comic-reader-close" onClick={handleClose} title="Cerrar (Esc)">
          <IconX />
        </button>
      </div>

      {isFullscreen && (
        <button
          type="button"
          className="comic-reader-fullscreen-exit"
          onClick={toggleFullscreen}
          title="Salir de pantalla completa (Esc)"
          aria-label="Salir de pantalla completa"
        >
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3"/>
          </svg>
        </button>
      )}

      <div className="comic-reader-body">
        {loadState === 'loading' && (
          <div className="comic-reader-state">
            <div className="spinner" />
            <p>{isPdf ? 'Cargando documento…' : 'Extrayendo páginas…'}</p>
          </div>
        )}

        {loadState === 'error' && (
          <div className="comic-reader-state comic-reader-state--error">
            <p>No se pudo abrir el archivo.</p>
            <p className="comic-reader-error-detail">{errorMsg}</p>
          </div>
        )}

        {loadState === 'ready' && (
          <div className="comic-reader-page-wrap" onClick={handleImageClick}>
            <div className={`comic-reader-spread${currentSpread.length === 2 ? ' comic-reader-spread--double' : ''}`}>
              {currentSpread.map(idx => (
                isPdf && pdfDoc ? (
                  <PdfCanvasPage
                    key={idx}
                    pdfDoc={pdfDoc}
                    pageNumber={idx + 1}
                    inFlightMap={pdfInFlightRef.current}
                    resolvedMap={pdfResolvedRef.current}
                    onContextMenu={(e, canvas) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const dataUrl = canvas.toDataURL('image/png');
                      setContextMenu({
                        x: Math.min(e.clientX, window.innerWidth - 220),
                        y: Math.min(e.clientY, window.innerHeight - 200),
                        pageNumber: idx + 1,
                        pagePath: dataUrl,
                      });
                    }}
                  />
                ) : (
                  <img
                    key={idx}
                    className="comic-reader-page"
                    src={wrapAssetUrl(pages[idx])}
                    alt={`Página ${idx + 1}`}
                    draggable={false}
                    decoding="sync"
                    loading="eager"
                    onContextMenu={e => {
                      e.preventDefault();
                      e.stopPropagation();
                      setContextMenu({
                        x: Math.min(e.clientX, window.innerWidth - 220),
                        y: Math.min(e.clientY, window.innerHeight - 200),
                        pageNumber: idx + 1,
                        pagePath: pages[idx],
                      });
                    }}
                  />
                )
              ))}
            </div>
            <button
              type="button"
              className="comic-reader-nav comic-reader-nav--prev"
              onClick={e => { e.stopPropagation(); goPrev(); }}
              disabled={spreadIndex === 0}
              aria-label="Página anterior"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <button
              type="button"
              className="comic-reader-nav comic-reader-nav--next"
              onClick={e => { e.stopPropagation(); goNext(); }}
              disabled={spreadIndex === spreads.length - 1}
              aria-label="Página siguiente"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
        )}
      </div>

      {loadState === 'ready' && spreads.length > 1 && (
        <div className="comic-reader-progress-bar">
          <div className="comic-reader-progress-fill" style={{ width: `${(((currentSpread[currentSpread.length - 1] ?? 0) + 1) / pages.length) * 100}%` }} />
        </div>
      )}

      {contextMenu && (
        <div
          className="comic-context-menu"
          style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
          onClick={e => e.stopPropagation()}
        >
          <div className="comic-context-menu-title">Página {contextMenu.pageNumber}</div>
          <button
            type="button"
            className="comic-context-menu-item"
            onClick={() => {
              handleToggleBookmark(contextMenu.pageNumber);
              setContextMenu(null);
            }}
          >
            <svg width={14} height={14} viewBox="0 0 24 24" fill={bookmarks.includes(contextMenu.pageNumber) ? 'var(--accent)' : 'none'} stroke="currentColor" strokeWidth={2}>
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
            </svg>
            {bookmarks.includes(contextMenu.pageNumber) ? 'Quitar marcador' : 'Añadir marcador'}
          </button>
          <button
            type="button"
            className="comic-context-menu-item"
            onClick={() => {
              handleSavePage(contextMenu.pagePath, contextMenu.pageNumber);
              setContextMenu(null);
            }}
          >
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Guardar página (PNG)
          </button>

          {bookmarks.length > 0 && (
            <>
              <div className="comic-context-menu-divider" />
              <div className="comic-context-menu-title">Marcadores ({bookmarks.length})</div>
              <div className="comic-context-bookmarks-list">
                {bookmarks.map(p => (
                  <button
                    key={p}
                    type="button"
                    className="comic-context-menu-item"
                    onClick={() => {
                      jumpToPage(p);
                      setContextMenu(null);
                    }}
                  >
                    <svg width={12} height={12} viewBox="0 0 24 24" fill="currentColor">
                      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
                    </svg>
                    Página {p}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {toastMsg && (
        <div className="comic-reader-toast">
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span>{toastMsg}</span>
        </div>
      )}
    </div>,
    document.body,
  );
}

export const ComicReaderModal = ReaderModal;
