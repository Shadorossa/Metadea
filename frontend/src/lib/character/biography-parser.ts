// Parses a character's biography HTML into bold characteristics and free-text description.

export interface ParsedCharacteristic {
  label: string;
  value: string;
}

export interface ParsedBiography {
  characteristics: ParsedCharacteristic[];
  cleanBiography: string;
}

export function parseCharacterBiography(rawHtml: string | null | undefined): ParsedBiography {
  const doc = new DOMParser().parseFromString(rawHtml || '', 'text/html');
  const boldElements = doc.querySelectorAll('b, strong');
  const characteristics: ParsedCharacteristic[] = [];
  const elementsToRemove: Node[] = [];

  for (const el of boldElements) {
    const label = (el.textContent || '').trim().replace(/:$/, '').trim();
    if (label.length > 30 || label.length < 2) continue;

    // A value can span text fragments, line breaks, or spoiler spans
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

  const cleanBiography = doc.body.innerHTML
    .replace(/(?:\s*<br\s*\/?>\s*){2,}/gi, '<br />')
    .replace(/^(?:\s*<br\s*\/?>|\s*<p>\s*<\/p>|\s*&nbsp;)+/gi, '')
    .trim();

  return { characteristics, cleanBiography };
}

// Reassembles characteristics and description back into standard HTML biography string
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
