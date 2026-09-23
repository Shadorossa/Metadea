import { gamePresenceStore } from '../../../lib/local/discord-presence';
import { useExternalStore } from './useExternalStore';

export const useGamePresence = () => useExternalStore(gamePresenceStore);
