import React, { useState } from 'react';

interface DetailPanelShellProps {
  onClose:  () => void;
  children: (handleClose: () => void) => React.ReactNode;
}

// The sliding outer panel (position/size/entrance-exit animation) —
// extracted out of LocalMediaDetailPanel/GameDetailPanel so LocalMediaSection
// can keep ONE persistent instance of it across a Visual Novel selection
// that flips between a catalog item (LocalMediaDetailPanel-shaped content)
// and a Steam-matched one (GameDetailPanel-shaped content). Those two
// content shapes are genuinely different components — React still
// unmounts/remounts *them* when crossing between kinds, there's no way
// around that — but the shell itself, and its slide-in animation, no
// longer remounts just because which content is inside it changed, the
// same way it already doesn't remount from switching between two
// same-kind selections (e.g. two different anime).
export function DetailPanelShell({ onClose, children }: DetailPanelShellProps) {
  // Same reverse-of-the-entrance-animation close every panel used to
  // manage individually — onClose (from the caller) unmounts immediately,
  // so this plays slide-out-right first and only unmounts once it's
  // actually finished.
  const [closing, setClosing] = useState(false);
  const handleClose = () => {
    setClosing(true);
    setTimeout(onClose, 300);
  };

  return (
    <div className={`local-game-detail-panel${closing ? ' local-game-detail-panel--closing' : ''}`}>
      {children(handleClose)}
    </div>
  );
}
