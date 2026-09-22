import type { ParsedCharacteristic } from './biography-parser';

export interface ExtractedVoiceActor {
  name: string;
  language: string;
  externalId?: string;
  native?: string;
  image?: string;
  matchedFrom?: 'db' | 'anilist' | 'tmdb' | 'none';
}

export interface FandomCharacterData {
  wikiName: string;
  pageTitle: string;
  name: string;
  nativeName: string | null;
  imageUrl: string | null;
  imageOptions: Array<{ title: string; url: string; previewUrl: string }>;
  aliases: string[];
  characteristics: ParsedCharacteristic[];
  cleanBiography: string;
  voiceActors: ExtractedVoiceActor[];
  appearsIn: string | null;
}

export interface FandomUrlParts {
  subdomain: string;
  lang?: string;
  pageTitle: string;
}

export function parseFandomUrl(url: string): FandomUrlParts {
  const trimmed = url.trim();
  const match = trimmed.match(/^https?:\/\/([a-zA-Z0-9-]+)\.(?:fandom|wikia)\.com(?:\/([a-z]{2}(?:-[a-z]{2})?))?\/wiki\/([^?#]+)/i);

  if (!match) {
    throw new Error('URL de Fandom no válida. Formato esperado: https://<wiki>.fandom.com/wiki/<Página>');
  }

  return {
    subdomain: match[1].toLowerCase(),
    lang: match[2]?.toLowerCase(),
    pageTitle: decodeURIComponent(match[3]).replace(/_/g, ' '),
  };
}

export function cleanFandomImageUrl(rawUrl: string): string {
  if (!rawUrl) return '';
  let clean = rawUrl
    .replace(/\/scale-to-width(?:-down)?\/\d+/gi, '')
    .replace(/\/scale-to-height(?:-down)?\/\d+/gi, '')
    .replace(/\/zoom-crop\/\d+\/\d+/gi, '');

  const cbMatch = clean.match(/(\/revision\/latest(?:\?cb=\d+)?)/i);
  if (cbMatch) {
    const base = clean.split(/\/revision\/latest/i)[0];
    return `${base}${cbMatch[1]}`;
  }
  return clean.split('?')[0];
}

function fandomImageFilename(value: string): string {
  const imageSegment = value
    .split(/[?#]/, 1)[0]
    .split('/')
    .reverse()
    .map(segment => {
      try { return decodeURIComponent(segment); } catch { return segment; }
    })
    .find(segment => /\.(?:jpe?g|png|webp|avif|bmp|svg|tiff?|gif)$/i.test(segment));
  return (imageSegment ?? '').replace(/^file:/i, '').replace(/_/g, ' ').toLocaleLowerCase();
}

function imageHasTransparency(url: string): Promise<boolean> {
  if (typeof Image === 'undefined' || typeof document === 'undefined') return Promise.resolve(false);

  return new Promise(resolve => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 48;
        canvas.height = 48;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) return resolve(false);
        context.drawImage(image, 0, 0, 48, 48);
        const pixels = context.getImageData(0, 0, 48, 48).data;
        for (let alphaIndex = 3; alphaIndex < pixels.length; alphaIndex += 4) {
          if (pixels[alphaIndex] < 255) return resolve(true);
        }
        resolve(false);
      } catch {
        // Without CORS permission the browser cannot expose remote pixel data.
        resolve(false);
      }
    };
    image.onerror = () => resolve(false);
    image.src = url;
  });
}

const FANDOM_LANGUAGE_NAMES: Array<[RegExp, string]> = [
  [/\b(?:japanese|japan|jp)\b/i, 'Japanese'],
  [/\b(?:english|eng|en)\b/i, 'English'],
  [/\b(?:french|francais|fr)\b/i, 'French'],
  [/\b(?:spanish|espanol|castilian|es)\b/i, 'Spanish'],
  [/\b(?:german|deutsch|de)\b/i, 'German'],
  [/\b(?:italian|italiano|it)\b/i, 'Italian'],
  [/\b(?:portuguese|portugues|pt)(?:\s*\((?:european|brazilian)\))?|\b(?:european|brazilian)\s+portuguese\b/i, 'Portuguese'],
  [/\b(?:korean|kr)\b/i, 'Korean'],
  [/\b(?:chinese|mandarin|cantonese|zh)\b/i, 'Chinese'],
  [/\bgreek\b/i, 'Greek'],
  [/\bturkish\b/i, 'Turkish'],
  [/\bpolish\b/i, 'Polish'],
  [/\brussian\b/i, 'Russian'],
];

// Infobox group headers too generic to be worth tagging a field with (a
// "Height [Physical information]" label reads worse than plain "Height").
const GENERIC_INFOBOX_HEADERS = new Set([
  'biographical information', 'biographical info', 'biography', 'información biográfica',
  'personal information', 'personal info', 'información personal',
  'physical information', 'physical info', 'información física',
  'physical description', 'descripción física',
  'career and family information', 'career & family information',
  'career information', 'family information',
  'behind the scenes', 'detrás de las cámaras',
  'general information', 'general info', 'información general',
  'appearance', 'apariencia', 'portrayal',
  'voice actors', 'actores de voz',
  'production information', 'overview', 'profile',
]);

function stripDiacritics(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function detectFandomLanguage(value: string): string | undefined {
  return FANDOM_LANGUAGE_NAMES.find(([pattern]) => pattern.test(stripDiacritics(value)))?.[1];
}

function normalizeVoiceLanguage(annotation: string | undefined, fallback: string): string {
  if (!annotation) return fallback;
  return detectFandomLanguage(annotation) ?? annotation.trim();
}

// Fandom's Portable Infobox pairs an on-hover "explain" tooltip (native
// `title=` attribute on a `.explain` span) with an invisible screen-reader
// duplicate of that same note text (`<span style="display: none;"> (...)
// </span>`), plus a "?" help-icon `<sup>` link pointing at the wiki's own
// explanation page - none of which ever renders as visible running text on
// the live wiki page, but `.textContent`/`.innerHTML` don't know that (CSS
// `display:none` is invisible to both) and were pulling all of it in
// verbatim, e.g. turning the label "Reckoned birth year(s)" into "Reckoned
// birth year(s) (this is for age comparison purposes, and so may look odd;
// click on the question mark for details)?". Mutates in place - always
// called on values already local to this parse (never the live page's own
// DOM), so mutating instead of cloning is safe and avoids the extra copy.
function stripHiddenNoise(el: Element): void {
  el.querySelectorAll('sup, [style*="display: none" i], [style*="display:none" i], .reference, .cite-bracket')
    .forEach(n => n.remove());
}

function parseVoiceActorsFromHtml(html: string, defaultLanguage: string): ExtractedVoiceActor[] {
  const separated = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:li|p|div|tr)\s*>/gi, '\n')
    .replace(/<(?:li|p|div|tr)\b[^>]*>/gi, '');
  const parsed = new DOMParser().parseFromString(separated, 'text/html');
  stripHiddenNoise(parsed.body);

  const actors: ExtractedVoiceActor[] = [];
  const lines = (parsed.body.textContent ?? '').split(/[\r\n]+/).map(line => line.trim()).filter(Boolean);

  for (const line of lines) {
    const annotations: string[] = [];
    let name = line.replace(/\[\s*\d+\s*\]/g, '').trim();
    const prefixedLanguage = name.match(/^([\p{L} ]+)\s*[:\-–]\s*(.+)$/u);
    if (prefixedLanguage && FANDOM_LANGUAGE_NAMES.some(([pattern]) => pattern.test(prefixedLanguage[1].trim()))) {
      annotations.push(prefixedLanguage[1].trim());
      name = prefixedLanguage[2].trim();
    }
    let annotationMatch: RegExpExecArray | null;
    while ((annotationMatch = /\s*\(([^()]*)\)\s*$/.exec(name))) {
      annotations.unshift(annotationMatch[1].trim());
      name = name.slice(0, annotationMatch.index).trim();
    }
    const languageAnnotation = annotations.find(annotation => !!detectFandomLanguage(annotation));

    // Some Fandom pages put the actor link and its language annotation on
    // separate lines. Attach a recognized annotation-only line to the actor
    // immediately before it instead of dropping it and keeping the fallback.
    if (!name) {
      const previousActor = actors[actors.length - 1];
      if (previousActor && languageAnnotation) {
        previousActor.language = normalizeVoiceLanguage(languageAnnotation, defaultLanguage);
      }
      continue;
    }

    const language = normalizeVoiceLanguage(languageAnnotation, defaultLanguage);
    actors.push({ name, language });
  }

  return actors;
}

