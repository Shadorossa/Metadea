import { createIslandRenderer } from '../shared/mount-island';
import { FriendsSection } from '../../components/profile/FriendsSection';

export const renderFriends = createIslandRenderer(FriendsSection);
