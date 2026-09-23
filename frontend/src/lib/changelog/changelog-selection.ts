// Decides what the "What's new" modal shows on app start, from the running
// app version and the version the user last acknowledged. Pure so the rules
// (first install, skipped versions, downgrades) are unit-testable.

/** Numeric semver compare ('v' prefix tolerated). A pre-release sorts below
 *  its release (0.7.0-beta < 0.7.0); pre-release tags compare as strings. */
export function compareVersions(a: string, b: string): number {
  const parse = (value: string) => {
    const [core, pre = ''] = value.trim().replace(/^v/i, '').split('-', 2);
    const nums = core.split('.').map(part => Number.parseInt(part, 10) || 0);
    while (nums.length < 3) nums.push(0);
    return { nums, pre };
  };
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < Math.max(left.nums.length, right.nums.length); i++) {
    const diff = (left.nums[i] ?? 0) - (right.nums[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  if (left.pre === right.pre) return 0;
  if (!left.pre) return 1;
  if (!right.pre) return -1;
  return left.pre < right.pre ? -1 : 1;
}

export interface ChangelogLaunchInput<R extends { version: string }> {
  runningVersion: string;
  /** Stored `metadea_last_seen_changelog_version`, null when never stored. */
  lastSeenVersion: string | null;
  /** Whether the install already has user data (onboarding done, settings…).
   *  Tells an update from a pre-changelog version apart from a fresh install. */
  hasPriorData: boolean;
  /** Releases newest first. */
  releases: readonly R[];
}

export type ChangelogLaunchDecision<R> =
  /** Nothing to do: already seen, or running an older build than last seen. */
  | { kind: 'none' }
  /** Record the running version without showing anything (fresh install, or
   *  a newer version that has no changelog section). */
  | { kind: 'store' }
  /** Show these releases (newest first), then record the running version. */
  | { kind: 'show'; releases: R[] };

export function decideChangelogLaunch<R extends { version: string }>(
  input: ChangelogLaunchInput<R>,
): ChangelogLaunchDecision<R> {
  const { runningVersion, lastSeenVersion, hasPriorData, releases } = input;

  if (lastSeenVersion === null) {
    // Fresh install: the user never saw an older version, so there is no
    // "new" to announce. Updating from a build that predates the changelog:
    // announce only the running version, not the whole history.
    if (!hasPriorData) return { kind: 'store' };
    const current = releases.filter(r => compareVersions(r.version, runningVersion) === 0);
    return current.length > 0 ? { kind: 'show', releases: current } : { kind: 'store' };
  }

  if (compareVersions(runningVersion, lastSeenVersion) <= 0) return { kind: 'none' };

  // Every version above the last one seen, up to the running one — several
  // when the user skipped releases.
  const unseen = releases.filter(r =>
    compareVersions(r.version, lastSeenVersion) > 0 && compareVersions(r.version, runningVersion) <= 0,
  );
  return unseen.length > 0 ? { kind: 'show', releases: unseen } : { kind: 'store' };
}