function addUniqueVoiceActors(target: ExtractedVoiceActor[], incoming: ExtractedVoiceActor[]): void {
  for (const actor of incoming) {
    if (!target.some(v => v.name.toLowerCase() === actor.name.toLowerCase() && v.language === actor.language)) {
      target.push(actor);
    }
  }
}

function extractVoicedBySections(doc: Document, defaultLanguage: string): ExtractedVoiceActor[] {
  const actors: ExtractedVoiceActor[] = [];
  const headings = Array.from(doc.querySelectorAll<HTMLElement>('h2, h3, h4, h5, h6'));
  for (const heading of headings) {
    const headingText = (heading.textContent ?? '').replace(/\[edit\]/gi, '').replace(/\s+/g, ' ').trim();
    if (!/^(?:voiced by|voice actors?|voice cast|voice acting|voice talent|voice performances)\b/i.test(headingText)) continue;
    const level = Number(heading.tagName.slice(1));
    const headingBlock = heading.closest<HTMLElement>('.mw-heading') ?? heading;
    let sectionLanguage = defaultLanguage;
    let sectionHtml: string[] = [];
    const flushSection = () => {
      if (sectionHtml.length > 0) {
        actors.push(...parseVoiceActorsFromHtml(sectionHtml.join('\n'), sectionLanguage));
        sectionHtml = [];
      }
    };
    let sibling = headingBlock.nextElementSibling;
    while (sibling) {
      const nextHeading = sibling.matches('h1, h2, h3, h4, h5, h6')
        ? sibling
        : sibling.querySelector('h1, h2, h3, h4, h5, h6');
      if (nextHeading && Number(nextHeading.tagName.slice(1)) <= level) break;
      if (nextHeading) {
        const detectedLanguage = detectFandomLanguage((nextHeading.textContent || '').trim());
        if (detectedLanguage) {
          flushSection();
          sectionLanguage = detectedLanguage;
        }
        // Some Fandom skins/API responses wrap a language heading and its
        // actor list in the same container. Keep that content after removing
        // the heading instead of discarding the entire wrapper.
        const content = sibling.cloneNode(true) as HTMLElement;
        content.querySelectorAll('h1, h2, h3, h4, h5, h6, .mw-editsection').forEach(node => node.remove());
        if (content.textContent?.trim()) sectionHtml.push(content.innerHTML);
      } else {
        sectionHtml.push(sibling.outerHTML);
      }
      sibling = sibling.nextElementSibling;
    }
    flushSection();
  }
  return actors;
}

