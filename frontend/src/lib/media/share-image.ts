// Renders a Letterboxd-style "just rated this" share image (avatar, cover,
// title, your rating) on an offscreen canvas — 1080x1920, Instagram
// Stories' own aspect ratio. There's no API for a desktop app to post
// directly to Instagram Stories (mobile-only, Business account, Meta app
// review), so this is as far as the app itself can go: generate the image,
// let the user save and share it themselves (see MediaEditorModal's
// "Compartir" button).
import { STAR_PATH } from './constants';
import { dbRatingToStars5, formatAverageScore, averageScoreSuffix, type RatingSystem } from './rating-utils';
import { fetchImageDataUrl } from '../tauri/share';
import { toLargeCover } from '../shared/small-cover';

export interface ShareImageOptions {
  title:        string;
  cover:        string | null;
  rating:       number; // 0-10 internal scale
  ratingSystem: RatingSystem;
}

const WIDTH = 1080;
const HEIGHT = 1920;

// public/favicon.svg is a leftover default Astro icon, never actually
// replaced with Metadea's own — the real app icon lives at
// src-tauri/icons/icon.png (used for the desktop build itself), copied here
// to public/metadea-logo.png so it's servable as a normal same-origin
// frontend asset (no CORS/Rust-fetch detour needed for it, unlike covers).
const LOGO_URL = '/metadea-logo.png';

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = src;
  });
}

// A remote https:// image loaded straight into an <img> and exported via
// canvas comes back blank unless its server sends CORS headers explicitly
// allowing it — AniList/TMDB/IGDB covers generally don't. Routing it
// through the Rust side (a plain server-side fetch, no browser CORS policy
// involved) and getting a data: URL back sidesteps that; a data: URL never
// taints a canvas. Already-local sources (data:, asset://) load as-is.
async function resolveImage(src: string): Promise<HTMLImageElement | null> {
  try {
    // Some AniList fields come back protocol-relative ("//s4.anilist.co/...").
    const normalized = src.startsWith('//') ? `https:${src}` : src;
    if (normalized.startsWith('http://') || normalized.startsWith('https://')) {
      const dataUrl = await fetchImageDataUrl(normalized);
      return await loadImage(dataUrl ?? normalized);
    }
    return await loadImage(normalized);
  } catch {
    return null;
  }
}

// Tries toLargeCover's upgraded URL first, falling back to the original
// stored one if that fails — needed specifically because AniList's
// "extraLarge" upgrade isn't guaranteed to be a real path for every entry
// (see toLargeCover's own comment). TMDB/IGDB/Open Library's own upgrades
// are verified-safe, but running them through the same fallback here too
// costs nothing on the success path.
async function resolveCoverImage(rawUrl: string): Promise<HTMLImageElement | null> {
  const upgraded = toLargeCover(rawUrl);
  if (upgraded !== rawUrl) {
    const large = await resolveImage(upgraded);
    if (large) return large;
  }
  return resolveImage(rawUrl);
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(test).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawStarPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number) {
  ctx.save();
  ctx.translate(cx - size / 2, cy - size / 2);
  ctx.scale(size / 24, size / 24);
  ctx.fill(new Path2D(STAR_PATH));
  ctx.restore();
}

// Fills each star to its exact fraction (a 3.5-star rating fills the 4th
// star half of the way), same idea as rating-utils.ts's own SVG version,
// just drawn on canvas instead of built as inline HTML.
function drawStars(ctx: CanvasRenderingContext2D, stars5: number, centerX: number, y: number, size: number, gap: number) {
  const totalWidth = 5 * size + 4 * gap;
  let x = centerX - totalWidth / 2 + size / 2;
  for (let i = 0; i < 5; i++) {
    const fill = Math.max(0, Math.min(1, stars5 - i));
    ctx.globalAlpha = 0.3;
    drawStarPath(ctx, x, y, size);
    ctx.globalAlpha = 1;
    if (fill > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x - size / 2, y - size, size * fill, size * 2);
      ctx.clip();
      drawStarPath(ctx, x, y, size);
      ctx.restore();
    }
    x += size + gap;
  }
}

