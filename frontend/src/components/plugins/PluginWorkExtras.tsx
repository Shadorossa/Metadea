// Media-page contributions of enabled plugins: `workActions` buttons and
// `workPanels` cards. Panels are data (title, label/value rows with optional
// https links, badges) that Metadea lays out itself — never plugin HTML.
// Renders nothing when no plugin contributes to this work's type.
import { useEffect, useMemo, useState } from 'react';
import { getT } from '../../i18n/runtime';
import { useExternalStore } from '../shared/hooks/useExternalStore';
import { showToast } from '../../lib/dom/toast';
import { interpolate } from '../../lib/shared/text/interpolate';
import { openExternalUrl } from '../../lib/tauri/game-launch';
import { notifySystem } from '../../lib/notifications/notifications';
import { getPluginRuntime } from '../../lib/plugins/runtime-instance';
import type { PluginWorkContext } from '../../lib/plugins/work-context';
import type { WorkPanelData } from '../../lib/plugins/plugin-results';
import type { PluginInfo } from '../../lib/tauri/plugins';
import { pluginErrorText } from './plugin-error-text';

interface Props {
  work: PluginWorkContext;
}

const hasCapability = (plugin: PluginInfo, capability: string) =>
  !!plugin.manifest?.permissions.capabilities.includes(capability as 'notifications' | 'openUrl');

export function PluginWorkExtras({ work }: Props) {
  const t = getT();
  const tp = t.plugins;
  const runtime = getPluginRuntime();
  const installed = useExternalStore(runtime.plugins);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- recomputed when the installed list changes
  const actions = useMemo(() => runtime.contributionsFor('workActions', work.type), [runtime, installed, work.type]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- recomputed when the installed list changes
  const panels = useMemo(() => runtime.contributionsFor('workPanels', work.type), [runtime, installed, work.type]);
  const [panelData, setPanelData] = useState<Record<string, WorkPanelData | null>>({});
  const [running, setRunning] = useState<string | null>(null);

  useEffect(() => {
    runtime.ensureLoaded().catch(() => {});
  }, [runtime]);

  const panelKeys = panels.map(p => `${p.plugin.id}/${p.item.id}`).join('|');
  useEffect(() => {
    let alive = true;
    setPanelData({});
    for (const { plugin, item } of panels) {
      const key = `${plugin.id}/${item.id}`;
      runtime.invoke(plugin.id, 'workPanels.render', item.id, [work])
        .then(data => { if (alive) setPanelData(prev => ({ ...prev, [key]: data })); })
        // A failing panel is simply not shown; the plugin card in Settings
        // carries the error badge.
        .catch(() => { if (alive) setPanelData(prev => ({ ...prev, [key]: null })); });
    }
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the contribution list and the work
  }, [panelKeys, work.externalId]);

  const runAction = async (plugin: PluginInfo, actionId: string) => {
    const key = `${plugin.id}/${actionId}`;
    setRunning(key);
    try {
      const result = await runtime.invoke(plugin.id, 'workActions.run', actionId, [work]);
      const name = plugin.manifest?.name ?? plugin.id;
      if (result.type === 'toast') showToast(result.message, result.level);
      else if (result.type === 'openUrl') {
        if (!hasCapability(plugin, 'openUrl')) throw new Error(tp.error_capability_open_url);
        await openExternalUrl(result.url);
      } else if (result.type === 'notify') {
        if (!hasCapability(plugin, 'notifications')) throw new Error(tp.error_capability_notifications);
        await notifySystem(`${name}: ${result.title}`, result.body);
      }
    } catch (err) {
      showToast(interpolate(tp.action_failed, { name: plugin.manifest?.name ?? plugin.id, error: pluginErrorText(err, t) }), 'error');
    } finally {
      setRunning(null);
    }
  };

  const visiblePanels = panels.flatMap(({ plugin, item }) => {
    const data = panelData[`${plugin.id}/${item.id}`];
    return data ? [{ key: `${plugin.id}/${item.id}`, data }] : [];
  });
  if (actions.length === 0 && visiblePanels.length === 0) return null;

  return (
    <section className="plugin-work-extras" aria-label={tp.work_extras_title}>
      <div className="media-section-header-row">
        <p className="section-label">{tp.work_extras_title}</p>
        <div className="media-section-header-line" />
      </div>
      {actions.length > 0 && (
        <div className="plugin-work-actions">
          {actions.map(({ plugin, item }) => (
            <button
              key={`${plugin.id}/${item.id}`}
              type="button"
              className="btn btn--sm btn--secondary"
              disabled={running === `${plugin.id}/${item.id}`}
              title={plugin.manifest?.name}
              onClick={() => void runAction(plugin, item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
      {visiblePanels.length > 0 && (
        <div className="plugin-work-panels">
          {visiblePanels.map(({ key, data }) => (
            <article key={key} className="plugin-panel">
              <header className="plugin-panel-head">
                <h3 className="plugin-panel-title">{data.title}</h3>
                {data.badges.map(badge => <span key={badge} className="plugin-chip">{badge}</span>)}
              </header>
              {data.rows.length > 0 && (
                <dl className="plugin-panel-rows">
                  {data.rows.map((row, index) => (
                    <div key={`${row.label}-${index}`} className="plugin-panel-row">
                      <dt>{row.label}</dt>
                      <dd>
                        {row.href
                          ? <button type="button" className="plugin-panel-link" onClick={() => void openExternalUrl(row.href as string)}>{row.value}</button>
                          : row.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
