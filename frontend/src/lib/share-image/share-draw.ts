// Paints a ShareLayout onto a canvas. No geometry decisions here beyond
// fitting text into its box: positions and sizes all come from
// share-layout.ts. Images arrive pre-loaded in `assets.images`; a missing
// one becomes a placeholder tile carrying the title.
import type {
  ShareBox,
  ShareElement,
  ShareImageAssets,
  ShareImageElement,
  SharePaint,
  ShareLayout,
  ShareTextElement,
} from './share-image-types';

type Ctx = CanvasRenderingContext2D;

function paint(p: SharePaint, assets: ShareImageAssets): string {
  return 'role' in p ? assets.palette[p.role] : p.color;
}

function roundedPath(ctx: Ctx, box: ShareBox, radius = 0) {
  const r = Math.max(0, Math.min(radius, box.width / 2, box.height / 2));
  const { x, y, width: w, height: h } = box;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function shapePath(ctx: Ctx, el: ShareImageElement) {
  if (el.shape === 'circle') {
    const { x, y, width, height } = el.box;
    ctx.beginPath();
    ctx.arc(x + width / 2, y + height / 2, Math.min(width, height) / 2, 0, Math.PI * 2);
    ctx.closePath();
  } else {
    roundedPath(ctx, el.box, el.radius);
  }
}

/** Greedy word wrap into at most `maxLines`; the last line gets an ellipsis
 *  when text is left over. Words wider than the box are cut. */
export function wrapText(text: string, maxWidth: number, lineLimit: number, measure: (s: string) => number): string[] {
  const maxLines = Math.max(1, Math.floor(lineLimit));
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (measure(candidate) <= maxWidth || !current) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
    if (lines.length === maxLines) break;
  }
  const overflow = lines.length === maxLines;
  if (!overflow && current) lines.push(current);
  return lines.map((line, i) => {
    const last = i === lines.length - 1;
    const needsEllipsis = last && overflow;
    if (!needsEllipsis && measure(line) <= maxWidth) return line;
    let cut = line;
    while (cut.length > 1 && measure(`${cut}…`) > maxWidth) cut = cut.slice(0, -1);
    return `${cut.trimEnd()}…`;
  });
}

function fontString(el: Pick<ShareTextElement, 'weight' | 'size' | 'font'>, assets: ShareImageAssets): string {
  return `${el.weight} ${el.size}px ${assets.fonts[el.font]}`;
}

function drawText(ctx: Ctx, el: ShareTextElement, assets: ShareImageAssets) {
  if (!el.text) return;
  ctx.font = fontString(el, assets);
  ctx.fillStyle = paint(el.color, assets);
  ctx.textAlign = el.align;
  ctx.textBaseline = 'middle';
  const lines = wrapText(el.text, el.box.width, el.maxLines, s => ctx.measureText(s).width);
  const lineHeight = el.size * 1.2;
  const blockH = lines.length * lineHeight;
  const top =
    el.valign === 'top' ? el.box.y : el.valign === 'bottom' ? el.box.y + el.box.height - blockH : el.box.y + (el.box.height - blockH) / 2;
  const x = el.align === 'left' ? el.box.x : el.align === 'right' ? el.box.x + el.box.width : el.box.x + el.box.width / 2;
  lines.forEach((line, i) => ctx.fillText(line, x, top + lineHeight * (i + 0.5)));
}

function imageSize(image: CanvasImageSource): { width: number; height: number } {
  const source = image as { naturalWidth?: number; naturalHeight?: number; width?: number | SVGAnimatedLength; height?: number | SVGAnimatedLength };
  const width = source.naturalWidth || (typeof source.width === 'number' ? source.width : 0);
  const height = source.naturalHeight || (typeof source.height === 'number' ? source.height : 0);
  return { width, height };
}

function drawPlaceholder(ctx: Ctx, el: ShareImageElement, assets: ShareImageAssets) {
  ctx.fillStyle = assets.palette.surface;
  shapePath(ctx, el);
  ctx.fill();
  const circle = el.shape === 'circle';
  const size = circle ? Math.round(el.box.height * 0.45) : Math.max(12, Math.round(el.box.width * 0.11));
  const inset = circle ? 0 : el.box.width * 0.08;
  drawText(ctx, {
    kind: 'text',
    box: { x: el.box.x + inset, y: el.box.y + inset, width: el.box.width - inset * 2, height: el.box.height - inset * 2 },
    text: el.fallbackText,
    size,
    weight: circle ? 700 : 600,
    font: circle ? 'display' : 'body',
    color: { role: circle ? 'accent' : 'text' },
    align: 'center',
    valign: 'middle',
    maxLines: circle ? 1 : Math.max(1, Math.floor((el.box.height - inset * 2) / (size * 1.2))),
  }, assets);
}

