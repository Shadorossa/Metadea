import { describe, it, expect } from 'vitest';
import {
  applyDocumentTranslations,
  applyTranslations,
  interpolateTranslation,
  resolveTranslationKey,
} from './apply-translations';

// Minimal DOM double: the applier only needs attribute-presence selectors,
// get/setAttribute, tagName, textContent and innerHTML.
class FakeElement {
  attributes = new Map<string, string>();
  textContent = '';
  innerHTML = '';
  constructor(public tagName: string, attrs: Record<string, string> = {}, text = '') {
    for (const [k, v] of Object.entries(attrs)) this.attributes.set(k, v);
    this.textContent = text;
  }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
}

function fakeRoot(elements: FakeElement[]) {
  return {
    querySelectorAll(selector: string) {
      const match = /^\[([\w-]+)\]$/.exec(selector);
      if (!match) throw new Error(`unsupported selector ${selector}`);
      return elements.filter((el) => el.attributes.has(match[1]));
    },
  } as unknown as ParentNode;
}

const t = {
  nav: { home: 'Inicio', browse: 'Explorar' },
  local: { count: 'Tienes {count} juegos de {platform}' },
  help: { body: 'Pulsa <strong>Guardar</strong>' },
  settings: { title: 'Ajustes', placeholder: 'Tu nombre' },
};

describe('resolveTranslationKey', () => {
  it('walks dot paths and rejects non-strings', () => {
    expect(resolveTranslationKey(t, 'nav.home')).toBe('Inicio');
    expect(resolveTranslationKey(t, 'nav')).toBeUndefined();
    expect(resolveTranslationKey(t, 'nav.missing')).toBeUndefined();
    expect(resolveTranslationKey(t, 'nav.home.deeper')).toBeUndefined();
  });
});

describe('interpolateTranslation', () => {
  it('replaces known placeholders and keeps unknown ones', () => {
    expect(interpolateTranslation('{count} of {total}', { count: 3 })).toBe('3 of {total}');
    expect(interpolateTranslation('plain', null)).toBe('plain');
  });
});

describe('applyTranslations', () => {
  it('translates text, markup and attributes', () => {
    const text = new FakeElement('SPAN', { 'data-i18n': 'nav.home' }, 'Home');
    const html = new FakeElement('P', { 'data-i18n-html': 'help.body' });
    const title = new FakeElement('A', { 'data-i18n-title': 'nav.browse', title: 'Browse' });
    const aria = new FakeElement('BUTTON', { 'data-i18n-aria-label': 'nav.home' });
    const legacyAria = new FakeElement('NAV', { 'data-i18n-aria': 'nav.browse' });
    const placeholder = new FakeElement('INPUT', { 'data-i18n-placeholder': 'settings.placeholder' });
    const alt = new FakeElement('IMG', { 'data-i18n-alt': 'nav.home' });
    applyTranslations(fakeRoot([text, html, title, aria, legacyAria, placeholder, alt]), t);
    expect(text.textContent).toBe('Inicio');
    expect(html.innerHTML).toBe('Pulsa <strong>Guardar</strong>');
    expect(title.getAttribute('title')).toBe('Explorar');
    expect(aria.getAttribute('aria-label')).toBe('Inicio');
    expect(legacyAria.getAttribute('aria-label')).toBe('Explorar');
    expect(placeholder.getAttribute('placeholder')).toBe('Tu nombre');
    expect(alt.getAttribute('alt')).toBe('Inicio');
  });

  it('interpolates data-i18n-vars', () => {
    const el = new FakeElement('P', { 'data-i18n': 'local.count', 'data-i18n-vars': '{"count":3,"platform":"Steam"}' });
    applyTranslations(fakeRoot([el]), t);
    expect(el.textContent).toBe('Tienes 3 juegos de Steam');
  });

  it('ignores malformed vars instead of throwing', () => {
    const el = new FakeElement('P', { 'data-i18n': 'local.count', 'data-i18n-vars': '{oops' });
    applyTranslations(fakeRoot([el]), t);
    expect(el.textContent).toBe('Tienes {count} juegos de {platform}');
  });

  it('keeps the server-rendered text when the key is missing', () => {
    const el = new FakeElement('SPAN', { 'data-i18n': 'nav.nope' }, 'Server text');
    applyTranslations(fakeRoot([el]), t);
    expect(el.textContent).toBe('Server text');
  });

  it('treats data-i18n on a form field as an attribute (legacy)', () => {
    const input = new FakeElement('INPUT', { 'data-i18n': 'settings.placeholder' });
    const textarea = new FakeElement('TEXTAREA', { 'data-i18n': 'nav.home', 'data-i18n-attr': 'title' });
    applyTranslations(fakeRoot([input, textarea]), t);
    expect(input.getAttribute('placeholder')).toBe('Tu nombre');
    expect(textarea.getAttribute('title')).toBe('Inicio');
    expect(textarea.textContent).toBe('');
  });

  it('sets the document title and meta content with a suffix', () => {
    const title = new FakeElement('TITLE', { 'data-i18n-doc-title': 'settings.title', 'data-i18n-suffix': ' — Metadea' });
    const meta = new FakeElement('META', { 'data-i18n-doc-title': 'settings.title', 'data-i18n-prefix': 'Metadea — ' });
    applyTranslations(fakeRoot([title, meta]), t);
    expect(title.textContent).toBe('Ajustes — Metadea');
    expect(meta.getAttribute('content')).toBe('Metadea — Ajustes');
  });
});

describe('applyDocumentTranslations', () => {
  it('stamps <html lang>', () => {
    const html = new FakeElement('HTML');
    const doc = Object.assign(fakeRoot([]), { documentElement: html }) as unknown as Document;
    applyDocumentTranslations(doc, t, 'es');
    expect(html.getAttribute('lang')).toBe('es');
  });
});