// No circular clip/crop — the image keeps its own natural shape and aspect
// ratio (contain-fit within maxSize x maxSize), just standing on the
// pedestal line like a figure on a shelf, instead of being forced into a
// round frame that cuts pieces of it off.
function drawAvatarImage(ctx: CanvasRenderingContext2D, img: HTMLImageElement, cx: number, floorY: number, maxSize: number) {
  const ratio = img.width / img.height;
  let w = maxSize;
  let h = maxSize / ratio;
  if (h > maxSize) { h = maxSize; w = maxSize * ratio; }
  ctx.drawImage(img, cx - w / 2, floorY - h, w, h);
}

// Same "letter" fallback the navbar/settings avatar preview use when
// there's no image to show — keeps something in the avatar slot instead of
// it silently being blank whenever profile_avatar_cache hasn't been
// populated yet (only happens after visiting /profile at least once) or the
// cached image fails to load. Bottom-anchored on the pedestal line the same
// way the real avatar image is, for a consistent silhouette either way.
function drawAvatarFallback(ctx: CanvasRenderingContext2D, letter: string, cx: number, floorY: number, r: number, accent: string) {
  const cy = floorY - r;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.25;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#f5f5f5';
  ctx.font = `700 ${Math.round(r)}px Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter.toUpperCase(), cx, cy + 2);
  ctx.textBaseline = 'alphabetic';
  ctx.restore();
}

// The pedestal itself — the avatar's own "floor", flush against its bottom
// edge rather than floating below it with a gap.
function drawAvatarPedestal(ctx: CanvasRenderingContext2D, cx: number, floorY: number, halfWidth: number, color: string) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx - halfWidth, floorY);
  ctx.lineTo(cx + halfWidth, floorY);
  ctx.stroke();
  ctx.restore();
}

function drawLogo(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, size: number) {
  ctx.save();
  ctx.drawImage(img, x, y, size, size);
  ctx.restore();
}

// Reads the currently active theme's own colors (Settings' theme picker
// sets these as CSS custom properties on <html>) so the background matches
// whatever's actually selected instead of a fixed hardcoded gradient.
function readThemeColors() {
  const styles = getComputedStyle(document.documentElement);
  const get = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
  return {
    bgBase:     get('--bg-base', '#07070e'),
    bgPrimary:  get('--bg-primary', '#12111a'),
    bgElevated: get('--bg-elevated', '#1c1a24'),
    accent:     get('--accent', '#7c6af7'),
  };
}

export async function generateShareImage(opts: ShareImageOptions): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported');

  const theme = readThemeColors();
  const bg = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  bg.addColorStop(0, theme.bgElevated);
  bg.addColorStop(0.55, theme.bgPrimary);
  bg.addColorStop(1, theme.bgBase);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // A failed/CORS-blocked cover load just means no poster gets drawn — the
  // rest of the image (title + rating) still renders fine on its own.
  // Always the provider's biggest available version, not whatever size the
  // library itself displays it at (see toLargeCover's own comment) — a
  // share image is worth spending the extra resolution on.
  const cover = opts.cover ? await resolveCoverImage(opts.cover) : null;

  const posterW = 640;
  const posterH = Math.round(posterW * 1.42);
  const posterX = (WIDTH - posterW) / 2;
  const posterY = 250;

  if (cover) {
    ctx.save();
    ctx.filter = 'blur(60px) brightness(0.45)';
    const scale = Math.max(WIDTH / cover.width, HEIGHT / cover.height) * 1.15;
    const bw = cover.width * scale;
    const bh = cover.height * scale;
    ctx.drawImage(cover, (WIDTH - bw) / 2, (HEIGHT - bh) / 2, bw, bh);
    ctx.restore();
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }

  if (cover) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 60;
    ctx.shadowOffsetY = 20;
    const srcRatio = cover.width / cover.height;
    const dstRatio = posterW / posterH;
    let sx = 0, sy = 0, sw = cover.width, sh = cover.height;
    if (srcRatio > dstRatio) {
      sw = cover.height * dstRatio;
      sx = (cover.width - sw) / 2;
    } else {
      sh = cover.width / dstRatio;
      sy = (cover.height - sh) / 2;
    }
    ctx.drawImage(cover, sx, sy, sw, sh, posterX, posterY, posterW, posterH);
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 2;
    ctx.strokeRect(posterX, posterY, posterW, posterH);
  } else {
    ctx.fillStyle = theme.bgElevated;
    ctx.fillRect(posterX, posterY, posterW, posterH);
  }

  // Profile's own cached avatar — same key Navbar.astro reads to paint the
  // navbar avatar instantly, custom-uploaded or Google, already resolved.
  // Falls back to a letter-in-a-circle (same idea as the navbar/settings
  // preview's own fallback) whenever that cache is empty or the image
  // fails to load, so the avatar slot is never just silently blank. Sits
  // fully above the poster (not overlapping it).
  const avatarSrc = localStorage.getItem('profile_avatar_cache');
  const avatarR = 95;
  const avatarFloorY = posterY - 40;
  const avatar = avatarSrc ? await resolveImage(avatarSrc) : null;
  if (avatar) {
    drawAvatarImage(ctx, avatar, WIDTH / 2, avatarFloorY, avatarR * 2);
  } else {
    const username = localStorage.getItem('auth_username') || 'M';
    drawAvatarFallback(ctx, username[0] ?? 'M', WIDTH / 2, avatarFloorY, avatarR, theme.accent);
  }
  drawAvatarPedestal(ctx, WIDTH / 2, avatarFloorY, avatarR * 0.6, theme.accent);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#f5f5f5';
  ctx.font = '700 56px Georgia, serif';
  const titleY = posterY + posterH + 100;
  const lines = wrapText(ctx, opts.title, WIDTH - 160).slice(0, 2);
  lines.forEach((line, i) => ctx.fillText(line, WIDTH / 2, titleY + i * 68));
  const afterTitleY = titleY + lines.length * 68 + 40;

  if (opts.ratingSystem === '5-star') {
    // Smaller and more muted than the title/poster — a rating accent, not
    // the loudest thing on the image.
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = 0.9;
    drawStars(ctx, dbRatingToStars5(opts.rating), WIDTH / 2, afterTitleY, 44, 12);
    ctx.globalAlpha = 1;
  } else {
    ctx.font = '700 64px Georgia, serif';
    ctx.fillStyle = '#e8c468';
    const text = formatAverageScore(opts.rating, opts.ratingSystem) + averageScoreSuffix(opts.ratingSystem);
    ctx.fillText(text, WIDTH / 2, afterTitleY + 20);
  }

  // Bottom-anchored (fixed distance from HEIGHT, not stacked under the
  // rating) so the separator/logo row always land in the same place
  // regardless of how many title lines or which rating style is above them.
  const separatorY = HEIGHT - 340;
  const watermarkColor = 'rgba(255,255,255,0.6)';

  // "on" sits in the line's own middle, splitting it into two flanking
  // segments instead of one continuous rule straight through the word.
  ctx.font = '600 26px Georgia, serif';
  const onLabel = 'on';
  const onWidth = ctx.measureText(onLabel).width;
  const onGap = 18;
  const halfLine = 100;

  ctx.save();
  ctx.strokeStyle = theme.accent;
  ctx.globalAlpha = 0.4;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(WIDTH / 2 - halfLine, separatorY);
  ctx.lineTo(WIDTH / 2 - onWidth / 2 - onGap, separatorY);
  ctx.moveTo(WIDTH / 2 + onWidth / 2 + onGap, separatorY);
  ctx.lineTo(WIDTH / 2 + halfLine, separatorY);
  ctx.stroke();
  ctx.restore();

  ctx.textAlign = 'center';
  ctx.fillStyle = watermarkColor;
  ctx.fillText(onLabel, WIDTH / 2, separatorY + 9);

  const logoRowY = separatorY + 45;
  const logoSize = 34;
  const gap = 14;
  const label = 'METADEA';
  ctx.font = '700 34px Georgia, serif';
  const labelWidth = ctx.measureText(label).width;
  const totalWidth = logoSize + gap + labelWidth;
  const startX = WIDTH / 2 - totalWidth / 2;
  const logoImg = await loadImage(LOGO_URL).catch(() => null);
  if (logoImg) drawLogo(ctx, logoImg, startX, logoRowY - logoSize / 2, logoSize);
  ctx.textAlign = 'left';
  ctx.fillStyle = watermarkColor;
  ctx.fillText(label, startX + logoSize + gap, logoRowY + 11);

  return canvas.toDataURL('image/png');
}
