// Registry of extension points: for every call the host can make into a
// plugin, which contribution kind it targets, which handler method it runs,
// how long it may take and how its result is normalised. Adding a point is
// one entry here, the contribution kind in manifest.rs/manifest.ts, and a
// section in docs/PLUGINS.md; the runtime and the worker SDK need no change
// (the SDK dispatches any `register({ <kind>: { <id>: handler } })`).
import type { PluginContributions, WorkContribution } from './manifest';
import type { ExtensionPointName } from './protocol';
import {
  sanitizeActionResult,
  sanitizeDetails,
  sanitizeLatest,
  sanitizePages,
  sanitizePanel,
  sanitizeSearchResult,
} from './plugin-results';

interface CallContext {
  /** The contribution's manifest label (a panel's fallback title). */
  label: string;
}

interface ExtensionCall<TResult> {
  point: ExtensionPointName;
  /** Method of a `sources` handler object; undefined for function handlers. */
  method?: string;
  timeoutMs: number;
  sanitize: (raw: unknown, ctx: CallContext) => TResult;
}

function define<TResult>(call: ExtensionCall<TResult>): ExtensionCall<TResult> {
  return call;
}

export const EXTENSION_CALLS = {
  'sources.search': define({ point: 'sources', method: 'search', timeoutMs: 30_000, sanitize: sanitizeSearchResult }),
  'sources.details': define({ point: 'sources', method: 'details', timeoutMs: 30_000, sanitize: sanitizeDetails }),
  'sources.pages': define({ point: 'sources', method: 'pages', timeoutMs: 60_000, sanitize: sanitizePages }),
  'sources.latest': define({ point: 'sources', method: 'latest', timeoutMs: 60_000, sanitize: sanitizeLatest }),
  'workActions.run': define({ point: 'workActions', timeoutMs: 20_000, sanitize: sanitizeActionResult }),
  'workPanels.render': define({ point: 'workPanels', timeoutMs: 15_000, sanitize: (raw, ctx) => sanitizePanel(raw, ctx.label) }),
};

export type ExtensionCallKey = keyof typeof EXTENSION_CALLS;
export type ExtensionResult<K extends ExtensionCallKey> = ReturnType<(typeof EXTENSION_CALLS)[K]['sanitize']>;

/** Declared contributions of one kind that apply to a work type. */
export function contributionsFor(
  contributes: PluginContributions,
  point: 'workActions' | 'workPanels',
  workType: string,
): WorkContribution[] {
  return contributes[point].filter(item => item.types.length === 0 || item.types.includes(workType));
}
