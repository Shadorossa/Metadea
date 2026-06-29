import { readUserJourney, writeUserJourney, type LibraryEntry } from '../tauri';

function getCleanDate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  const match = dateStr.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

export async function logJourneyEvent(
  existing: LibraryEntry | null,
  entry: LibraryEntry,
  mediaType: string
): Promise<void> {
  try {
    const journey = await readUserJourney();
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const externalId = entry.external_id;
    const timestamp = new Date().toISOString();
    
    // 1. Check if status has changed to started (or starts actively)
    const wasPlannedOrNew = !existing || existing.status === 'planning' || !existing.status;
    const isNowActive = entry.status === 'watching' || entry.status === 'reading' || entry.status === 'playing';
    
    if (wasPlannedOrNew && isNowActive) {
      // Remove any existing start event for this media to avoid duplicates
      journey.forEach(day => {
        day.events = day.events.filter(e => !(e.externalId === externalId && e.type === 'start'));
      });
      
      const startDate = getCleanDate(entry.started_at) || today;
      let startDayEntry = journey.find(d => d.date === startDate);
      if (!startDayEntry) {
        startDayEntry = { date: startDate, events: [] };
        journey.push(startDayEntry);
      }
      
      startDayEntry.events.push({
        externalId,
        type: 'start',
        mediaType,
        timestamp
      });
    }
    
    // 2. Check if status has changed to completed
    const wasNotCompleted = !existing || existing.status !== 'completed';
    const isNowCompleted = entry.status === 'completed';
    if (wasNotCompleted && isNowCompleted) {
      // Remove any existing complete event for this media to avoid duplicates
      journey.forEach(day => {
        day.events = day.events.filter(e => !(e.externalId === externalId && e.type === 'complete'));
      });

      const finishDate = getCleanDate(entry.finished_at) || today;
      let finishDayEntry = journey.find(d => d.date === finishDate);
      if (!finishDayEntry) {
        finishDayEntry = { date: finishDate, events: [] };
        journey.push(finishDayEntry);
      }
      
      finishDayEntry.events.push({
        externalId,
        type: 'complete',
        mediaType,
        timestamp
      });
    }
    
    // 3. Check progress updates (always registered on the current calendar day)
    const prevProgress = existing ? existing.progress : 0;
    const newProgress = entry.progress;
    if (newProgress > prevProgress) {
      let dayEntry = journey.find(d => d.date === today);
      if (!dayEntry) {
        dayEntry = { date: today, events: [] };
        journey.push(dayEntry);
      }

      let progEvent = dayEntry.events.find(e => e.externalId === externalId && e.type === 'progress');
      const startVal = prevProgress + 1;
      const endVal = newProgress;
      
      if (progEvent) {
        progEvent.progressEnd = endVal;
        progEvent.timestamp = timestamp;
      } else {
        dayEntry.events.push({
          externalId,
          type: 'progress',
          progressStart: startVal,
          progressEnd: endVal,
          mediaType,
          timestamp
        });
      }
    }
    
    // Filter out day entries that have become empty
    const filteredJourney = journey.filter(day => day.events && day.events.length > 0);

    // Save back to JSON, sorted by date descending
    filteredJourney.sort((a, b) => b.date.localeCompare(a.date));
    await writeUserJourney(filteredJourney);
  } catch (err) {
    console.error('Failed to log journey event', err);
  }
}