export async function fetchFandomCharacter(url: string): Promise<FandomCharacterData> {
  const { subdomain, lang, pageTitle } = parseFandomUrl(url);

  const prefix = lang ? `${encodeURIComponent(lang)}/` : '';
  const apiUrl = `https://${subdomain}.fandom.com/${prefix}api.php?action=parse&page=${encodeURIComponent(pageTitle)}&prop=text|properties|images&format=json&origin=*`;

  const response = await fetch(apiUrl);
  if (!response.ok) {
    throw new Error(`Error en la consulta a Fandom (HTTP ${response.status})`);
  }

  const json = await response.json();
  if (json.error || !json.parse) {
    throw new Error(json.error?.info || 'No se pudo encontrar la página en Fandom');
  }

  const rawHtml = json.parse.text?.['*'] || '';
  const parser = new DOMParser();
  const doc = parser.parseFromString(rawHtml, 'text/html');

  let name = doc.querySelector('.portable-infobox .pi-title')?.textContent?.trim()
    || json.parse.title
    || pageTitle;

  // Extraer imagen principal de alta resolución
  let imageUrl: string | null = null;
  const imgEl = doc.querySelector<HTMLImageElement>(
    '.portable-infobox figure.pi-image img, .portable-infobox .pi-image-thumbnail, .portable-infobox img, .infobox img'
  );
  if (imgEl) {
    const rawSrc = imgEl.getAttribute('data-src') || imgEl.getAttribute('src') || '';
    if (rawSrc) {
      imageUrl = cleanFandomImageUrl(rawSrc);
    }
  }

function formatCharacteristicItem(html: string): string {
  let clean = html
    .replace(/<img[^>]*>/gi, '')
    .replace(/<\/?(?:span|p|div|a|b|strong)[^>]*>/gi, '')
    .trim();

  if (!clean.includes('<small>')) {
    clean = clean.replace(/\s*(\([^)]{1,40}\))/g, ' <small>$1</small>');
  }
  return clean.replace(/\s+/g, ' ').trim();
}

