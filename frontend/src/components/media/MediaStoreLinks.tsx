interface StoreLink {
  platform: string;
  url: string;
}

const LOGO_MAP: Record<string, string> = {
  steam: 'steam_logo.png',
  epic: 'epic_logo.png',
  gog: 'gog_logo.png',
  playstation: 'playstation_logo.png',
  xbox: 'xbox_logo.png',
  nintendo: 'nintendo_logo.png',
  ea: 'EA_logo.png',
};

export function openLink(url: string) {
  const tauri = window.__TAURI__;
  if (tauri?.opener?.openUrl) tauri.opener.openUrl(url);
  else window.open(url, '_blank');
}

export function MediaStoreLinks({ links }: { links: StoreLink[] }) {
  return (
    <div className="media-store-links-inline">
      {links.map(link => {
        const logoFile = LOGO_MAP[link.platform.toLowerCase()] || 'steam_logo.png';
        return (
          <button
            key={link.platform}
            type="button"
            className="media-store-link"
            title={link.platform}
            onClick={() => openLink(link.url)}
          >
            <img src={`/platforms/${logoFile}`} alt={link.platform} className="media-store-icon" />
          </button>
        );
      })}
    </div>
  );
}
