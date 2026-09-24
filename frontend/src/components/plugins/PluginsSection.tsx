// Settings › Plugins › Plugins (PluginsTab.astro): installed plugins with
// their state, install from a file or an https URL (always through the
// permission prompt), enable/disable, per-plugin settings and uninstall.
// Talks to Rust through lib/tauri/plugins and tells the runtime about every
// change with emitPluginsChanged, which restarts the affected worker.
import { useEffect, useState } from 'react';
import { getT } from '../../i18n/runtime';
import type { Translations } from '../../i18n/types';
import { useHydrated } from '../shared/hooks/useHydrated';
import { useExternalStore } from '../shared/hooks/useExternalStore';
import { showToast } from '../../lib/dom/toast';
import { formatAppError } from '../../lib/errors/format-error';
import { interpolate } from '../../lib/shared/text/interpolate';
import {
  cancelPluginInstall,
  confirmPluginInstall,
  grantPluginPermissions,
  installPluginFromFile,
  installPluginFromUrl,
  openPluginsFolder,
  setPluginEnabled,
  uninstallPlugin,
  type PluginInfo,
  type PluginInstallPreview,
} from '../../lib/tauri/plugins';
import { getPluginRuntime } from '../../lib/plugins/runtime-instance';
import { emitPluginsChanged } from '../../lib/plugins/host-events';
import type { PluginWorkerStatus } from '../../lib/plugins/plugin-worker-host';
import { PluginConsentDialog, PluginIcon, type ConsentMode } from './PluginConsentDialog';
import { PluginSettingsForm } from './PluginSettingsForm';

type Prompt =
  | { kind: 'install'; preview: PluginInstallPreview }
  | { kind: 'grant'; plugin: PluginInfo };

type Tp = Translations['plugins'];

function statusBadge(plugin: PluginInfo, status: PluginWorkerStatus | undefined, tp: Tp): { label: string; detail: string | null } | null {
  const t = getT();
  if (plugin.error) return { label: tp.badge_error, detail: formatAppError(plugin.error, t) };
  if (plugin.pendingPermissions.length > 0) return { label: tp.badge_needs_consent, detail: null };
  if (status?.state === 'failed') return { label: tp.badge_failed, detail: status.error };
  if (status?.state === 'crashed') return { label: tp.badge_crashed, detail: status.error };
  return null;
}

function contributionChips(plugin: PluginInfo, tp: Tp): string[] {
  const c = plugin.manifest?.contributes;
  if (!c) return [];
  return [
    c.sources.length > 0 ? tp.contrib_sources : null,
    c.workActions.length > 0 ? tp.contrib_actions : null,
    c.workPanels.length > 0 ? tp.contrib_panels : null,
    c.events.length > 0 ? tp.contrib_events : null,
  ].filter((chip): chip is string => chip !== null);
}

interface CardProps {
  plugin: PluginInfo;
  status: PluginWorkerStatus | undefined;
  tp: Tp;
  busy: boolean;
  onToggle: (plugin: PluginInfo, enabled: boolean) => void;
  onUninstall: (plugin: PluginInfo) => void;
  onReviewPermissions: (plugin: PluginInfo) => void;
}