function drawImage(ctx: Ctx, el: ShareImageElement, assets: ShareImageAssets) {
  const image = el.src ? assets.images.get(el.src) ?? null : null;
  const natural = image ? imageSize(image) : { width: 0, height: 0 };
  if (!image || natural.width <= 0 || natural.height <= 0) {
    drawPlaceholder(ctx, el, assets);
    return;
  }
  // object-fit: cover, centred crop.
  const { box } = el;
  const scale = Math.max(box.width / natural.width, box.height / natural.height);
  const sw = box.width / scale;
  const sh = box.height / scale;
  ctx.save();
  shapePath(ctx, el);
  ctx.clip();
  ctx.fillStyle = assets.palette.surface;
  ctx.fillRect(box.x, box.y, box.width, box.height);
  ctx.drawImage(image, (natural.width - sw) / 2, (natural.height - sh) / 2, sw, sh, box.x, box.y, box.width, box.height);
  ctx.restore();
}

function drawCheck(ctx: Ctx, box: ShareBox, fill: string, mark: string) {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const r = Math.min(box.width, box.height) / 2;
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
  ctx.shadowBlur = r * 0.5;
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = mark;
  ctx.lineWidth = Math.max(2, r * 0.22);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.45, cy + r * 0.02);
  ctx.lineTo(cx - r * 0.12, cy + r * 0.34);
  ctx.lineTo(cx + r * 0.46, cy - r * 0.3);
  ctx.stroke();
  ctx.restore();
}

// The hexagon + serif "M" of public/metadea-logo.png, in the theme accent —
// used when the bundled PNG could not be loaded.
function drawVectorLogo(ctx: Ctx, box: ShareBox, assets: ShareImageAssets) {
  const size = Math.min(box.width, box.height);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const lineWidth = Math.max(1.5, size * 0.07);
  const r = (size - lineWidth) / 2;
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 2;
    const px = cx + r * Math.cos(angle);
    const py = cy + r * Math.sin(angle);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = '#0d0b14';
  ctx.fill();
  ctx.strokeStyle = assets.palette.accent;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
  ctx.fillStyle = assets.palette.accent;
  ctx.font = `700 ${Math.round(size * 0.5)}px Georgia, "Times New Roman", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('M', cx, cy + size * 0.02);
  ctx.restore();
}

function drawElement(ctx: Ctx, el: ShareElement, assets: ShareImageAssets) {
  switch (el.kind) {
    case 'rect': {
      ctx.save();
      if (el.alpha !== undefined) ctx.globalAlpha = el.alpha;
      roundedPath(ctx, el.box, el.radius);
      if (el.fill) {
        ctx.fillStyle = paint(el.fill, assets);
        ctx.fill();
      }
      if (el.stroke) {
        ctx.strokeStyle = paint(el.stroke, assets);
        ctx.lineWidth = el.strokeWidth ?? 1;
        ctx.stroke();
      }
      ctx.restore();
      return;
    }
    case 'image':
      drawImage(ctx, el, assets);
      return;
    case 'text':
      drawText(ctx, el, assets);
      return;
    case 'check':
      drawCheck(ctx, el.box, paint(el.fill, assets), paint(el.mark, assets));
      return;
    case 'logo':
      if (assets.logo) ctx.drawImage(assets.logo, el.box.x, el.box.y, el.box.width, el.box.height);
      else drawVectorLogo(ctx, el.box, assets);
      return;
  }
}

/** Sizes `canvas` to the layout (times its scale) and paints it. */
export function drawShareImage(canvas: HTMLCanvasElement, layout: ShareLayout, assets: ShareImageAssets): void {
  canvas.width = Math.round(layout.width * layout.scale);
  canvas.height = Math.round(layout.height * layout.scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.setTransform(layout.scale, 0, 0, layout.scale, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  for (const el of layout.elements) drawElement(ctx, el, assets);
}
