// Loads Ambient mode's slides: the library and its catalog rows, the ranking
// (ambient-slides.ts), then wallpapers resolved in batches down that ranking
// (src-tauri/src/wallpapers.rs). Only runs once the screensaver starts.
import { getAllLibraryEntries } from '../tauri/library';
import { getCatalogEntriesForLibrary } from '../tauri/catalog';
import { resolveWallpapers } from '../tauri/wallpapers';
import { wrapAssetUrl } from '../tauri/bridge';
import { collectAmbientSlides, rankAmbientWorks, type AmbientSlide, type Rng } from './ambient-slides';

export async function loadAmbientSlides(rng: Rng = Math.random): Promise<AmbientSlide[]> {
  const [entries, catalog] = await Promise.all([getAllLibraryEntries(), getCatalogEntriesForLibrary()]);
  const ranked = rankAmbientWorks(entries, new Map(catalog.map(row => [row.external_id, row])), rng);
  const slides = await collectAmbientSlides(ranked, resolveWallpapers, { rng });
  return slides.map(slide => ({ ...slide, wallpaper: { ...slide.wallpaper, url: wrapAssetUrl(slide.wallpaper.url) } }));
}