function PluginCard({ plugin, status, tp, busy, onToggle, onUninstall, onReviewPermissions }: CardProps) {
  const [showSettings, setShowSettings] = useState(false);
  const [confirmUninstall, setConfirmUninstall] = useState(false);
  const manifest = plugin.manifest;
  const name = manifest?.name ?? plugin.id;
  const badge = statusBadge(plugin, status, tp);
  const chips = contributionChips(plugin, tp);
  const hasSettings = (manifest?.settings.length ?? 0) > 0;

  return (
    <li className={`plugin-card${plugin.enabled ? '' : ' plugin-card--disabled'}${badge ? ' plugin-card--problem' : ''}`} data-plugin-id={plugin.id}>
      <div className="plugin-card-main">
        <PluginIcon name={name} iconDataUrl={plugin.iconDataUrl} />
        <div className="plugin-card-body">
          <div className="plugin-card-heading">
            <span className="plugin-card-name">{name}</span>
            <span className="plugin-card-version">v{plugin.version}</span>
            {badge && <span className="plugin-badge plugin-badge--error" title={badge.detail ?? undefined}>{badge.label}</span>}
            {!plugin.enabled && <span className="plugin-badge">{tp.badge_disabled}</span>}
          </div>
          {manifest && <p className="plugin-card-author">{interpolate(tp.by_author, { author: manifest.author })}</p>}
          {manifest?.description && <p className="plugin-card-description">{manifest.description}</p>}
          {chips.length > 0 && (
            <p className="plugin-card-chips">
              {chips.map(chip => <span key={chip} className="plugin-chip">{chip}</span>)}
            </p>
          )}
          {badge?.detail && (
            <p className="plugin-card-error" role="alert">
              <strong>{plugin.error ? tp.load_error : tp.runtime_error}</strong> {badge.detail}
            </p>
          )}
        </div>
        <label className="plugin-toggle" title={tp.enabled}>
          <input
            type="checkbox"
            role="switch"
            className="plugin-toggle-input"
            checked={plugin.enabled}
            disabled={busy || (!!plugin.error && !plugin.enabled)}
            aria-label={interpolate(tp.toggle_aria, { name })}
            onChange={e => onToggle(plugin, e.target.checked)}
          />
          <span className="plugin-toggle-track" aria-hidden="true" />
        </label>
      </div>
      <div className="plugin-card-actions">
        {plugin.pendingPermissions.length > 0 && manifest && (
          <button type="button" className="btn btn--sm btn--primary" disabled={busy} onClick={() => onReviewPermissions(plugin)}>{tp.review_permissions}</button>
        )}
        {hasSettings && (
          <button type="button" className="btn btn--sm btn--secondary" aria-expanded={showSettings} onClick={() => setShowSettings(open => !open)}>
            {tp.settings}
          </button>
        )}
        {confirmUninstall ? (
          <>
            <span className="plugin-card-confirm">{interpolate(tp.uninstall_confirm, { name })}</span>
            <button type="button" className="btn btn--sm btn--ghost plugin-danger" disabled={busy} onClick={() => onUninstall(plugin)}>{tp.uninstall}</button>
            <button type="button" className="btn btn--sm btn--secondary" onClick={() => setConfirmUninstall(false)}>{tp.cancel}</button>
          </>
        ) : (
          <button type="button" className="btn btn--sm btn--ghost" disabled={busy} onClick={() => setConfirmUninstall(true)}>{tp.uninstall}</button>
        )}
      </div>
      {showSettings && manifest && (
        <div className="plugin-card-settings">
          <PluginSettingsForm t={tp} manifest={manifest} />
        </div>
      )}
    </li>
  );
}

