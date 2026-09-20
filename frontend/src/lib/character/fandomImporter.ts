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
  imageUrl: string | null;
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

function normalizeVoiceLanguage(annotation: string | undefined, fallback: string): string {
  if (!annotation) return fallback;
  const normalized = annotation.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return FANDOM_LANGUAGE_NAMES.find(([pattern]) => pattern.test(normalized))?.[1] ?? annotation.trim();
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
    let annotationMatch: RegExpExecArray | null;
    while ((annotationMatch = /\s*\(([^()]*)\)\s*$/.exec(name))) {
      annotations.unshift(annotationMatch[1].trim());
      name = name.slice(0, annotationMatch.index).trim();
    }
    const languageAnnotation = annotations.find(annotation => {
      const normalized = annotation.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      return FANDOM_LANGUAGE_NAMES.some(([pattern]) => pattern.test(normalized));
    });

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

function extractVoicedBySections(doc: Document, defaultLanguage: string): ExtractedVoiceActor[] {
  const actors: ExtractedVoiceActor[] = [];
  const headings = Array.from(doc.querySelectorAll<HTMLElement>('h2, h3, h4, h5, h6'));
  for (const heading of headings) {
    if (!/^(?:voiced by|voice actors?|voice cast|voice acting)\b/i.test(heading.textContent?.trim() ?? '')) continue;
    const level = Number(heading.tagName.slice(1));
    const headingBlock = heading.closest<HTMLElement>('.mw-heading') ?? heading;
    const html: string[] = [];
    let sibling = headingBlock.nextElementSibling;
    while (sibling) {
      const nextHeading = sibling.matches('h1, h2, h3, h4, h5, h6')
        ? sibling
        : sibling.querySelector('h1, h2, h3, h4, h5, h6');
      if (nextHeading && Number(nextHeading.tagName.slice(1)) <= level) break;
      html.push(sibling.outerHTML);
      sibling = sibling.nextElementSibling;
    }
    actors.push(...parseVoiceActorsFromHtml(html.join('\n'), defaultLanguage));
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

  const lowerHeader = cleanHeader.toLowerCase();
  if (
    lowerHeader === 'biographical information' ||
    lowerHeader === 'biographical info' ||
    lowerHeader === 'biography' ||
    lowerHeader === 'información biográfica' ||
    lowerHeader === 'personal information' ||
    lowerHeader === 'personal info' ||
    lowerHeader === 'información personal' ||
    lowerHeader === 'physical information' ||
    lowerHeader === 'physical info' ||
    lowerHeader === 'información física' ||
    lowerHeader === 'physical description' ||
    lowerHeader === 'descripción física' ||
    lowerHeader === 'career and family information' ||
    lowerHeader === 'career & family information' ||
    lowerHeader === 'career information' ||
    lowerHeader === 'family information' ||
    lowerHeader === 'behind the scenes' ||
    lowerHeader === 'detrás de las cámaras' ||
    lowerHeader === 'general information' ||
    lowerHeader === 'general info' ||
    lowerHeader === 'información general' ||
    lowerHeader === 'appearance' ||
    lowerHeader === 'apariencia' ||
    lowerHeader === 'portrayal' ||
    lowerHeader === 'voice actors' ||
    lowerHeader === 'actores de voz' ||
    lowerHeader === 'production information' ||
    lowerHeader === 'overview' ||
    lowerHeader === 'profile'
  ) {
    return cleanLabel;
  }

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
    } else if (
      sourceAttr === 'voiced_by' || sourceAttr === 'voice_actor' || sourceAttr === 'voiceactor' ||
      sourceAttr === 'seiyuu' || sourceAttr === 'seiyu' ||
      sourceAttr === 'japanese_va' || sourceAttr === 'english_va' ||
      normLabel.includes('voiced by') || normLabel.includes('voice actor') || normLabel.includes('actor de voz') ||
      normLabel.includes('seiyuu') || normLabel.includes('seiyu')
    ) {
      let defaultLang = 'Japanese';
      if (
        sourceAttr === 'voiceactor' || sourceAttr === 'english_va' ||
        normLabel === 'voice actor' || normLabel.includes('english') || normLabel.includes('inglés')
      ) {
        defaultLang = 'English';
      } else if (
        sourceAttr === 'seiyuu' || sourceAttr === 'seiyu' || sourceAttr === 'japanese_va' ||
        normLabel.includes('seiyuu') || normLabel.includes('seiyu') || normLabel.includes('japanese') || normLabel.includes('japonés')
      ) {
        defaultLang = 'Japanese';
      }

      for (const actor of parseVoiceActorsFromHtml(valHtml, defaultLang)) {
        if (!voiceActors.some(v => v.name.toLowerCase() === actor.name.toLowerCase() && v.language === actor.language)) {
          voiceActors.push(actor);
        }
      }
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

  for (const actor of extractVoicedBySections(doc, 'Japanese')) {
    if (!voiceActors.some(v => v.name.toLowerCase() === actor.name.toLowerCase() && v.language === actor.language)) {
      voiceActors.push(actor);
    }
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
    imageUrl,
    aliases,
    characteristics,
    cleanBiography,
    voiceActors,
    appearsIn,
  };
}
