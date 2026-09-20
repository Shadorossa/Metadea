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
  _totalCount?: number
): Promise<void> {
  try {
    // Activity is a completion history, not a progress log. Strip legacy
    // start/progress rows whenever the journey is next written so they can no
    // longer reappear locally or be uploaded to the social feed.
    const journey = (await readUserJourney())
      .map(day => ({ ...day, events: (day.events || []).filter(event => event.type === 'complete') }))
      .filter(day => day.events.length > 0);
    const externalId = entry.external_id;

    // Only register 'complete' events (no 'start' events) — and only when a
    // real finish date was set. Without one there's no day to file the event
    // under, and defaulting to "today" made every completion show up in the
    // feed even for entries the user never actually dated.
    const wasNotCompleted = !existing || existing.status !== 'completed';
    const isNowCompleted = entry.status === 'completed';
    const finishDate = getCleanDate(entry.finished_at);
    if (wasNotCompleted && isNowCompleted && finishDate) {
      // Remove any existing complete event for this media to avoid duplicates
      journey.forEach(day => {
        day.events = day.events.filter(e => !(e.externalId === externalId && e.type === 'complete'));
      });

      let finishDayEntry = journey.find(d => d.date === finishDate);
      if (!finishDayEntry) {
        finishDayEntry = { date: finishDate, events: [] };
        journey.push(finishDayEntry);
      }

      finishDayEntry.events.push({
        externalId,
        type: 'complete',
        mediaType,
        // Anchored to the finish date itself, not "now" — this is what
        // both the local feed's sort order and the synced social feed
        // order by, so an old work completed/dated today must never
        // outrank genuinely recent activity just because it was edited now.
        timestamp: new Date(`${finishDate}T12:00:00`).toISOString(),
      });
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