export function PluginsSection() {
  const hydrated = useHydrated();
  const runtime = getPluginRuntime();
  const plugins = useExternalStore(runtime.plugins);
  const statuses = useExternalStore(runtime.statuses);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [urlOpen, setUrlOpen] = useState(false);
  const [url, setUrl] = useState('');

  useEffect(() => {
    let alive = true;
    runtime.refresh()
      .catch(err => showToast(formatAppError(err, getT()), 'error'))
      .finally(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, [runtime]);

  if (!hydrated) return <div className="plugins-section plugins-section--pending" aria-hidden="true" />;
  const t = getT();
  const tp = t.plugins;

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (err) {
      showToast(formatAppError(err, t), 'error');
    } finally {
      setBusy(false);
    }
  };

  const commit = async (preview: PluginInstallPreview) => {
    const installed = await confirmPluginInstall(preview.token);
    emitPluginsChanged({ pluginId: installed.id });
    await runtime.refresh();
    showToast(preview.previous
      ? interpolate(tp.updated, { name: preview.manifest.name, version: preview.manifest.version })
      : interpolate(tp.installed, { name: preview.manifest.name }), 'success');
  };

  const handlePreview = async (preview: PluginInstallPreview | null) => {
    if (!preview) return;
    // A fresh install always asks; an update only when it wants more.
    if (preview.needsConsent) setPrompt({ kind: 'install', preview });
    else await commit(preview);
  };

  const installFile = () => run(async () => handlePreview(await installPluginFromFile()));

  const installUrl = () => run(async () => {
    const preview = await installPluginFromUrl(url.trim());
    setUrlOpen(false);
    setUrl('');
    await handlePreview(preview);
  });

  const acceptPrompt = () => run(async () => {
    if (!prompt) return;
    if (prompt.kind === 'install') {
      await commit(prompt.preview);
    } else {
      await grantPluginPermissions(prompt.plugin.id);
      emitPluginsChanged({ pluginId: prompt.plugin.id });
      await runtime.refresh();
    }
    setPrompt(null);
  });

  const cancelPrompt = () => {
    if (prompt?.kind === 'install') cancelPluginInstall(prompt.preview.token).catch(() => {});
    setPrompt(null);
  };

  const toggle = (plugin: PluginInfo, enabled: boolean) => {
    if (enabled && plugin.pendingPermissions.length > 0) {
      setPrompt({ kind: 'grant', plugin });
      return;
    }
    void run(async () => {
      await setPluginEnabled(plugin.id, enabled);
      emitPluginsChanged({ pluginId: plugin.id });
      await runtime.refresh();
      const name = plugin.manifest?.name ?? plugin.id;
      showToast(interpolate(enabled ? tp.enabled_toast : tp.disabled_toast, { name }), 'success');
    });
  };

  const uninstall = (plugin: PluginInfo) => run(async () => {
    runtime.stop(plugin.id);
    await uninstallPlugin(plugin.id);
    emitPluginsChanged({ pluginId: plugin.id });
    await runtime.refresh();
    showToast(tp.uninstalled, 'success');
  });

  let dialog = null;
  if (prompt) {
    const isInstall = prompt.kind === 'install';
    const manifest = isInstall ? prompt.preview.manifest : prompt.plugin.manifest;
    if (manifest) {
      const mode: ConsentMode = !isInstall ? 'grant' : prompt.preview.previous ? 'update' : 'install';
      dialog = (
        <PluginConsentDialog
          t={tp}
          mode={mode}
          manifest={manifest}
          iconDataUrl={isInstall ? prompt.preview.iconDataUrl : prompt.plugin.iconDataUrl}
          requested={isInstall ? prompt.preview.requestedPermissions : [...prompt.plugin.grantedPermissions, ...prompt.plugin.pendingPermissions]}
          added={isInstall ? prompt.preview.newPermissions : prompt.plugin.pendingPermissions}
          previousVersion={isInstall ? prompt.preview.previous?.version : undefined}
          busy={busy}
          onAccept={() => void acceptPrompt()}
          onCancel={cancelPrompt}
        />
      );
    }
  }

  return (
    <div className="plugins-section" data-ui-hook="plugins-section">
      <div className="plugins-toolbar">
        <button type="button" className="btn btn--sm btn--primary" disabled={busy} onClick={() => void installFile()}>{tp.install_file}</button>
        <button type="button" className="btn btn--sm btn--secondary" disabled={busy} aria-expanded={urlOpen} onClick={() => setUrlOpen(open => !open)}>{tp.install_url}</button>
        <button type="button" className="btn btn--sm btn--secondary" disabled={busy} onClick={() => void run(() => openPluginsFolder())}>{tp.open_folder}</button>
      </div>

      {urlOpen && (
        <form className="plugins-url-form" onSubmit={e => { e.preventDefault(); if (url.trim()) void installUrl(); }}>
          <label htmlFor="plugins-install-url" className="plugin-setting-label">{tp.url_label}</label>
          <div className="plugins-url-row">
            <input
              id="plugins-install-url"
              type="url"
              className="plugin-setting-input"
              placeholder={tp.url_placeholder}
              value={url}
              spellCheck={false}
              onChange={e => setUrl(e.target.value)}
            />
            <button type="submit" className="btn btn--sm btn--primary" disabled={busy || !url.trim().startsWith('https://')}>{tp.url_install}</button>
            <button type="button" className="btn btn--sm btn--secondary" onClick={() => setUrlOpen(false)}>{tp.cancel}</button>
          </div>
        </form>
      )}

      {!loaded ? (
        <p className="settings-hint">{tp.loading}</p>
      ) : plugins.length === 0 ? (
        <p className="settings-hint plugins-empty">{tp.empty}</p>
      ) : (
        <ul className="plugin-list">
          {plugins.map(plugin => (
            <PluginCard
              key={plugin.id}
              plugin={plugin}
              status={statuses[plugin.id]}
              tp={tp}
              busy={busy}
              onToggle={toggle}
              onUninstall={p => void uninstall(p)}
              onReviewPermissions={p => setPrompt({ kind: 'grant', plugin: p })}
            />
          ))}
        </ul>
      )}
      <p className="settings-hint">{tp.docs_hint}</p>
      {dialog}
    </div>
  );
}
