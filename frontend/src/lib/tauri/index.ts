// Barrel: re-exports every Tauri-backed domain module under the same public
// surface the old monolithic `lib/tauri.ts` exposed, so existing imports
// (`from '../tauri'`, `from '../../lib/tauri'`, ...) keep working unchanged.
// Domain logic itself lives in the sibling files — see each one for its slice
// (auth, library, catalog, lists, tier lists, IGDB, Steam, Discord, ...).

export * from './core';
export { wrapAssetUrl } from './core';
export * from './auth';
export * from './database';
export * from './local-library';
export * from './routes';
export * from './env';
export * from './library';
export * from './favorites';
export * from './user-journey';
export * from './lists';
export * from './tier-lists';
export * from './catalog';
export * from './characters';
export * from './staff';
export * from './actors';
export * from './companies';
export * from './favorite-images';
export * from './igdb';
export * from './comicvine';
export * from './metadata';
export * from './debug';
export * from './anime-local';
export * from './steam';
export * from './discord';
export * from './sync-state';
