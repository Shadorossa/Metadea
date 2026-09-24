// Permission tokens as Rust stores and compares them (manifest.rs
// `permission_tokens`): `host:<pattern>`, `settingsHost:<settingKey>`,
// `cap:<capability>`. Parsed here for the consent prompt and the plugin card.

export type PermissionToken =
  | { kind: 'host'; value: string }
  | { kind: 'settingsHost'; value: string }
  | { kind: 'capability'; value: string };

export function parsePermissionToken(token: string): PermissionToken | null {
  const colon = token.indexOf(':');
  if (colon === -1) return null;
  const prefix = token.slice(0, colon);
  const value = token.slice(colon + 1);
  if (!value) return null;
  if (prefix === 'host') return { kind: 'host', value };
  if (prefix === 'settingsHost') return { kind: 'settingsHost', value };
  if (prefix === 'cap') return { kind: 'capability', value };
  return null;
}

export function groupPermissionTokens(tokens: string[]): { hosts: string[]; settingsHosts: string[]; capabilities: string[] } {
  const out = { hosts: [] as string[], settingsHosts: [] as string[], capabilities: [] as string[] };
  for (const token of tokens) {
    const parsed = parsePermissionToken(token);
    if (!parsed) continue;
    if (parsed.kind === 'host') out.hosts.push(parsed.value);
    else if (parsed.kind === 'settingsHost') out.settingsHosts.push(parsed.value);
    else out.capabilities.push(parsed.value);
  }
  return out;
}
