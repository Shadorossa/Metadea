// Permission prompt of Settings › Plugins: shown before a new plugin is
// installed, when an update asks for more than the user granted, and when a
// package on disk declares permissions that were never granted. It lists
// exactly what the plugin will be able to reach (hosts, the hosts of URL
// settings, capabilities); accepting is the only way permissions are granted.
import type { Translations } from '../../i18n/types';
import type { PluginManifest } from '../../lib/plugins/manifest';
import { groupPermissionTokens } from '../../lib/plugins/permission-tokens';
import { interpolate } from '../../lib/shared/text/interpolate';
import { ModalShell } from '../shared/ModalShell';

export type ConsentMode = 'install' | 'update' | 'grant';

interface Props {
  t: Translations['plugins'];
  mode: ConsentMode;
  manifest: PluginManifest;
  iconDataUrl: string | null;
  /** Every token the plugin asks for. */
  requested: string[];
  /** Tokens not granted before (highlighted; all of them on a fresh install). */
  added: string[];
  previousVersion?: string;
  busy: boolean;
  onAccept: () => void;
  onCancel: () => void;
}

export function PluginIcon({ name, iconDataUrl, size = 'md' }: { name: string; iconDataUrl: string | null; size?: 'md' | 'lg' }) {
  return (
    <span className={`plugin-icon plugin-icon--${size}`} aria-hidden="true">
      {iconDataUrl ? <img src={iconDataUrl} alt="" /> : name.slice(0, 2).toUpperCase()}
    </span>
  );
}

export function PluginConsentDialog({ t, mode, manifest, iconDataUrl, requested, added, previousVersion, busy, onAccept, onCancel }: Props) {
  const title = mode === 'install'
    ? interpolate(t.consent_title_install, { name: manifest.name })
    : mode === 'update'
    ? interpolate(t.consent_title_update, { name: manifest.name, version: manifest.version })
    : interpolate(t.consent_title_grant, { name: manifest.name });
  const accept = mode === 'install' ? t.consent_accept_install : mode === 'update' ? t.consent_accept_update : t.consent_accept_grant;
  const groups = groupPermissionTokens(requested);
  const isNew = (token: string) => mode !== 'install' && added.includes(token);
  const settingLabel = (key: string) => manifest.settings.find(f => f.key === key)?.label ?? key;
  const capabilityLabel = (cap: string) => cap === 'notifications' ? t.consent_cap_notifications : cap === 'openUrl' ? t.consent_cap_open_url : cap;
  const nothing = requested.length === 0;

  return (
    <ModalShell onClose={onCancel} label={title} overlayClassName="plugin-modal-overlay" panelClassName="plugin-modal" closeOnBackdrop={!busy}>
      <div className="plugin-consent-head">
        <PluginIcon name={manifest.name} iconDataUrl={iconDataUrl} size="lg" />
        <div>
          <h2 className="plugin-modal-title">{title}</h2>
          <p className="plugin-consent-meta">
            {interpolate(t.by_author, { author: manifest.author })} · v{manifest.version}
            {previousVersion ? ` (${interpolate(t.consent_from_version, { version: previousVersion })})` : ''}
          </p>
        </div>
      </div>
      {manifest.description && <p className="plugin-consent-description">{manifest.description}</p>}

      <p className="plugin-consent-intro">{mode === 'install' ? t.consent_intro : t.consent_update_intro}</p>
      {nothing ? (
        <p className="plugin-consent-none">{t.consent_none}</p>
      ) : (
        <ul className="plugin-consent-list">
          {groups.hosts.length > 0 && (
            <li>
              <span>{t.consent_hosts}</span>
              <span className="plugin-consent-hosts">
                {groups.hosts.map(host => (
                  <code key={host} className={isNew(`host:${host}`) ? 'plugin-consent-new' : undefined}>{host}</code>
                ))}
              </span>
            </li>
          )}
          {groups.settingsHosts.map(key => (
            <li key={key} className={isNew(`settingsHost:${key}`) ? 'plugin-consent-new' : undefined}>
              {interpolate(t.consent_settings_host, { setting: settingLabel(key) })}
            </li>
          ))}
          {groups.capabilities.map(cap => (
            <li key={cap} className={isNew(`cap:${cap}`) ? 'plugin-consent-new' : undefined}>{capabilityLabel(cap)}</li>
          ))}
        </ul>
      )}
      <p className="plugin-consent-warning" role="note">{t.consent_warning}</p>

      <div className="plugin-modal-actions">
        <button type="button" className="btn btn--sm btn--secondary" disabled={busy} onClick={onCancel}>{t.cancel}</button>
        <button type="button" className="btn btn--sm btn--primary" disabled={busy} onClick={onAccept}>{accept}</button>
      </div>
    </ModalShell>
  );
}
