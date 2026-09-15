import React from 'react';
import { motion } from 'motion/react';

interface DetailPanelShellProps {
  onClose:  () => void;
  children: (handleClose: () => void) => React.ReactNode;
  // Overrides the panel's own CSS clamp(320px, 60vw, 860px) width — see
  // useEvenPanelWidth, which widens it by whatever sliver of a column the
  // games grid would otherwise be left holding empty at the end of each
  // row. Always a number (that hook falls back to the natural clamp value
  // itself); kept at its last value throughout this panel's own close
  // animation rather than snapping back to "natural" mid-slide.
  width: number;
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
//
// The caller wraps its conditional render of this in <AnimatePresence> (see
// LocalLibrary.tsx) instead of this component managing its own "closing"
// boolean + setTimeout the way it used to — that hand-rolled version left
// onClose as a stale timer racing whatever the user did next: picking a
// DIFFERENT card within the 300ms after clicking "cerrar" left the panel
// stuck fully translated off-screen (still showing the new item's content,
// just invisible), and the original close's timer then force-closed it a
// moment later regardless. AnimatePresence keeps this mounted for exactly
// as long as its exit animation actually takes, driven by the real
// `panelOpen` becoming false — so `handleClose` can just call `onClose`
// directly and there's no independent timer left to race in the first
// place; reopening on a different item mid-exit simply un-exits it.
export function DetailPanelShell({ onClose, children, width }: DetailPanelShellProps) {
  return (
    <motion.div
      className="local-game-detail-panel"
      // max-width/min-width need overriding alongside width itself — the
      // CSS rule's own max-width: 860px would otherwise still clamp a
      // width wider than that right back down, which is exactly the case
      // this override exists for (a grid leftover wide enough to push the
      // ideal width past 860px).
      style={{ width, maxWidth: 'none', minWidth: 'none' }}
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ duration: 0.3, ease: [0.25, 0, 0.15, 1] }}
    >
      {children(onClose)}
    </motion.div>
  );
}
