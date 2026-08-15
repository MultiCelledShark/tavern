use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// In-process sliding window. Fine on one box; put a reverse-proxy limit in
/// front when you outgrow a single tavern process.
pub struct RateLimiter {
    inner: Mutex<HashMap<String, Vec<Instant>>>,
    max_keys: usize,
}

impl RateLimiter {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
            max_keys: 100_000,
        }
    }

    /// True when `key` is already at or over `limit` in `window` (does not record).
    pub fn is_limited(&self, key: &str, limit: u32, window: Duration) -> bool {
        let now = Instant::now();
        let mut map = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let Some(hits) = map.get_mut(key) else {
            return false;
        };
        hits.retain(|t| now.duration_since(*t) < window);
        hits.len() as u32 >= limit
    }

    /// Record one hit for `key` (prunes expired entries).
    pub fn hit(&self, key: &str, window: Duration) {
        let now = Instant::now();
        let mut map = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if map.len() >= self.max_keys && !map.contains_key(key) {
            if let Some(old) = map.keys().next().cloned() {
                map.remove(&old);
            }
        }
        let hits = map.entry(key.to_string()).or_default();
        hits.retain(|t| now.duration_since(*t) < window);
        hits.push(now);
    }

    /// Atomically reject if already limited, otherwise record a hit and allow.
    pub fn check(&self, key: &str, limit: u32, window: Duration) -> bool {
        let now = Instant::now();
        let mut map = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if map.len() >= self.max_keys && !map.contains_key(key) {
            if let Some(old) = map.keys().next().cloned() {
                map.remove(&old);
            }
        }
        let hits = map.entry(key.to_string()).or_default();
        hits.retain(|t| now.duration_since(*t) < window);
        if hits.len() as u32 >= limit {
            return false;
        }
        hits.push(now);
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn successful_path_can_peek_without_consuming() {
        let lim = RateLimiter::new();
        let w = Duration::from_secs(60);
        assert!(!lim.is_limited("k", 2, w));
        assert!(!lim.is_limited("k", 2, w));
        lim.hit("k", w);
        lim.hit("k", w);
        assert!(lim.is_limited("k", 2, w));
    }

    #[test]
    fn check_still_counts_each_call() {
        let lim = RateLimiter::new();
        let w = Duration::from_secs(60);
        assert!(lim.check("k", 2, w));
        assert!(lim.check("k", 2, w));
        assert!(!lim.check("k", 2, w));
    }
}
