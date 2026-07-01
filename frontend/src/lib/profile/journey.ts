import { readUserJourney, writeUserJourney, type LibraryEntry } from '../tauri';

function getCleanDate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  const match = dateStr.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

export async function logJourneyEvent(
  existing: LibraryEntry | null,
  entry: LibraryEntry,
  mediaType: string,
  totalCount?: number
): Promise<void> {
  try {
    const journey = await readUserJourney();
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const externalId = entry.external_id;
    const timestamp = new Date().toISOString();

    // Only register 'complete' events (no 'start' events)
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

    // 2. Check progress updates (only if not a direct-completion or batch entry)
    const wasPlanningOrNew = !existing || existing.status === 'planning' || !existing.status;
    const isDirectCompletion = wasPlanningOrNew && isNowCompleted;
    // Batch entry: user added a work with all chapters/episodes already done at once
    const prevProgress = existing ? existing.progress : 0;
    const isBatchEntry = wasPlanningOrNew
      && totalCount !== undefined && totalCount > 0
      && entry.progress >= totalCount
      && prevProgress === 0;

    if (!isDirectCompletion && !isBatchEntry) {
      const newProgress = entry.progress;

      if (newProgress !== prevProgress && newProgress > 0) {
        let dayEntry = journey.find(d => d.date === today);

        if (newProgress > prevProgress) {
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
        } else if (newProgress < prevProgress) {
          // Decreased progress
          if (dayEntry) {
            const progEventIndex = dayEntry.events.findIndex(e => e.externalId === externalId && e.type === 'progress');
            if (progEventIndex !== -1) {
              const progEvent = dayEntry.events[progEventIndex];
              if (newProgress <= progEvent.progressStart) {
                // Undid all progress made today, remove the event
                dayEntry.events.splice(progEventIndex, 1);
              } else {
                // Decreased but still higher than start of today
                progEvent.progressEnd = newProgress;
                progEvent.timestamp = timestamp;
              }
            }
          }
        }
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