function normalizeImportedFieldText(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase();
}

function formatCharacteristicLabel(rawLabel: string, sectionHeader?: string): string {
  const cleanLabel = rawLabel.replace(/<[^>]+>/g, '').trim();
  if (!sectionHeader) return cleanLabel;

  const cleanHeader = sectionHeader
    .replace(/<[^>]+>/g, '')
    .replace(/&#32;/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleanHeader) return cleanLabel;

  if (GENERIC_INFOBOX_HEADERS.has(cleanHeader.toLowerCase())) return cleanLabel;

  const cleanHeaderNoColon = cleanHeader.replace(/[:：\s]+$/, '').trim();
  const parenMatch = cleanHeaderNoColon.match(/\(([^)]+)\)$/);
  const colonMatch = cleanHeaderNoColon.match(/[:–—\-]\s*(.+)$/);

  let tag = cleanHeaderNoColon;
  if (parenMatch) {
    tag = parenMatch[1].trim();
  } else if (colonMatch) {
    tag = colonMatch[1].trim();
  }
  tag = tag.replace(/[:：\s]+$/, '').trim();

  if (!cleanLabel.includes('[') && tag) {
    return `${cleanLabel} [${tag}]`;
  }

  return cleanLabel;
}

  // Parsear campos del Infobox usando patrones estructurales y semánticos universales
  const characteristics: ParsedCharacteristic[] = [];
  const seenCharacteristicValues = new Map<string, Set<string>>();
  const voiceActors: ExtractedVoiceActor[] = [];
  let aliases: string[] = [];
  let nativeName: string | null = null;
  let appearsIn: string | null = null;

  const dataItems = doc.querySelectorAll(
    '[data-source], .portable-infobox .pi-item.pi-data, aside .pi-data, aside [class*="item"], table.infobox tr, [class*="infobox"] tr, dl.infobox, .pi-item.pi-data'
  );
  const seenElements = new Set<Element>();

  dataItems.forEach(el => {
    if (seenElements.has(el)) return;
    if (el.matches('figure, .pi-image, .pi-title, .pi-header, [data-source="image"], [data-source="name"], [data-source="title"]')) {
      return;
    }

    let label = '';
    let valEl: Element | null = null;

    if (el.matches('[data-source], .pi-item.pi-data, aside .pi-data, aside [class*="item"]')) {
      const labelEl = el.querySelector('.pi-data-label, [class*="label"], dt, b, strong');
      valEl = el.querySelector('.pi-data-value, [class*="value"], dd');
      if (!valEl && labelEl && labelEl.nextElementSibling) {
        valEl = labelEl.nextElementSibling;
      }
      if (labelEl) stripHiddenNoise(labelEl);
      label = labelEl?.textContent?.trim() || '';
    } else if (el.matches('tr')) {
      const labelEl = el.querySelector('th, td:first-child');
      valEl = el.querySelector('td:last-child');
      if (labelEl === valEl) valEl = null;
      if (labelEl) stripHiddenNoise(labelEl);
      label = labelEl?.textContent?.trim() || '';
    } else if (el.matches('dl')) {
      const labelEl = el.querySelector('dt');
      valEl = el.querySelector('dd');
      if (labelEl) stripHiddenNoise(labelEl);
      label = labelEl?.textContent?.trim() || '';
    }

    if (!label || !valEl) return;
    seenElements.add(el);

    let headerText = '';
    const group = el.closest('.pi-group, section, aside, table, div[class*="infobox"]');
    if (group) {
      headerText = group.querySelector('.pi-header, caption, th[colspan], h2, h3')?.textContent || '';
    }

    const finalLabel = formatCharacteristicLabel(label, headerText);

    stripHiddenNoise(valEl);

    const sourceAttr = (el.getAttribute('data-source') || '').toLowerCase();
    const normLabel = label.toLowerCase();
    const normalizedNameLabel = normLabel.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').replace(/[:：]\s*$/, '').trim();
    const normalizedNameSource = sourceAttr.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    const isNativeNameLabel = /^(?:(?:jp|japanese|native) name(?:\s+\([^)]*\))?|name (?:in )?(?:jp|japanese)(?:\s+\([^)]*\))?|name \((?:jp|japanese)\))$/i;
    const isNativeNameField = isNativeNameLabel.test(normalizedNameLabel) || isNativeNameLabel.test(normalizedNameSource);
    const isOtherNamesField = sourceAttr === 'other_name' || sourceAttr === 'other_names' || /\bother names?\b/i.test(label);
    const valHtml = valEl.innerHTML;

    const lis = valEl.querySelectorAll('li');
    let cleanVal = '';
    if (lis.length > 0) {
      cleanVal = Array.from(lis)
        .map(li => formatCharacteristicItem(li.innerHTML))
        .filter(Boolean)
        .join('<br>');
    } else {
      // <hr> is Fandom's own separator between an infobox field's distinct
      // values (e.g. Occupation: "Law student <hr> Prosecutor (...)") —
      // treated as a line break just like <br>/<p>/<div>, not left as a
      // literal tag glued into one line's text.
      const rawLines = valHtml
        .replace(/<(?:br|hr)\s*\/?>/gi, '\n')
        .replace(/<\/?(?:p|div)[^>]*>/gi, '\n')
        .split('\n')
        .map(l => formatCharacteristicItem(l))
        .filter(Boolean);
      cleanVal = rawLines.join('<br>');
    }

    if (
      sourceAttr === 'aliases' || sourceAttr === 'alias' || isOtherNamesField ||
      normLabel.includes('alias') || normLabel.includes('aliases')
    ) {
      let rawParts: string[];
      if (lis.length > 0) {
        rawParts = Array.from(lis).map(li => li.textContent?.trim() || '').filter(Boolean);
      } else {
        const plain = cleanVal
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<[^>]+>/g, '')
          .trim();
        rawParts = plain.split(/[,;\n]/).map(s => s.trim()).filter(Boolean);
      }
      const parts = rawParts
        .map(value => (isOtherNamesField ? value.replace(/\([^)]*\)/g, '') : value).replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      const existingAliases = new Set(aliases.map(alias => alias.toLocaleLowerCase()));
      for (const alias of parts) {
        const key = alias.toLocaleLowerCase();
        if (!existingAliases.has(key)) {
          aliases.push(alias);
          existingAliases.add(key);
        }
      }
    } else if (isNativeNameField) {
      nativeName = (valEl.textContent || '').replace(/\s+/g, ' ').trim() || null;
    } else if (
      sourceAttr === 'voiced_by' || sourceAttr === 'voice_actor' || sourceAttr === 'voice_actors' || sourceAttr === 'voiceactor' ||
      sourceAttr === 'voice_cast' || sourceAttr === 'voices' || sourceAttr === 'voice_acting' ||
      sourceAttr.startsWith('voice_actor_') || sourceAttr.startsWith('voiced_by_') ||
      sourceAttr === 'seiyuu' || sourceAttr === 'seiyu' ||
      sourceAttr === 'japanese_va' || sourceAttr === 'english_va' ||
      normLabel.includes('voiced by') || normLabel.includes('voice actor') || normLabel.includes('voice cast') || normLabel.includes('voice acting') || normLabel.includes('actor de voz') ||
      normLabel.includes('seiyuu') || normLabel.includes('seiyu')
    ) {
      let defaultLang = 'Japanese';
      if (
        sourceAttr === 'voiceactor' || sourceAttr === 'english_va' || sourceAttr.includes('english') || sourceAttr.endsWith('_en') ||
        normLabel === 'voice actor' || normLabel.includes('english') || normLabel.includes('inglés')
      ) {
        defaultLang = 'English';
      } else if (
        sourceAttr === 'seiyuu' || sourceAttr === 'seiyu' || sourceAttr === 'japanese_va' || sourceAttr.includes('japanese') || sourceAttr.endsWith('_jp') || sourceAttr.endsWith('_ja') ||
        normLabel.includes('seiyuu') || normLabel.includes('seiyu') || normLabel.includes('japanese') || normLabel.includes('japonés')
      ) {
        defaultLang = 'Japanese';
      }

      addUniqueVoiceActors(voiceActors, parseVoiceActorsFromHtml(valHtml, defaultLang));
    } else if (sourceAttr === 'appears_in' || sourceAttr === 'appearances' || sourceAttr === 'debut' || normLabel.includes('appears in') || normLabel.includes('aparición')) {
      if (!appearsIn) appearsIn = cleanVal;
    } else if (sourceAttr === 'image' || sourceAttr === 'name' || sourceAttr === 'title') {
      // Ignorar campos ya resueltos
    } else {
      const normalizedLabel = normalizeImportedFieldText(finalLabel);
      const normalizedValue = normalizeImportedFieldText(cleanVal);
      const seenValues = seenCharacteristicValues.get(normalizedLabel) ?? new Set<string>();
      if (seenValues.has(normalizedValue)) return;
      seenValues.add(normalizedValue);
      seenCharacteristicValues.set(normalizedLabel, seenValues);

      const existingIndex = characteristics.findIndex(item =>
        normalizeImportedFieldText(item.label) === normalizedLabel
      );
      if (existingIndex === -1) {
        characteristics.push({ label: finalLabel, value: cleanVal });
      } else {
        characteristics[existingIndex] = {
          ...characteristics[existingIndex],
          value: `${characteristics[existingIndex].value}<br>${cleanVal}`,
        };
      }
    }
  });

  addUniqueVoiceActors(voiceActors, extractVoicedBySections(doc, 'Japanese'));

  const imageTitleSet = new Set<string>(Array.isArray(json.parse.images)
    ? (json.parse.images as string[]).filter(title => typeof title === 'string')
    : []);
  // Character pages often keep the full-size/alternate portraits on a
  // companion Gallery:<title> page, which is not included in parse.images
  // for the character page itself.
  try {
    const galleryParams = new URLSearchParams({
      action: 'parse',
      page: `Gallery:${pageTitle}`,
      prop: 'images',
      format: 'json',
      origin: '*',
    });
    const galleryResponse = await fetch(`https://${subdomain}.fandom.com/${prefix}api.php?${galleryParams}`);
    if (galleryResponse.ok) {
      const galleryJson = await galleryResponse.json();
      const galleryTitles = galleryJson.parse?.images;
      if (Array.isArray(galleryTitles)) {
        galleryTitles.filter((title: unknown): title is string => typeof title === 'string').forEach((title: string) => imageTitleSet.add(title));
      }
    }
  } catch {
    // Gallery pages are optional; keep the character page's images available.
  }
  const imageTitles = [...imageTitleSet];
  let imageOptions: FandomCharacterData['imageOptions'] = [];
  if (imageTitles.length > 0) {
    try {
      for (let offset = 0; offset < imageTitles.length; offset += 50) {
        const imageParams = new URLSearchParams({
          action: 'query',
          titles: imageTitles.slice(offset, offset + 50).map(title => title.startsWith('File:') ? title : `File:${title}`).join('|'),
          prop: 'imageinfo',
          iiprop: 'url|size',
          iiurlwidth: '300',
          format: 'json',
          origin: '*',
        });
        const imageResponse = await fetch(`https://${subdomain}.fandom.com/${prefix}api.php?${imageParams}`);
        if (!imageResponse.ok) continue;
        const imageJson = await imageResponse.json();
        imageOptions.push(...Object.values(imageJson.query?.pages ?? {})
          .flatMap((page: any) => {
            const imageInfo = page.imageinfo?.[0];
            const resolvedUrl = imageInfo?.url;
            const meetsMinimumSize = imageInfo?.width >= 100 && imageInfo?.height >= 100;
            const imageMime = String(imageInfo?.mime ?? '').toLowerCase();
            const imageFile = String(page.title ?? resolvedUrl ?? '').split(/[?#]/, 1)[0].toLowerCase();
            const isGif = /\.gif$/i.test(imageFile) || imageMime === 'image/gif';
            const isImage = imageMime ? imageMime.startsWith('image/') : /\.(?:jpe?g|png|webp|avif|bmp|svg|tiff?)$/i.test(imageFile);
            const previewUrl = imageInfo.thumburl || resolvedUrl;
            return resolvedUrl && meetsMinimumSize && isImage && !isGif ? [{
              title: page.title || '',
              // Fandom's original `/revision/latest` URLs can return 404 even
              // when its API thumbnail URL is valid; use that same served
              // image for preview and selection.
              url: previewUrl,
              previewUrl,
            }] : [];
          }));
      }
    } catch {
      // La imagen principal sigue disponible aunque la consulta de la galería falle.
    }
  }
  // Do not inject the infobox thumbnail as a fallback: it may be an icon or
  // other sub-100px image that was intentionally filtered from the selector.
  const transparencyFlags: boolean[] = [];
  for (let offset = 0; offset < imageOptions.length; offset += 8) {
    const batch = imageOptions.slice(offset, offset + 8);
    transparencyFlags.push(...await Promise.all(batch.map(option => imageHasTransparency(option.previewUrl))));
  }
  imageOptions = imageOptions
    .map((option, index) => ({ option, isTransparent: transparencyFlags[index] }))
    .sort((a, b) => Number(a.isTransparent) - Number(b.isTransparent))
    .map(({ option }) => option);
  if (imageUrl) {
    const infoboxFilename = fandomImageFilename(imageUrl);
    const matchingOption = imageOptions.find(option => fandomImageFilename(option.title) === infoboxFilename);
    if (matchingOption) imageUrl = matchingOption.url;
  } else if (imageOptions[0]) {
    imageUrl = imageOptions[0].url;
  }

  // Extraer biografía limpia eliminando todo elemento de infobox o ficha lateral
  const contentRoot = doc.querySelector('.mw-parser-output') || doc.body;
  contentRoot.querySelectorAll(
    'aside, [data-source], .portable-infobox, [class*="infobox"], table.infobox, table.navbox, .navbox, #toc, .toc, .mw-editsection, .reference, sup, script, style, .gallery, .wikia-gallery, figcaption, .thumbcaption, .thumb, figure, .page-header, .page-footer, [style*="display: none" i], [style*="display:none" i]'
  ).forEach(n => n.remove());

  const bioParagraphs: string[] = [];
  const paragraphs = contentRoot.querySelectorAll('p');
  for (const p of Array.from(paragraphs)) {
    p.querySelectorAll('sup, .reference, .mw-editsection').forEach(s => s.remove());
    p.querySelectorAll('a').forEach(a => {
      a.replaceWith(document.createTextNode(a.textContent || ''));
    });

    const cleanText = (p.textContent || '').replace(/\[\d+\]/g, '').trim();
    if (
      cleanText.length > 25 &&
      !cleanText.toLowerCase().startsWith('for other uses') &&
      !cleanText.toLowerCase().startsWith('see also')
    ) {
      // Si un párrafo es puramente un par clave-valor que se coló, extráelo a características
      const colonMatch = cleanText.match(/^([A-Za-zÀ-ÿ\s/()_-]{2,35}):\s*(.+)$/);
      if (colonMatch && colonMatch[2].trim().length < 150 && !colonMatch[2].includes('.')) {
        const fallbackLabel = colonMatch[1].trim();
        const fallbackVal = colonMatch[2].trim();
        if (!characteristics.some(c => c.label.toLowerCase() === fallbackLabel.toLowerCase())) {
          characteristics.push({ label: fallbackLabel, value: fallbackVal });
        }
        continue;
      }

      bioParagraphs.push(`<p>${cleanText}</p>`);
    }
    if (bioParagraphs.length >= 8) break;
  }

  const cleanBiography = bioParagraphs.join('\n');

  return {
    wikiName: subdomain,
    pageTitle,
    name,
    nativeName,
    imageUrl,
    imageOptions,
    aliases,
    characteristics,
    cleanBiography,
    voiceActors,
    appearsIn,
  };
}
