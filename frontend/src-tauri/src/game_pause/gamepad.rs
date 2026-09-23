//! Background controller reading for the pause combo, through XInput: it
//! reports pads regardless of which window has focus, which is exactly the
//! situation here (the emulator is in front). Xbox pads and anything exposed
//! as XInput (DualShock/DualSense through Steam Input or DS4Windows, 8BitDo
//! in X-input mode...) are covered. Windows.Gaming.Input is not used: it
//! only delivers input to the foreground app, and neither API exposes the
//! Guide button without undocumented calls.

/// Empty slots are re-probed at this interval: XInputGetState on a slot
/// with nothing plugged in is comparatively slow.
const EMPTY_SLOT_PROBE_MS: u64 = 1000;

#[derive(Default)]
pub struct PadPoller {
    connected: [bool; 4],
    next_probe_ms: [u64; 4],
}

impl PadPoller {
    /// Whether any pad holds Select/Back and Start right now.
    pub fn combo_held(&mut self, now_ms: u64) -> bool {
        let mut held = false;
        for slot in 0..4 {
            if !self.connected[slot] && now_ms < self.next_probe_ms[slot] {
                continue;
            }
            match read_buttons(slot as u32) {
                Some(buttons) => {
                    self.connected[slot] = true;
                    held |= is_combo(buttons);
                }
                None => {
                    self.connected[slot] = false;
                    self.next_probe_ms[slot] = now_ms + EMPTY_SLOT_PROBE_MS;
                }
            }
        }
        held
    }
}

/// XInput button bits: Back 0x20, Start 0x10.
pub fn is_combo(buttons: u16) -> bool {
    const BACK: u16 = 0x0020;
    const START: u16 = 0x0010;
    buttons & (BACK | START) == BACK | START
}

#[cfg(windows)]
fn read_buttons(slot: u32) -> Option<u16> {
    use windows_sys::Win32::UI::Input::XboxController::{XInputGetState, XINPUT_STATE};
    // SAFETY: XINPUT_STATE is plain data; XInputGetState fills it.
    let mut state: XINPUT_STATE = unsafe { std::mem::zeroed() };
    let result = unsafe { XInputGetState(slot, &mut state) };
    (result == 0).then_some(state.Gamepad.wButtons)
}

#[cfg(not(windows))]
fn read_buttons(_slot: u32) -> Option<u16> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn combo_needs_both_back_and_start() {
        assert!(is_combo(0x0030));
        assert!(is_combo(0x0030 | 0x1000), "other buttons held too still count");
        assert!(!is_combo(0x0020));
        assert!(!is_combo(0x0010));
        assert!(!is_combo(0));
    }
}
