import { useLayoutEffect, useRef } from 'react';

// One rendered PDF page for ReaderModal: pdfjs renders into an offscreen
// canvas once (cached per page number in the maps the modal owns) and the
// visible canvas just blits it, so page turns never wait on pdfjs.

export interface PdfRenderItem {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  aspectRatio: string;
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

export function getOrQueuePdfRender(
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

export function PdfCanvasPage({
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
