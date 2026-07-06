import { readStoredJson, writeStoredJson } from './core';

export async function readRoutes(): Promise<Record<string, string>> {
  return readStoredJson<Record<string, string>>('read_routes', 'category_routes', {});
}

export async function writeRoutes(routes: Record<string, string>): Promise<void> {
  return writeStoredJson('write_routes', 'category_routes', routes, 'routesJson');
}
