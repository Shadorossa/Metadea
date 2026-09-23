// Turns a theme manifest's `variables` map into the `:root { --x: … }` block
// the loader injects. Rust already validates the manifest, but the block is
// built here (pure, unit-tested) so a value that slipped through can never
// close the declaration or the rule: anything containing `;`, `{`, `}`, `<`,
// `>`, a backslash, `url(`, `expression(`, `javascript:` or `@import` is
// dropped, not escaped.

const NAME_RE = /^--[A-Za-z0-9_-]{1,64}$/;
const MAX_VALUE_LENGTH = 512;
const FORBIDDEN_FRAGMENTS = ['url(', 'expression(', 'javascript:', '@import'];

/** `accent` and `--accent` both address the `--accent` token. */
export function normalizeVariableName(name: string): string {
  const trimmed = name.trim();
  return trimmed.startsWith('--') ? trimmed : `--${trimmed}`;
}

export function isValidVariableName(name: string): boolean {
  return NAME_RE.test(name);
}

export function isSafeVariableValue(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_VALUE_LENGTH) return false;
  if (/[;{}<>\\]/.test(trimmed)) return false;
  const lower = trimmed.toLowerCase();
  return !FORBIDDEN_FRAGMENTS.some(fragment => lower.includes(fragment));
}

/** Sorted, validated `name: value` pairs; invalid entries are skipped. */
export function sanitizeVariables(variables: Record<string, string>): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [rawName, rawValue] of Object.entries(variables)) {
    if (typeof rawValue !== 'string') continue;
    const name = normalizeVariableName(rawName);
    if (!isValidVariableName(name) || !isSafeVariableValue(rawValue)) continue;
    out.push([name, rawValue.trim()]);
  }
  return out.sort(([a], [b]) => a.localeCompare(b));
}

/** `:root {\n  --a: 1;\n}` or '' when nothing survives validation. */
export function buildVariablesBlock(variables: Record<string, string>, selector = ':root'): string {
  const entries = sanitizeVariables(variables);
  if (entries.length === 0) return '';
  const lines = entries.map(([name, value]) => `  ${name}: ${value};`);
  return `${selector} {\n${lines.join('\n')}\n}`;
}

/** The full text of the injected `<style>`: token block first (so a full
 *  CSS theme can still rely on its own variables), then the sanitised CSS. */
export function composeThemeCss(payload: { variables: Record<string, string>; css: string }): string {
  const block = buildVariablesBlock(payload.variables);
  const css = payload.css.trim();
  return [block, css].filter(Boolean).join('\n\n');
}
