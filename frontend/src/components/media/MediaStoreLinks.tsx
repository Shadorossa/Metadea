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
        const logoFile = LOGO_MAP[link.platform.trim().toLowerCase()];
        let faviconUrl: string | null = null;
        if (!logoFile) {
          try {
            const hostname = new URL(link.url).hostname;
            faviconUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=64`;
          } catch {
            // A malformed shop URL should not make the relations section fail.
          }
        }
        return (
          <button
            key={`${link.platform}:${link.url}`}
            type="button"
            className="media-store-link"
            title={link.platform}
            onClick={() => openLink(link.url)}
          >
            {logoFile ? (
              <img src={`/platforms/${logoFile}`} alt={link.platform} className="media-store-icon" />
            ) : faviconUrl ? (
              <img src={faviconUrl} alt={link.platform} className="media-store-icon media-store-icon--favicon" />
            ) : (
              <span className="media-store-fallback" aria-hidden="true">{link.platform.trim().slice(0, 1).toUpperCase()}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
