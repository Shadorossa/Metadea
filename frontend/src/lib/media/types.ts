// Interfaz normalizada que consume buildMediaHtml, independiente del proveedor

export interface MediaStat {
  label: string;
  value: string;
}

export interface MediaCharacter {
  name: string;
  image?: string;
  role?: string;
}

export interface MediaRelation {
  typeLabel: string;
  title: string;
  cover?: string;
  url?: string;
}

export interface MediaPageData {
  externalId: string;          // "anime:918", "book:/works/OL12345W"
  type: string;                // "anime" | "manga" | "novel" | "book"
  titleMain: string;
  titleNative?: string;
  titleEnglish?: string;
  cover?: string;
  bannerImage?: string;
  bannerColor: string;         // CSS gradient para el placeholder del banner
  statusLabel?: string;
  statusClass?: string;        // clase CSS del badge de estado
  genreDots?: string;          // "Action · Comedy · Drama"
  metaLines: string[];         // líneas del panel derecho (estudio, formato, etc.)
  dateBadge?: string;          // overlay sobre el banner con fechas
  description?: string;
  stats: MediaStat[];
  characters: MediaCharacter[];
  relations: MediaRelation[];
  progressStatus: 'watching' | 'reading' | 'playing';
  progressLabel: string;       // label i18n del botón de progreso en el tray
}
