// Splits a character's raw AniList-style biography HTML into the bold-label
// "characteristics" lines (e.g. "<b>Height:</b> 170 cm") and the remaining
// free-text description — same DOM-based parse the character detail page
// uses to render them in separate sections (pages/character.astro), shared
// here so the PR editor can show/save them the same way.

export interface ParsedCharacteristic {
  label: string;
  value: string;
}

export interface ParsedBiography {
  characteristics: ParsedCharacteristic[];
  /** Remaining biography HTML with the stat lines stripped out. */
  cleanBiography: string;
}

export function parseCharacterBiography(rawHtml: string | null | undefined): ParsedBiography {
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = rawHtml || '';

  const boldElements = tempDiv.querySelectorAll('b, strong');
  const characteristics: ParsedCharacteristic[] = [];
  const elementsToRemove: Node[] = [];

  for (const el of boldElements) {
    const label = (el.textContent || '').trim().replace(/:$/, '').trim();
    if (label.length > 30 || label.length < 2) continue;

    // A value can span several fragments — plain text followed by an
    // AniList spoiler span — so don't stop at the first text fragment,
    // only at a real block boundary (another tag, or a <br> once content
    // has already been accumulated).
    let nextNode: Node | null = el.nextSibling;
    const valueParts: string[] = [];

    while (nextNode) {
      if (nextNode.nodeType === Node.TEXT_NODE) {
        const txt = nextNode.textContent?.trim();
        if (txt) valueParts.push(txt);
      } else if (nextNode.nodeName === 'BR') {
        if (valueParts.length > 0) {
          nextNode = nextNode.nextSibling;
          break;
        }
      } else if (nextNode instanceof Element && nextNode.classList.contains('markdown_spoiler')) {
        // Editable text field, so just the text — see buildBiographyHtml
        // for why re-saving loses the spoiler wrapping on this one value.
        valueParts.push(nextNode.textContent || '');
      } else {
        break;
      }
      nextNode = nextNode.nextSibling;
    }

    const value = valueParts.join(' ').trim().replace(/^:\s*/, '').trim();
    if (value) {
      characteristics.push({ label, value });
      elementsToRemove.push(el);

      let toRemove = el.nextSibling;
      while (toRemove && toRemove !== nextNode) {
        elementsToRemove.push(toRemove);
        toRemove = toRemove.nextSibling;
      }
      if (nextNode) elementsToRemove.push(nextNode);
    }
  }

  for (const node of elementsToRemove) {
    node.parentNode?.removeChild(node);
  }

  const cleanBiography = tempDiv.innerHTML
    .replace(/(?:\s*<br\s*\/?>\s*){2,}/gi, '<br />')
    .replace(/^(?:\s*<br\s*\/?>|\s*<p>\s*<\/p>|\s*&nbsp;)+/gi, '')
    .trim();

  return { characteristics, cleanBiography };
}

/** Inverse of parseCharacterBiography — reassembles the stat lines and the
 *  free-text description back into a single biography string for storage,
 *  the same "<b>Label:</b> value<br>" shape AniList's own descriptions use
 *  (so the character page's own parser keeps finding them). */
export function buildBiographyHtml(characteristics: ParsedCharacteristic[], cleanBiography: string): string {
  const statLines = characteristics
    .filter(c => c.label.trim() && c.value.trim())
    .map(c => `<b>${escapeHtml(c.label.trim())}:</b> ${escapeHtml(c.value.trim())}`)
    .join('<br>\n');

  if (!statLines) return cleanBiography;
  return cleanBiography ? `${statLines}<br>\n<br>\n${cleanBiography}` : statLines;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
