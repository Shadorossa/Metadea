import { Fragment, useState } from 'react';
import type { MediaCompany } from '../../../lib/media/types';
import { companyPageHref } from '../../../lib/company/company-page-id';
import { getPublisherNamesString } from '../../../lib/shared/text/string-utils';
import { hidesMusicCompanies, partitionMusicCompanies } from '../../../lib/media/company-classification';
import { interpolate } from '../../../lib/shared/text/interpolate';
import { getT } from '../../../i18n/runtime';

// A company name on the media page: a link to its company page when the
// stored id names a provider (lib/company/company-page-id.ts), plain text
// otherwise (name-only ids such as a ComicVine publisher without an id).
export function CompanyName({ company, mediaType, className }: {
  company: MediaCompany;
  mediaType: string;
  className?: string;
}) {
  const href = companyPageHref(company, mediaType);
  if (!href) return <span className={className}>{company.name}</span>;
  return <a href={href} className={`company-name-link${className ? ` ${className}` : ''}`}>{company.name}</a>;
}

// The hero's publisher line (metaLines[0], built by every mapper from the
// 'publisher' companies). Rendered as links when the line is exactly that
// list; any other text stays as it was. On anime/manga, the record labels
// among AniList's producers (lib/media/company-classification.ts) are
// folded behind a "+N music labels" toggle.
export function PublisherLine({ line, companies, mediaType }: {
  line: string;
  companies: MediaCompany[] | undefined;
  mediaType: string;
}) {
  const [showMusic, setShowMusic] = useState(false);
  const publishers = (companies ?? []).filter(c => c.role === 'publisher');
  if (publishers.length === 0 || getPublisherNamesString(publishers) !== line) {
    return <p className="media-studios-label">{line}</p>;
  }
  const { shown, music } = hidesMusicCompanies(mediaType)
    ? partitionMusicCompanies(publishers)
    : { shown: publishers, music: [] as MediaCompany[] };
  const visible = showMusic ? [...shown, ...music] : shown;
  const tm = getT().media;
  return (
    <p className="media-studios-label">
      {visible.map((company, i) => (
        <Fragment key={`${company.external_id}-${i}`}>
          {i > 0 && ', '}
          <CompanyName company={company} mediaType={mediaType} className={i >= shown.length ? 'company-name--music' : undefined} />
        </Fragment>
      ))}
      {music.length > 0 && (
        <button
          type="button"
          className="company-music-toggle"
          aria-expanded={showMusic}
          onClick={() => setShowMusic(v => !v)}
        >
          {showMusic ? tm.music_labels_hide : interpolate(tm.music_labels_show, { count: music.length })}
        </button>
      )}
    </p>
  );
}
