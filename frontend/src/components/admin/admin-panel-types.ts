// Shared vocabulary of the catalog admin panel — the parent owns the tab
// selectors and the editor mount, each tab under ./tabs owns its own data.
export type Source = 'local' | 'github' | 'add';
export type Entity = 'media' | 'saga' | 'character' | 'episodes';

// GitHub's file listing and the episode groups only carry raw ids — this maps
// external_id → title/cover from the *full* local catalog (independent of the
// local tab's own search query) so those tabs can show something more useful
// than the id twice. Built by MediaTab, read by GithubFilesTab/EpisodesTab.
export type CatalogInfoMap = Record<string, { title?: string; cover?: string; blocked?: boolean }>;

// Everything a tab needs to say to open PrEditorModal. Every edit (whether it
// started from the local catalog, an already-merged GitHub entry, or a
// brand-new "Add work" pick) goes through the modal's default 'proposal'
// mode: a branch + PR, same as any other contribution, since every change
// here is meant to reach the shared catalog for every user, not just stay on
// this machine.
export interface EditorRequest {
  externalId: string;
  initialTab?: 'general' | 'cast' | 'relations';
  initialRelationsSubtab?: 'episodes';
  // Field names present locally but absent from the GitHub bundle that was
  // actually opened — PrEditorModal dims them. Only set when the editor is
  // opened from the GitHub tab, where the concept applies.
  nonGithubFields?: Set<string>;
}
