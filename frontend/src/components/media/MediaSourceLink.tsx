import { openLink } from './MediaStoreLinks';

const SOURCE_LOGO: Record<string, { file: string; label: string }> = {
  igdb:        { file: 'IGDB_logo.png', label: 'IGDB' },
  anilist:     { file: 'Anilist_logo.png', label: 'AniList' },
  tmdb:        { file: 'Tmdb.new.logo.png', label: 'TMDB' },
  openlibrary: { file: 'Open_Library_tight_logo.png', label: 'Open Library' },
  comicvine:   { file: 'comicvine_logo.png', label: 'Comic Vine' },
};

interface Props {
  source?: string;
  sourceUrl?: string;
}

// Small logo button next to the "Datos" section header, mirroring
// MediaStoreLinks' placement in the "Relacionados" header — opens this
// work's own page on whichever API it was sourced from.
export function MediaSourceLink({ source, sourceUrl }: Props) {
  if (!source || !sourceUrl) return null;
  const meta = SOURCE_LOGO[source.toLowerCase()];
  if (!meta) return null;

  return (
    <button
      type="button"
      className="media-store-link"
      title={meta.label}
      onClick={() => openLink(sourceUrl)}
    >
      <img src={`/API/${meta.file}`} alt={meta.label} className="media-store-icon" />
    </button>
  );
}
