import { sessionStore, resumeOpenStore } from '../../../lib/reader/reading-session';
import { useExternalStore } from '../../shared/hooks/useExternalStore';

export const useReadingSession = () => useExternalStore(sessionStore);
export const useResumeOpen = () => useExternalStore(resumeOpenStore);
