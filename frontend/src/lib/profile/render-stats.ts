import { createIslandRenderer } from '../shared/mount-island';
import { StatsSection } from '../../components/profile/StatsSection';

export const renderStats = createIslandRenderer(StatsSection);
