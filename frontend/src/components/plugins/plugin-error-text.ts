import type { Translations } from '../../i18n/types';
import { formatAppError } from '../../lib/errors/format-error';
import { PluginRpcError } from '../../lib/plugins/rpc';
import { PluginUnavailableError } from '../../lib/plugins/plugin-worker-host';

/** User-facing text for a failed plugin call (timeouts, crashes, E_* codes, plugin errors). */
export function pluginErrorText(err: unknown, t: Pick<Translations, 'plugins' | 'errors'>): string {
  if (err instanceof PluginRpcError) {
    if (err.kind === 'timeout') return t.plugins.error_timeout;
    if (err.kind === 'crashed' || err.kind === 'stopped') return `${t.plugins.error_unavailable} (${err.message})`;
    // A plugin's own error: it may carry an E_* code from a host call.
    return formatAppError(err.message, t);
  }
  if (err instanceof PluginUnavailableError) return `${t.plugins.error_unavailable} (${err.message})`;
  return formatAppError(err, t);
}
