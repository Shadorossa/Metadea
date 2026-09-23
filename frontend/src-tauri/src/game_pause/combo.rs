//! The controller combo that opens the pause menu: Select/Back + Start held
//! together for [`COMBO_HOLD_MS`]. Pure and clock-injected.

/// How long the combo must be held.
pub const COMBO_HOLD_MS: u64 = 1500;

/// One hold of the combo fires once; it fires again only after a release.
#[derive(Debug, Default, Clone)]
pub struct ComboHold {
    held_since: Option<u64>,
    fired: bool,
}

impl ComboHold {
    /// Feeds one poll (`held`: both buttons down on some pad). True exactly
    /// once per hold that reaches `hold_ms`.
    pub fn update(&mut self, held: bool, now_ms: u64, hold_ms: u64) -> bool {
        if !held {
            self.held_since = None;
            self.fired = false;
            return false;
        }
        let since = *self.held_since.get_or_insert(now_ms);
        if !self.fired && now_ms.saturating_sub(since) >= hold_ms {
            self.fired = true;
            return true;
        }
        false
    }

    /// After the menu closes: a combo still held from before must be
    /// released before it can fire again.
    pub fn require_release(&mut self) {
        self.fired = true;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(hold: &mut ComboHold, frames: &[(bool, u64)]) -> Vec<u64> {
        frames.iter().filter(|(held, at)| hold.update(*held, *at, COMBO_HOLD_MS)).map(|(_, at)| *at).collect()
    }

    #[test]
    fn fires_once_after_the_full_hold() {
        let mut hold = ComboHold::default();
        let frames: Vec<(bool, u64)> = (0..=200).map(|i| (true, 1000 + i * 16)).collect();
        assert_eq!(run(&mut hold, &frames), vec![1000 + 94 * 16], "first poll at or past 1500 ms");
    }

    #[test]
    fn a_release_before_the_hold_completes_starts_over() {
        let mut hold = ComboHold::default();
        assert!(run(&mut hold, &[(true, 0), (true, 1400), (false, 1416), (true, 1432), (true, 2900)]).is_empty());
        assert_eq!(run(&mut hold, &[(true, 2932)]), vec![2932]);
    }

    #[test]
    fn it_rearms_only_after_a_release() {
        let mut hold = ComboHold::default();
        assert_eq!(run(&mut hold, &[(true, 0), (true, 1500), (true, 5000)]), vec![1500]);
        assert_eq!(run(&mut hold, &[(false, 5016), (true, 5032), (true, 6532)]), vec![6532]);
    }

    #[test]
    fn a_combo_still_held_when_the_menu_closes_does_not_reopen_it() {
        let mut hold = ComboHold::default();
        hold.update(true, 0, COMBO_HOLD_MS);
        hold.require_release();
        assert!(run(&mut hold, &[(true, 3000), (true, 9000)]).is_empty());
        assert_eq!(run(&mut hold, &[(false, 9016), (true, 9032), (true, 10532)]), vec![10532]);
    }
}
