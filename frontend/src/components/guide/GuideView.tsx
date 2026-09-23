// The in-app user guide (/guide): a searchable, sectioned explanation of every
// feature. Structure comes from lib/welcome/guide-content.ts, prose from
// `guide.*` in i18n, and the filter from lib/welcome/guide-search.ts.
// Rendered client-only so it always shows the runtime language.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Search, X } from 'lucide-react';
import type { Translations } from '../../i18n/index';
import { getT } from '../../i18n/runtime';
import { interpolateTranslation, resolveTranslationKey } from '../../lib/i18n-dom/apply-translations';
import {
  GUIDE_SECTIONS, groupSections, sectionAnchor, sectionSearchText, type GuideSectionCopy,
} from '../../lib/welcome/guide-content';
import { filterSections } from '../../lib/welcome/guide-search';
import { useShortcuts } from '../shared/hooks/useShortcuts';
import { GuideIcon } from './GuideIcon';
import { GuideSection } from './GuideSection';

const GROUPED = groupSections();

function sectionCopy(t: Translations, id: string): GuideSectionCopy {
  return (t.guide.sections as Record<string, GuideSectionCopy>)[id];
}

/** Section texts for the filter. Group names and shortcut descriptions are
 *  searchable too: "player" finds the sections under "Watch, read & listen". */
function buildSearchIndex(t: Translations): Array<{ id: string; text: string }> {
  return GUIDE_SECTIONS.map(section => ({
    id: section.id,
    text: sectionSearchText(sectionCopy(t, section.id), [
      t.guide.groups[section.group],
      ...('shortcuts' in section ? section.shortcuts.map(s => resolveTranslationKey(t, s.label) ?? '') : []),
    ]),
  }));
}

export function GuideView() {
  const t = getT();
  const g = t.guide;
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Built once: `t` is fixed for the page's lifetime (a language change reloads).
  const [searchable] = useState(() => buildSearchIndex(t));
  const visible = useMemo(() => new Set(filterSections(searchable, query)), [searchable, query]);
  const filtering = query.trim().length > 0;

  useShortcuts('page', [{
    id: 'guide.focus_search',
    keys: 'mod+f',
    description: 'guide.search_label',
    handler: () => {
      searchRef.current?.focus();
      searchRef.current?.select();
    },
  }]);

  // Deep link (/guide#guide-player): jump once the sections exist.
  useEffect(() => {
    const hash = decodeURIComponent(window.location.hash.slice(1));
    if (hash) document.getElementById(hash)?.scrollIntoView({ block: 'start' });
  }, []);

  // Highlight the table-of-contents entry of the section being read.
  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      const top = entries
        .filter(entry => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (top) setActiveId(top.target.id);
    }, { rootMargin: '-15% 0px -70% 0px' });
    document.querySelectorAll('.guide-section').forEach(section => observer.observe(section));
    return () => observer.disconnect();
  }, [visible]);

  const onSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Escape' || query.length === 0) return;
    event.preventDefault();
    setQuery('');
  };

  return (
    <div className="guide-layout">
      <header className="guide-hero">
        <span className="guide-brand">METADEA</span>
        <h1 className="guide-title">{g.page_title}</h1>
        <p className="guide-subtitle">{g.page_subtitle}</p>
        <div className="guide-search" role="search">
          <Search className="guide-search-icon" size={16} strokeWidth={2} aria-hidden="true" />
          <input
            ref={searchRef}
            type="search"
            className="guide-search-input"
            value={query}
            placeholder={g.search_placeholder}
            aria-label={g.search_label}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={onSearchKeyDown}
          />
          {filtering && (
            <button type="button" className="guide-search-clear" onClick={() => setQuery('')} aria-label={g.search_clear} title={g.search_clear}>
              <X size={14} strokeWidth={2.4} aria-hidden="true" />
            </button>
          )}
        </div>
        <p className="guide-results" aria-live="polite">
          {filtering && interpolateTranslation(g.results_count, { count: visible.size, total: GUIDE_SECTIONS.length })}
        </p>
      </header>

      <div className="guide-columns">
        <nav className="guide-toc" aria-label={g.toc_title}>
          <h2 className="guide-toc-title">{g.toc_title}</h2>
          {GROUPED.map(({ group, sections }) => {
            const shown = sections.filter(section => visible.has(section.id));
            if (shown.length === 0) return null;
            return (
              <div className="guide-toc-group" key={group}>
                <span className="guide-toc-group-title">{g.groups[group]}</span>
                <ul>
                  {shown.map(section => {
                    const anchor = sectionAnchor(section.id);
                    return (
                      <li key={section.id}>
                        <a
                          href={`#${anchor}`}
                          className={`guide-toc-link${activeId === anchor ? ' is-active' : ''}`}
                          aria-current={activeId === anchor ? 'location' : undefined}
                        >
                          <GuideIcon name={section.icon} size={14} />
                          <span>{sectionCopy(t, section.id).title}</span>
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>

        <div className="guide-content">
          {visible.size === 0 && (
            <div className="guide-empty">
              <strong>{g.no_results_title}</strong>
              <p>{interpolateTranslation(g.no_results_body, { query: query.trim() })}</p>
            </div>
          )}
          {GROUPED.map(({ group, sections }) => {
            const shown = sections.filter(section => visible.has(section.id));
            if (shown.length === 0) return null;
            return (
              <section className="guide-group" key={group} aria-labelledby={`guide-group-${group}`}>
                <h2 className="guide-group-title" id={`guide-group-${group}`}>{g.groups[group]}</h2>
                {shown.map(section => (
                  <GuideSection key={section.id} def={section} copy={sectionCopy(t, section.id)} t={t} />
                ))}
              </section>
            );
          })}
          {visible.size > 0 && (
            <button
              type="button"
              className="btn btn--ghost btn--sm guide-back-to-top"
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            >
              <ArrowUp size={14} strokeWidth={2} aria-hidden="true" />
              {g.back_to_top}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
