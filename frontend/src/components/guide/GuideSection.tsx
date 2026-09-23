// One section of the user guide: what it is, numbered steps, tips, the
// shortcuts involved and buttons that open the related setting or page.
import { ExternalLink, Settings } from 'lucide-react';
import type { Translations } from '../../i18n/index';
import { interpolateTranslation, resolveTranslationKey } from '../../lib/i18n-dom/apply-translations';
import {
  GUIDE_ROUTES, sectionAnchor, type GuideSectionCopy, type GuideSectionDef,
} from '../../lib/welcome/guide-content';
import {
  SERVICE_BRAND_NAMES, SETTINGS_TAB_LABEL_KEYS, settingsHref, type SettingsTarget,
} from '../../lib/welcome/settings-tabs';
import { ShortcutKeyCaps } from '../shared/ShortcutSheet';
import { GuideIcon } from './GuideIcon';

interface GuideSectionProps {
  def: GuideSectionDef;
  copy: GuideSectionCopy;
  t: Translations;
}

function settingsLabel(t: Translations, target: SettingsTarget): string {
  const tab = resolveTranslationKey(t, SETTINGS_TAB_LABEL_KEYS[target.tab]) ?? target.tab;
  return target.platform
    ? interpolateTranslation(t.guide.open_settings_service, { tab, service: SERVICE_BRAND_NAMES[target.platform] })
    : interpolateTranslation(t.guide.open_settings, { tab });
}

export function GuideSection({ def, copy, t }: GuideSectionProps) {
  const g = t.guide;
  const anchor = sectionAnchor(def.id);
  const steps = Object.values(copy.steps);
  const tips = Object.values(copy.tips);
  const route = def.route ? GUIDE_ROUTES[def.route] : null;
  const hasActions = (def.settings?.length ?? 0) > 0 || route;

  return (
    <article className="guide-section" id={anchor} aria-labelledby={`${anchor}-title`}>
      <header className="guide-section-head">
        <span className="guide-section-icon"><GuideIcon name={def.icon} size={20} /></span>
        <h3 id={`${anchor}-title`} className="guide-section-title">{copy.title}</h3>
      </header>
      <p className="guide-section-intro">{copy.intro}</p>

      <div className="guide-section-body">
        <div className="guide-block">
          <h4 className="guide-block-title">{g.steps_title}</h4>
          <ol className="guide-steps">
            {steps.map((step, index) => <li key={index}>{step}</li>)}
          </ol>
        </div>

        {tips.length > 0 && (
          <div className="guide-block guide-block--tips">
            <h4 className="guide-block-title">{g.tips_title}</h4>
            <ul className="guide-tips">
              {tips.map((tip, index) => <li key={index}>{tip}</li>)}
            </ul>
          </div>
        )}
      </div>

      {def.shortcuts && def.shortcuts.length > 0 && (
        <div className="guide-block guide-block--shortcuts">
          <h4 className="guide-block-title">{g.shortcuts_title}</h4>
          <ul className="guide-shortcuts">
            {def.shortcuts.map(shortcut => (
              <li key={`${shortcut.label}:${shortcut.keys.join('|')}`}>
                <span className="guide-shortcut-label">{resolveTranslationKey(t, shortcut.label) ?? shortcut.label}</span>
                <ShortcutKeyCaps keys={shortcut.keys} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {hasActions && (
        <div className="guide-actions">
          {def.settings?.map(target => (
            <a
              key={`${target.tab}:${target.platform ?? ''}`}
              className="btn btn--secondary btn--sm guide-action"
              href={settingsHref(target)}
            >
              <Settings size={14} strokeWidth={2} aria-hidden="true" />
              {settingsLabel(t, target)}
            </a>
          ))}
          {route && (
            <a className="btn btn--ghost btn--sm guide-action" href={route.href}>
              <ExternalLink size={14} strokeWidth={2} aria-hidden="true" />
              {interpolateTranslation(g.open_page, { page: resolveTranslationKey(t, route.label) ?? route.href })}
            </a>
          )}
        </div>
      )}
    </article>
  );
}
