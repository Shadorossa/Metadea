import { Tv } from 'lucide-react';
import { getT } from '../../i18n/runtime';
import { openBigPicture } from '../../lib/big-picture/big-picture-state';

// "Big Picture" entry in the Local tab bar (next to the name search).
export function BigPictureButton() {
  const t = getT().big_picture;
  return (
    <button
      type="button"
      className="local-bigpicture-btn"
      onClick={openBigPicture}
      aria-label={t.enter_title}
      title={t.enter_title}
    >
      <Tv size={16} aria-hidden="true" />
      <span>{t.enter}</span>
    </button>
  );
}
