import { useEffect, useState, type RefObject } from 'react';

/** True once `ref`'s element has come within `rootMargin` of the viewport,
 *  and from then on. Always true where IntersectionObserver doesn't exist. */
export function useInView(ref: RefObject<Element | null>, { rootMargin = '200px' } = {}): boolean {
  const [inView, setInView] = useState(false);
  const supported = typeof IntersectionObserver !== 'undefined';
  useEffect(() => {
    const element = ref.current;
    if (!supported || !element || inView) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setInView(true);
        observer.disconnect();
      }
    }, { rootMargin });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, rootMargin, inView, supported]);
  return inView || !supported;
}
