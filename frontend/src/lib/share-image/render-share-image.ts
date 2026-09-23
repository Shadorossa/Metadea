// One call from input to PNG: layout → load images/palette/fonts → draw →
// encode. The component (components/shared/ShareImageButton.tsx) only adds
// UI around this.
import { drawShareImage } from './share-draw';
import { createShareImageLoader, loadShareImageAssets } from './share-assets';
import { layoutBingoImage, layoutTierListImage } from './share-layout';
import { exportCanvasToPng } from './share-output';
import type { ShareImageInput, ShareImageStrings, ShareLayout, ShareLayoutOptions } from './share-image-types';

export function layoutShareImage(input: ShareImageInput, strings: ShareImageStrings, overrides: Partial<Omit<ShareLayoutOptions, 'owner' | 'strings'>> = {}): ShareLayout {
  const opts: ShareLayoutOptions = { ...overrides, owner: input.owner, strings };
  return input.kind === 'tierList' ? layoutTierListImage(input.data, opts) : layoutBingoImage(input.data, opts);
}

export interface RenderedShareImage {
  canvas: HTMLCanvasElement;
  blob: Blob;
  width: number;
  height: number;
}

export async function renderShareImage(input: ShareImageInput, strings: ShareImageStrings): Promise<RenderedShareImage> {
  const layout = layoutShareImage(input, strings);
  // A fresh loader per export: its cache lives exactly as long as this call.
  const assets = await loadShareImageAssets(layout, createShareImageLoader());
  const canvas = document.createElement('canvas');
  drawShareImage(canvas, layout, assets);
  const blob = await exportCanvasToPng(canvas);
  return { canvas, blob, width: canvas.width, height: canvas.height };
}
