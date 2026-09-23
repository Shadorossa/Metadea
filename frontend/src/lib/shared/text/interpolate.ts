// Replaces every "{key}" in `template` with the matching value from `vars` —
// shared by every i18n string that takes runtime placeholders (activity feed
// cards, search result counts, ...), independently reimplemented in three
// places before being pulled out here.
export function interpolate(template: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce((acc, [key, val]) => acc.replace(`{${key}}`, String(val)), template);
}
