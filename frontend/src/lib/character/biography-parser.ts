import { sanitizeStatValue, escapeHtml } from '../shared/sanitize-html';

export interface ParsedCharacteristic {
  label: string;
  value: string;
}

export interface ParsedBiography {
  characteristics: ParsedCharacteristic[];
  cleanBiography: string;
}

export function parseCharacterBiography(rawHtml: string | null | undefined): ParsedBiography {
  if (!rawHtml) return { characteristics: [], cleanBiography: '' };

  const normalized = rawHtml
    .replace(/(?:__|\*\*)([^\n_*\<]+?)(?:__|\*\*)\s*:\s*/g, '<b>$1:</b> ')
    .replace(/(?:__|\*\*)([^\n_*\<]+?)(?:__|\*\*)/g, '<b>$1</b>');

  const doc = new DOMParser().parseFromString(normalized, 'text/html');
  const boldElements = doc.querySelectorAll('b, strong');
  const characteristics: ParsedCharacteristic[] = [];
  const elementsToRemove: Node[] = [];

  for (const el of boldElements) {
    const label = (el.textContent || '').trim().replace(/:$/, '').trim();
    if (label.length > 80 || label.length < 2) continue;

    let nextNode: Node | null = el.nextSibling;
    const valueParts: string[] = [];
    const thisCharNodes: Node[] = [el];

    while (nextNode) {
      if (nextNode.nodeType === Node.ELEMENT_NODE && (nextNode.nodeName === 'B' || nextNode.nodeName === 'STRONG')) {
        break;
      }

      if (nextNode.nodeType === Node.TEXT_NODE) {
        const txt = nextNode.textContent || '';
        if (txt.trim()) {
          valueParts.push(txt.trim());
        }
        thisCharNodes.push(nextNode);
      } else if (nextNode.nodeName === 'BR') {
        let lookAhead: Node | null = nextNode.nextSibling;
        while (lookAhead && lookAhead.nodeType === Node.TEXT_NODE && !lookAhead.textContent?.trim()) {
          lookAhead = lookAhead.nextSibling;
        }

        if (!lookAhead || lookAhead.nodeName === 'BR' || 
            (lookAhead.nodeType === Node.ELEMENT_NODE && (lookAhead.nodeName === 'B' || lookAhead.nodeName === 'STRONG'))) {
          thisCharNodes.push(nextNode);
          break;
        } else {
          valueParts.push('<br>');
          thisCharNodes.push(nextNode);
        }
      } else if (nextNode.nodeType === Node.ELEMENT_NODE) {
        valueParts.push((nextNode as Element).outerHTML);
        thisCharNodes.push(nextNode);
      } else {
        break;
      }
      nextNode = nextNode.nextSibling;
    }

    const value = valueParts.join(' ').replace(/\s*<br>\s*/gi, '<br>').trim().replace(/^:\s*/, '').trim();
    if (value) {
      characteristics.push({ label, value });
      for (const n of thisCharNodes) {
        elementsToRemove.push(n);
      }
    }
  }

  for (const node of elementsToRemove) {
    const parent = node.parentNode;
    parent?.removeChild(node);
    if (parent && parent.nodeName === 'P' && !(parent.textContent || '').trim()) {
      parent.parentNode?.removeChild(parent);
    }
  }

  const cleanBiography = doc.body.innerHTML
    .replace(/(?:\s*<br\s*\/?>\s*){2,}/gi, '<br />')
    .replace(/^(?:\s*<br\s*\/?>|\s*<p>\s*<\/p>|\s*&nbsp;)+/gi, '')
    .trim();

  return { characteristics, cleanBiography };
}

export function buildBiographyHtml(characteristics: ParsedCharacteristic[], cleanBiography: string): string {
  const statLines = characteristics
    .filter(c => c.label.trim() && c.value.trim())
    .map(c => `<b>${escapeHtml(c.label.trim())}:</b> ${sanitizeStatValue(c.value.trim())}`)
    .join('<br>\n');

  if (!statLines) return cleanBiography;
  return cleanBiography ? `${statLines}<br>\n<br>\n${cleanBiography}` : statLines;
}

