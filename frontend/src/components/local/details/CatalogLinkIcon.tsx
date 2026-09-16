import { getT } from '../../../i18n/client';

interface CatalogLinkIconProps {
  externalId: string;
}

export function CatalogLinkIcon({ externalId }: CatalogLinkIconProps) {
  const t = getT().local;
  return (
    <a href={`/media?id=${externalId}`} className="local-media-detail-catalog-icon" title={t.view_in_catalog_title}>
      <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
        <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
      </svg>
    </a>
  );
}
