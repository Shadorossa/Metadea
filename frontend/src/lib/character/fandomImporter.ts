import type { ParsedCharacteristic } from './biography-parser';

export interface ExtractedVoiceActor {
  name: string;
  language: string;
  externalId?: string;
  native?: string;
  image?: string;
  matchedFrom?: 'db' | 'anilist' | 'none';
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
    .replace(/<\/?(?:span|p|div|a)[^>]*>/gi, '')
    .replace(/<\/?sup[^>]*>/gi, m => m.startsWith('</') ? '</small>' : '<small>')
    .trim();

  if (!clean.includes('<small>')) {
    clean = clean.replace(/\s*(\([^)]{1,40}\))/g, ' <small>$1</small>');
  }
  return clean.replace(/\s+/g, ' ').trim();
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
    lowerHeader === 'general information' ||
    lowerHeader === 'general info' ||
    lowerHeader === 'información general' ||
    lowerHeader === 'appearance' ||
    lowerHeader === 'apariencia' ||
    lowerHeader === 'portrayal' ||
    lowerHeader === 'voice actors'
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

  // Parsear campos del Infobox
  const characteristics: ParsedCharacteristic[] = [];
  const voiceActors: ExtractedVoiceActor[] = [];
  let aliases: string[] = [];
  let appearsIn: string | null = null;

  const dataItems = doc.querySelectorAll('.portable-infobox .pi-item.pi-data, table.infobox tr');
  dataItems.forEach(el => {
    let label = '';
    const valEl = el.matches('.pi-item.pi-data')
      ? el.querySelector('.pi-data-value')
      : el.querySelector('td');

    if (el.matches('.pi-item.pi-data')) {
      label = el.querySelector('.pi-data-label')?.textContent?.trim() || '';
    } else {
      label = el.querySelector('th')?.textContent?.trim() || '';
    }

    if (!label || !valEl) return;

    let headerText = '';
    if (el.matches('.pi-item.pi-data')) {
      const group = el.closest('.pi-group, section');
      if (group) {
        headerText = group.querySelector('.pi-header, h2, h3')?.textContent || '';
      }
    } else {
      let prev = el.previousElementSibling;
      while (prev) {
        const headerTh = prev.querySelector('th[colspan]');
        if (headerTh) {
          headerText = headerTh.textContent || '';
          break;
        }
        prev = prev.previousElementSibling;
      }
    }

    const finalLabel = formatCharacteristicLabel(label, headerText);

    valEl.querySelectorAll('.reference, .cite-bracket, sup.reference').forEach(r => r.remove());
    valEl.querySelectorAll('sup').forEach(sup => {
      const txt = sup.textContent?.trim() || '';
      if (/^\[\d+\]$/.test(txt) || sup.classList.contains('reference') || sup.querySelector('a[href*="#cite"]')) {
        sup.remove();
      }
    });

    const sourceAttr = (el.getAttribute('data-source') || '').toLowerCase();
    const normLabel = label.toLowerCase();
    const valHtml = valEl.innerHTML;

    const lis = valEl.querySelectorAll('li');
    let cleanVal = '';
    if (lis.length > 0) {
      cleanVal = Array.from(lis)
        .map(li => formatCharacteristicItem(li.innerHTML))
        .filter(Boolean)
        .join('<br>');
    } else {
      const rawLines = valHtml
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/?(?:p|div)[^>]*>/gi, '\n')
        .split('\n')
        .map(l => formatCharacteristicItem(l))
        .filter(Boolean);
      cleanVal = rawLines.join('<br>');
    }

    if (sourceAttr === 'aliases' || sourceAttr === 'alias' || normLabel.includes('alias') || normLabel.includes('aliases')) {
      if (lis.length > 0) {
        const parts = Array.from(lis).map(li => li.textContent?.trim() || '').filter(Boolean);
        aliases = Array.from(new Set([...aliases, ...parts]));
      } else {
        const plain = cleanVal.replace(/<[^>]+>/g, '').trim();
        const parts = plain.split(/[,;\n]/).map(s => s.trim()).filter(Boolean);
        aliases = Array.from(new Set([...aliases, ...parts]));
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

      const lines = valHtml
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/?(?:p|li|div)[^>]*>/gi, '\n')
        .split('\n');

      for (const rawLine of lines) {
        const clean = rawLine.replace(/<[^>]+>/g, '').trim();
        if (!clean) continue;

        const vaMatch = clean.match(/^(.+?)(?:\s*\(([^)]+)\))?$/);
        if (vaMatch) {
          const baseName = vaMatch[1].trim();
          const parenthetical = vaMatch[2]?.trim();

          let lang = defaultLang;
          let finalName = baseName;

          if (parenthetical) {
            const pLower = parenthetical.toLowerCase();
            if (pLower.includes('english') || pLower === 'en') {
              lang = 'English';
            } else if (pLower.includes('japanese') || pLower === 'jp' || pLower.includes('jap')) {
              lang = 'Japanese';
            } else if (pLower.includes('french') || pLower === 'fr') {
              lang = 'French';
            } else if (pLower.includes('spanish') || pLower === 'es') {
              lang = 'Spanish';
            } else if (pLower.includes('german') || pLower === 'de') {
              lang = 'German';
            } else if (pLower.includes('italian') || pLower === 'it') {
              lang = 'Italian';
            } else {
              finalName = `${baseName} (${parenthetical})`;
            }
          }

          if (finalName && !voiceActors.some(v => v.name.toLowerCase() === finalName.toLowerCase())) {
            voiceActors.push({ name: finalName, language: lang });
          }
        }
      }
    } else if (sourceAttr === 'appears_in' || sourceAttr === 'appearances' || sourceAttr === 'debut' || normLabel.includes('appears in') || normLabel.includes('aparición')) {
      if (!appearsIn) appearsIn = cleanVal;
    } else if (sourceAttr === 'image' || sourceAttr === 'name' || sourceAttr === 'title') {
      // Ignorar campos ya resueltos
    } else {
      characteristics.push({ label: finalLabel, value: cleanVal });
    }
  });

  // Extraer biografía limpia
  const contentRoot = doc.querySelector('.mw-parser-output') || doc.body;
  contentRoot.querySelectorAll(
    '.portable-infobox, table.infobox, table.navbox, .navbox, #toc, .toc, .mw-editsection, .reference, sup, script, style, .gallery, .wikia-gallery'
  ).forEach(n => n.remove());

  const bioParagraphs: string[] = [];
  const paragraphs = contentRoot.querySelectorAll('p');
  for (const p of Array.from(paragraphs)) {
    p.querySelectorAll('sup, .reference, .mw-editsection').forEach(s => s.remove());
    // Convertir enlaces internos en texto plano
    p.querySelectorAll('a').forEach(a => {
      a.replaceWith(document.createTextNode(a.textContent || ''));
    });
    const cleanText = (p.textContent || '').replace(/\[\d+\]/g, '').trim();
    if (cleanText.length > 25 && !cleanText.toLowerCase().startsWith('for other uses') && !cleanText.toLowerCase().startsWith('see also')) {
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
