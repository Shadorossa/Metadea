// Token bucket for Sakugabooru requests: about one request a second on
// average, with at most `capacity` sent back to back after a quiet spell.
//
// `reserve` is a reservation, not a check: it always takes a token (the
// balance may go negative) and returns how long the caller must wait before
// sending. The lock is held only for that arithmetic, never across the
// sleep, so concurrent callers queue up in order, each a second after the
// previous one once the burst is spent.
use std::time::{Duration, Instant};

#[derive(Debug, Clone)]
pub(crate) struct TokenBucket {
    capacity: f64,
    per_sec: f64,
    tokens: f64,
    last: Option<Instant>,
}

impl TokenBucket {
    pub(crate) fn new(capacity: u32, per_sec: f64) -> Self {
        Self { capacity: f64::from(capacity), per_sec, tokens: f64::from(capacity), last: None }
    }

    /// Takes one token at `now`; the returned duration is how long to wait
    /// before sending (zero while the burst lasts).
    pub(crate) fn reserve(&mut self, now: Instant) -> Duration {
        if let Some(last) = self.last {
            let elapsed = now.saturating_duration_since(last).as_secs_f64();
            self.tokens = (self.tokens + elapsed * self.per_sec).min(self.capacity);
        }
        self.last = Some(now);
        self.tokens -= 1.0;
        if self.tokens >= 0.0 {
            Duration::ZERO
        } else {
            Duration::from_secs_f64(-self.tokens / self.per_sec)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn secs(d: Duration) -> f64 {
        (d.as_secs_f64() * 1000.0).round() / 1000.0
    }

    #[test]
    fn a_burst_of_three_then_one_per_second() {
        let start = Instant::now();
        let mut bucket = TokenBucket::new(3, 1.0);
        let waits: Vec<f64> = (0..6).map(|_| secs(bucket.reserve(start))).collect();
        assert_eq!(waits, vec![0.0, 0.0, 0.0, 1.0, 2.0, 3.0]);
    }

    #[test]
    fn idle_time_refills_but_never_beyond_the_burst() {
        let start = Instant::now();
        let mut bucket = TokenBucket::new(3, 1.0);
        for _ in 0..3 {
            bucket.reserve(start);
        }
        // A minute of silence refills to 3, not 60.
        let later = start + Duration::from_secs(60);
        let waits: Vec<f64> = (0..4).map(|_| secs(bucket.reserve(later))).collect();
        assert_eq!(waits, vec![0.0, 0.0, 0.0, 1.0]);
    }

    #[test]
    fn steady_one_per_second_never_waits() {
        let start = Instant::now();
        let mut bucket = TokenBucket::new(3, 1.0);
        for i in 0..10 {
            assert_eq!(bucket.reserve(start + Duration::from_secs(i)), Duration::ZERO);
        }
    }

    #[test]
    fn half_a_second_later_the_queue_is_half_a_second_shorter() {
        let start = Instant::now();
        let mut bucket = TokenBucket::new(3, 1.0);
        for _ in 0..3 {
            bucket.reserve(start);
        }
        assert_eq!(secs(bucket.reserve(start + Duration::from_millis(500))), 0.5);
    }
}
