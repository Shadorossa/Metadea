// Signing in with Google replaces the session username with the account's
// server name (derived from the Google profile on first link). The name the
// user picked when they started (offline login) must survive that: it
// becomes the custom display name, which every screen and the profile sync
// already prefer over the session username.

/** The name to keep as the custom display name, or null when nothing to do:
 *  a custom name already exists, there was no previous session, or the
 *  previous name is the same as the new one. */
export function nameToKeep(
  previousUsername: string | null | undefined,
  newUsername: string | null | undefined,
  currentDisplayName: string | null | undefined,
): string | null {
  if (currentDisplayName?.trim()) return null;
  const previous = previousUsername?.trim();
  if (!previous) return null;
  if (previous === newUsername?.trim()) return null;
  return previous;
}
