import { createIslandRenderer } from '../shared/mount-island';
import { FavoritesSection } from '../../components/profile/FavoritesSection';

export const renderFavorites = createIslandRenderer(FavoritesSection);
