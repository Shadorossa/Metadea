import type React from 'react';
import type { CategoryId } from '../../../lib/local/platforms';
import { IconGame, IconVNovel, IconAnime, IconManga, IconNovel, IconBook, IconComic, IconSeries, IconMovie } from './icons';

// The Local tab strip's icon per category (LocalLibrary's tab bar).
export const CATEGORY_ICONS: Record<CategoryId, React.ReactElement> = {
  'videojuegos': <IconGame />,
  'visual-novel': <IconVNovel />,
  'anime': <IconAnime />,
  'manga': <IconManga />,
  'light-novel': <IconNovel />,
  'books': <IconBook />,
  'comics': <IconComic />,
  'series': <IconSeries />,
  'movies': <IconMovie />,
};
