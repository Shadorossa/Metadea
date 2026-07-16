export const REPO_OWNER = 'Shadorossa';
export const REPO_NAME = 'Metadea';

export function isRepoOwner(username: string): boolean {
  return username.toLowerCase() === REPO_OWNER.toLowerCase();
}
