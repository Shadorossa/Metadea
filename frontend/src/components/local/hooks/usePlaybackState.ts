import { playbackStore } from '../../../lib/local/playback-service';
import { useExternalStore } from '../../shared/hooks/useExternalStore';

export const usePlaybackState = () => useExternalStore(playbackStore);
