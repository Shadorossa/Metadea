// Barrel: re-exports every Tauri-backed domain module under the same public
// surface the old monolithic `lib/tauri.ts` exposed, so existing imports
// (`from '../tauri'`, `from '../../lib/tauri'`, ...) keep working unchanged.
// Domain logic itself lives in the sibling files — see each one for its slice
// (auth, library, catalog, lists, tier lists, IGDB, Steam, Discord, ...).

export * from './bridge';
export { wrapAssetUrl } from './bridge';
export * from './auth';
export * from './database';
export * from './local-library';
export * from './env';
export * from './library';
export * from './favorites';
export * from './user-journey';
export * from './lists';
export * from './tier-lists';
export * from './catalog';
export * from './characters';
export * from './actors';
export * from './favorite-images';
export * from './igdb';
export * from './comicvine';
export * from './metadata';
export * from './game-launch';
export * from './anime-local';
export * from './steam';
export * from './companies';
export * from './discord-presence';
export * from './episodes';
export * from './themes';
export * from './staff';
export * from './sync-state';
export * from './social-profile';
export * from './story-arcs';
export * from './resume-position';
export * from './comic-reader';
export * from './share-image';
export * from './emulators';
export * from './backup';
export * from './user-image';
export * from './deep-link';
export * from './player';
