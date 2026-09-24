// A plugin's settings, rendered from its manifest schema (string, secret,
// number, boolean, select, url). Labels come from the plugin itself. Secrets
// are never echoed back: a stored one shows as "saved", typing replaces it,
// and Rust encrypts it (DPAPI) before it reaches the database.
import { useEffect, useState } from 'react';
import type { Translations } from '../../i18n/types';
import type { PluginManifest, SettingField } from '../../lib/plugins/manifest';
import { settingValueError } from '../../lib/plugins/manifest';
import { getPluginSettings, setPluginSettings } from '../../lib/tauri/plugins';
import { emitPluginsChanged } from '../../lib/plugins/host-events';
import { formatAppError } from '../../lib/errors/format-error';
import { showToast } from '../../lib/dom/toast';
import { getT } from '../../i18n/runtime';

interface Props {
  t: Translations['plugins'];
  manifest: PluginManifest;
}

type Draft = Record<string, unknown>;

function fieldInput(field: SettingField, value: unknown, secretSaved: boolean, t: Translations['plugins'], onChange: (v: unknown) => void) {
  const id = `plugin-setting-${field.key}`;
  switch (field.type) {
    case 'boolean':
      return <input id={id} type="checkbox" className="settings-checkbox" checked={value === true} onChange={e => onChange(e.target.checked)} />;
    case 'select':
      return (
        <select id={id} className="plugin-setting-input" value={typeof value === 'string' ? value : ''} onChange={e => onChange(e.target.value)}>
          {value === undefined && <option value="" disabled>—</option>}
          {field.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
    case 'number':
      return (
        <input
          id={id}
          type="number"
          className="plugin-setting-input"
          min={field.min}
          max={field.max}
          value={typeof value === 'number' ? value : ''}
          placeholder={field.placeholder}
          onChange={e => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        />
      );
    case 'secret':
      return (
        <input
          id={id}
          type="password"
          autoComplete="off"
          className="plugin-setting-input"
          value={typeof value === 'string' ? value : ''}
          placeholder={secretSaved ? t.settings_secret_saved : field.placeholder}
          onChange={e => onChange(e.target.value)}
        />
      );
    default:
      return (
        <input
          id={id}
          type={field.type === 'url' ? 'url' : 'text'}
          className="plugin-setting-input"
          value={typeof value === 'string' ? value : ''}
          placeholder={field.placeholder}
          spellCheck={false}
          onChange={e => onChange(e.target.value)}
        />
      );
  }
}

export function PluginSettingsForm({ t, manifest }: Props) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [secretsSet, setSecretsSet] = useState<string[]>([]);
  const [cleared, setCleared] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    getPluginSettings(manifest.id)
      .then(view => {
        if (!alive) return;
        setDraft(view.values);
        setSecretsSet(view.secretsSet);
      })
      .catch(err => {
        if (!alive) return;
        setDraft({});
        showToast(formatAppError(err, getT()), 'error');
      });
    return () => { alive = false; };
  }, [manifest.id]);

  if (manifest.settings.length === 0) return <p className="settings-hint">{t.settings_none}</p>;
  if (!draft) return <p className="settings-hint">{t.loading}</p>;

  const update = (key: string, value: unknown) => {
    setDraft(prev => ({ ...prev, [key]: value }));
    setErrors(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const save = async () => {
    const values: Draft = {};
    const found: Record<string, string> = {};
    for (const field of manifest.settings) {
      const value = draft[field.key];
      if (field.type === 'secret') {
        // Untouched secret: omitted, so Rust keeps the stored one.
        if (cleared.includes(field.key)) values[field.key] = '';
        else if (typeof value === 'string' && value !== '') values[field.key] = value;
        continue;
      }
      const empty = value === undefined || value === '';
      if (empty) {
        if (field.required && field.default === undefined) found[field.key] = t.settings_required;
        continue;
      }
      const error = settingValueError(field, value);
      if (error) found[field.key] = t.settings_invalid;
      else values[field.key] = value;
    }
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setSaving(true);
    try {
      await setPluginSettings(manifest.id, values);
      const view = await getPluginSettings(manifest.id);
      setDraft(view.values);
      setSecretsSet(view.secretsSet);
      setCleared([]);
      // The worker reads settings at start: restart it with the new ones.
      emitPluginsChanged({ pluginId: manifest.id });
      showToast(t.settings_saved, 'success');
    } catch (err) {
      showToast(formatAppError(err, getT()), 'error');
    } finally {
      setSaving(false);
    }
  };

  const hasSecrets = manifest.settings.some(f => f.type === 'secret');

  return (
    <form className="plugin-settings" onSubmit={e => { e.preventDefault(); void save(); }}>
      {manifest.settings.map(field => {
        const secretSaved = secretsSet.includes(field.key) && !cleared.includes(field.key);
        return (
          <div key={field.key} className={`plugin-setting${field.type === 'boolean' ? ' plugin-setting--inline' : ''}${errors[field.key] ? ' plugin-setting--invalid' : ''}`}>
            <label htmlFor={`plugin-setting-${field.key}`} className="plugin-setting-label">
              {field.label}{field.required ? ' *' : ''}
            </label>
            <div className="plugin-setting-control">
              {fieldInput(field, draft[field.key], secretSaved, t, value => update(field.key, value))}
              {field.type === 'secret' && secretSaved && (
                <button type="button" className="btn btn--sm btn--ghost" onClick={() => { setCleared(prev => [...prev, field.key]); update(field.key, ''); }}>
                  {t.settings_secret_remove}
                </button>
              )}
            </div>
            {errors[field.key] && <p className="plugin-setting-error" role="alert">{errors[field.key]}</p>}
            {field.description && <p className="plugin-setting-help">{field.description}</p>}
          </div>
        );
      })}
      {hasSecrets && <p className="settings-hint">{t.settings_secret_hint}</p>}
      <div className="plugin-settings-actions">
        <button type="submit" className="btn btn--sm btn--primary" disabled={saving}>{t.settings_save}</button>
      </div>
    </form>
  );
}
