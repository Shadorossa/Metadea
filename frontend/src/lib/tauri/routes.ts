import { readStoredJson, writeStoredJson } from './core';
import { STORAGE_KEYS } from '../shared/storage-keys';

export async function readRoutes(): Promise<Record<string, string>> {
  return readStoredJson<Record<string, string>>('read_routes', STORAGE_KEYS.categoryRoutes, {});
}

export async function writeRoutes(routes: Record<string, string>): Promise<void> {
  return writeStoredJson('write_routes', STORAGE_KEYS.categoryRoutes, routes, 'routesJson');
}
