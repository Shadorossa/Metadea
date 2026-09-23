import { useState, type ReactNode } from 'react';
import type { Translations } from '../../i18n/index';
import type { CompanyPageData } from '../../lib/tauri/company-catalog';
import { companyInitials } from '../../lib/company/company-works';
import { countryName } from '../../lib/media/mappers/mapper-utils';
import { attributeUrl } from '../../lib/character/character-page-urls';
import { openExternalUrl } from '../../lib/tauri/game-launch';
import { interpolate } from '../../lib/shared/text/interpolate';
import { companySourceLink, companyWebsites } from '../../lib/company/company-source-link';
import { Globe } from 'lucide-react';
import { MediaSourceLink } from '../media/MediaSourceLink';

interface Props {
  page: CompanyPageData;
  t: Translations['company_page'];
  /** The completion meter, rendered under the name. */
  children?: ReactNode;
}

// Descriptions longer than this start collapsed behind "Show more".
const COLLAPSE_AT = 320;

function websiteLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function CompanyHeader({ page, t, children }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const logo = logoFailed ? '' : attributeUrl(page.logo_url);
  const place = page.headquarters || countryName(page.country_code);
  const meta = [place, page.founded_year ? interpolate(t.founded, { year: page.founded_year }) : null].filter(Boolean);
  const description = page.description?.trim() ?? '';
  const collapsible = description.length > COLLAPSE_AT;
  const websites = companyWebsites(page.websites).map(url => attributeUrl(url)).filter(url => url.startsWith('http'));
  const sourceLink = companySourceLink(page);

  return (
    <header className="company-header">
      {/* Logos are mostly transparent PNGs: shown bare, no tile. The
          initials tile is only the fallback. */}
      {logo
        ? <img className="company-logo-img" src={logo} alt={interpolate(t.logo_alt, { name: page.name })} onError={() => setLogoFailed(true)} />
        : <div className="company-logo" aria-hidden="true"><span className="company-logo-initials">{companyInitials(page.name)}</span></div>}

      <div className="company-header-body">
        <h1 className="media-title-main company-name">{page.name}</h1>
        {page.roles.length > 0 && (
          <div className="company-roles">
            {page.roles.map(role => <span key={role} className="company-role-badge">{t.roles[role]}</span>)}
          </div>
        )}
        {meta.length > 0 && <p className="company-meta">{meta.join(' · ')}</p>}

        {description && (
          <div className="company-description">
            <p className={`company-description-text${collapsible && !expanded ? ' company-description-text--collapsed' : ''}`}>
              {description}
            </p>
            {collapsible && (
              <button type="button" className="company-description-toggle" aria-expanded={expanded} onClick={() => setExpanded(v => !v)}>
                {expanded ? t.show_less : t.show_more}
              </button>
            )}
          </div>
        )}

        {(websites.length > 0 || sourceLink) && (
          <div className="company-links">
            {sourceLink && <MediaSourceLink source={sourceLink.source} sourceUrl={sourceLink.url} />}
            {websites.map(url => (
              <a
                key={url}
                href={url}
                className="company-link"
                title={t.website}
                onClick={event => { event.preventDefault(); openExternalUrl(url).catch(console.error); }}
              >
                <Globe size={13} aria-hidden="true" />
                {websiteLabel(url)}
              </a>
            ))}
          </div>
        )}

        {children}
      </div>
    </header>
  );
}
