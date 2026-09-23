import { tauriCmd } from './bridge';

export interface LocalScreenshot {
  path: string;
  thumbnail_path: string;
}

export async function getLocalScreenshots(workName: string): Promise<LocalScreenshot[]> {
  return tauriCmd<LocalScreenshot[]>('get_local_screenshots', [], { workName });
}
