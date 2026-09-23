import { useState, useEffect } from 'react';
import { ChevronDown, Database } from 'lucide-react';
import type { ApiSportsDiscipline } from '../../lib/search/providers/apisports';
import type { Translations } from '../../i18n/index';

type SearchTranslations = Translations['search'];

function EventDisciplineIcon({ discipline }: { discipline: ApiSportsDiscipline | '' }) {
  if (discipline === 'football') {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="m9.2 8.4 2.8-1.7 2.8 1.7-.9 3.2h-3.8zM9.2 8.4 6 7.1m8.8 1.3L18 7.1m-8.8 4.5-2.1 3.2m8-3.2 2.1 3.2m-8.3 0L8 19m8.2-3.2L16 19m-4-4.1v6.1" />
      </svg>
    );
  }

  if (discipline === 'basketball') {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 3v18M3 12h18M5.7 5.7c3.4 3.2 3.4 9.4 0 12.6m12.6-12.6c-3.4 3.2-3.4 9.4 0 12.6" />
      </svg>
    );
  }

  return <Database size={15} strokeWidth={1.8} aria-hidden="true" />;
}

interface Props {
  eventDiscipline: ApiSportsDiscipline | '';
  onChange: (value: string) => void;
  i18n: SearchTranslations;
}

// The open/closed state lives here: nothing outside the picker ever reads it,
// and its outside-click / Escape closing only concerns this element.
export function EventDisciplinePicker({ eventDiscipline, onChange, i18n }: Props) {
  const [isEventDisciplineOpen, setIsEventDisciplineOpen] = useState(false);

  useEffect(() => {
    if (!isEventDisciplineOpen) return;
    const onDocumentClick = (event: MouseEvent) => {
      if (!(event.target as HTMLElement).closest('.search-event-discipline-wrap')) {
        setIsEventDisciplineOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsEventDisciplineOpen(false);
    };
    document.addEventListener('click', onDocumentClick);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('click', onDocumentClick);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isEventDisciplineOpen]);

  return (
    <div className="search-event-discipline-wrap">
      <button
        type="button"
        className="search-event-discipline-trigger"
        onClick={() => setIsEventDisciplineOpen(open => !open)}
        aria-label={eventDiscipline ? i18n[eventDiscipline === 'football' ? 'event_football' : 'event_basketball'] : i18n.event_local_only}
        aria-expanded={isEventDisciplineOpen}
        aria-haspopup="true"
        title={eventDiscipline ? i18n[eventDiscipline === 'football' ? 'event_football' : 'event_basketball'] : i18n.event_local_only}
      >
        <EventDisciplineIcon discipline={eventDiscipline} />
        <ChevronDown size={9} strokeWidth={2} aria-hidden="true" />
      </button>
      {isEventDisciplineOpen && (
        <div className="search-event-discipline-menu" role="group" aria-label={i18n.event_discipline}>
          {(['', 'football', 'basketball'] as const).map(discipline => {
            const label = discipline === ''
              ? i18n.event_local_only
              : i18n[discipline === 'football' ? 'event_football' : 'event_basketball'];
            return (
              <button
                key={discipline || 'local'}
                type="button"
                className={`search-event-discipline-option${eventDiscipline === discipline ? ' active' : ''}`}
                onClick={() => {
                  onChange(discipline);
                  setIsEventDisciplineOpen(false);
                }}
                aria-label={label}
                aria-pressed={eventDiscipline === discipline}
                title={label}
              >
                <EventDisciplineIcon discipline={discipline} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
