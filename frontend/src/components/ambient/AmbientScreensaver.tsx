import '../../styles/components/ambient.css';
import { useEffect, useState } from 'react';
import { Music } from 'lucide-react';
import { getLangCode, getT } from '../../i18n/runtime';
import { formatAmbientClock, msUntilNextMinute } from '../../lib/ambient/ambient-clock';
import { currentTheme, jukeboxStore } from '../../lib/jukebox/jukebox-store';
import { themeDisplayTitle } from '../../lib/jukebox/jukebox-favorites';
import { typeLabel } from '../../lib/profile/media-type-label';
import { useExternalStore } from '../shared/hooks/useExternalStore';
import { useAmbientSlideshow, type ShownSlide } from './hooks/useAmbientSlideshow';

function AmbientClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setTimeout(() => setNow(new Date()), msUntilNextMinute(now));
    return () => window.clearTimeout(timer);
  }, [now]);
  const { time, date } = formatAmbientClock(now, getLangCode());
  return (
    <div className="ambient-clock">
      <time className="ambient-clock-time" dateTime={now.toISOString()}>{time}</time>
      <span className="ambient-clock-date">{date}</span>
    </div>
  );
}

// A landscape wallpaper filling the screen with a slow Ken Burns. AniList
// banners (very wide, short) get a centred crop, a gentler zoom and a
// vignette that hides how little vertical resolution they have.
function AmbientSlideLayer({ shown }: { shown: ShownSlide }) {
  const { slide, variant } = shown;
  const banner = slide.wallpaper.kind === 'banner';
  return (
    <div className={`ambient-slide${banner ? ' ambient-slide--banner' : ''}`}>
      <img
        className={`ambient-slide-fill ambient-kb ${banner ? 'ambient-kb--soft' : `ambient-kb--${variant}`}`}
        src={slide.wallpaper.url}
        alt=""
        draggable={false}
      />
      {banner && <div className="ambient-slide-vignette" />}
    </div>
  );
}

function NowPlaying({ label }: { label: string }) {
  const jukebox = useExternalStore(jukeboxStore);
  const entry = currentTheme(jukebox);
  if (!entry || (jukebox.status !== 'playing' && jukebox.status !== 'loading')) return null;
  const artists = entry.theme.artists ? ` · ${entry.theme.artists}` : '';
  return (
    <p className="ambient-now-playing" aria-label={label}>
      <Music size={13} strokeWidth={2} aria-hidden="true" />
      <span>{themeDisplayTitle(entry.theme)}{artists} · {entry.media_title}</span>
    </p>
  );
}

// Full-viewport, cursorless slideshow over everything (z-index in
// ambient.css). Input is handled by AmbientModeIsland's guard, not here.
export default function AmbientScreensaver({ leaving }: { leaving: boolean }) {
  const t = getT().ambient;
  const { layers, empty } = useAmbientSlideshow();
  const current = layers[layers.length - 1] ?? null;

  return (
    <div className={`ambient-screen${leaving ? ' is-leaving' : ''}${empty ? ' is-empty' : ''}`} role="dialog" aria-modal="true" aria-label={t.title}>
      <div className="ambient-stage" aria-hidden="true">
        {empty && <div className="ambient-idle-gradient" />}
        {layers.map(shown => <AmbientSlideLayer key={shown.key} shown={shown} />)}
      </div>
      <div className="ambient-shade" aria-hidden="true" />
      <AmbientClock />
      <div className="ambient-caption">
        {current && (
          <div className="ambient-work" key={current.key}>
            <p className="ambient-work-title">{current.slide.work.title}</p>
            <p className="ambient-work-meta">
              {typeLabel(current.slide.work.type)}
              {current.slide.work.year ? ` · ${current.slide.work.year}` : ''}
            </p>
          </div>
        )}
        <NowPlaying label={t.now_playing} />
      </div>
    </div>
  );
}
