import { createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';
import { CalendarSection } from '../../components/home/CalendarSection';

// The Home release calendar is a React island mounted imperatively — the
// page's own script still calls renderReleaseCalendar(el) once on load.
let root: Root | null = null;

export async function renderReleaseCalendar(el: HTMLElement): Promise<void> {
  root?.unmount();
  root = createRoot(el);
  root.render(createElement(CalendarSection));
}
