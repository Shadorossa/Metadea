import { useEffect, useRef } from 'react';

// The title is forced to a single line (no wrap) — for long titles that'd
// otherwise overflow past the viewport edge, shrink the font size in 1px
// steps until it actually fits its column instead of just clipping.
export function useAutoShrinkTitle(titleMain: string | undefined) {
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const el = titleRef.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;

    const MIN_FONT_PX = 13;
    const fit = () => {
      el.style.fontSize = '';
      let fontSize = parseFloat(getComputedStyle(el).fontSize);
      while (el.scrollWidth > parent.clientWidth && fontSize > MIN_FONT_PX) {
        fontSize -= 1;
        el.style.fontSize = `${fontSize}px`;
      }
    };

    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [titleMain]);

  return titleRef;
}
