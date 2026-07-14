import { createIslandRenderer } from '../shared/mount-island';
import { LibrarySection } from '../../components/profile/LibrarySection';

// profile.astro also relies on this for the 'refresh-profile-library' event
// path — LibrarySection listens for that itself now and re-fetches in
// place, so re-invoking this renderer is only needed for actual tab
// switches, not every library mutation.
export const renderLibrary = createIslandRenderer(LibrarySection);
