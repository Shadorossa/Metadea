import { useEffect, useState } from 'react';
import { Gamepad2, Keyboard, User } from 'lucide-react';
import type { ConnectedPad, ControllerFamily } from '../../lib/big-picture/gamepad';
import type { Translations } from '../../i18n/index';
import { readCachedProfileAvatar, readCachedShareAvatar } from '../../lib/storage/images';

const CLOCK_TICK_MS = 10_000;

const FAMILY_LABEL_KEY: Record<ControllerFamily, keyof Translations['big_picture']> = {
  xbox: 'controller_xbox',
  playstation: 'controller_playstation',
  nintendo: 'controller_nintendo',
  generic: 'controller_generic',
};

// The PS5 skin's profile picture: the user's "specific photo" (Settings ›
// Appearance), else the profile avatar the navbar shows.
function StatusAvatar() {
  const [src, setSrc] = useState(() => readCachedShareAvatar() || readCachedProfileAvatar());
  return (
    <span className="bp-status-avatar" aria-hidden="true">
      {src ? <img src={src} alt="" draggable={false} referrerPolicy="no-referrer" onError={() => setSrc(null)} /> : <User size={20} />}
    </span>
  );
}

interface BigPictureStatusProps {
  pads: ConnectedPad[];
  locale: string;
  t: Translations['big_picture'];
  /** The profile avatar between the controller and the clock (PS5 skin). */
  avatar?: boolean;
}

// Top-right corner: a large clock and the controller status. The Gamepad
// API exposes no battery level in WebView2, so only presence/type is shown.
export function BigPictureStatus({ pads, locale, t, avatar = false }: BigPictureStatusProps) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), CLOCK_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  let time: string;
  try {
    time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(now);
  } catch {
    time = now.toTimeString().slice(0, 5);
  }
  const pad = pads[0];
  const padLabel = pad ? t[FAMILY_LABEL_KEY[pad.family]] : t.controller_none;

  return (
    <div className="bp-status">
      <span className={`bp-status-pad${pad ? ' is-connected' : ''}`} title={pad?.id ?? padLabel}>
        {pad ? <Gamepad2 size={22} aria-hidden="true" /> : <Keyboard size={22} aria-hidden="true" />}
        <span>{pads.length > 1 ? `${padLabel} ×${pads.length}` : padLabel}</span>
      </span>
      {avatar && <StatusAvatar />}
      <time className="bp-status-clock" aria-label={t.clock_aria} dateTime={now.toISOString()}>{time}</time>
    </div>
  );
}
