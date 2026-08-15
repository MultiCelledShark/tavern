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

    /// Drop expired hits and empty buckets. Returns whether `key` is present.
    fn sweep(map: &mut HashMap<String, Vec<Instant>>, now: Instant, window: Duration, key: &str) -> bool {
        let mut empty = Vec::new();
        for (k, hits) in map.iter_mut() {
            hits.retain(|t| now.duration_since(*t) < window);
            if hits.is_empty() {
                empty.push(k.clone());
            }
        }
        for k in empty {
            map.remove(&k);
        }
        map.contains_key(key)
    }

    /// Ensure `key` can be inserted. Never evicts live victim keys — if the map is
    /// saturated with in-window entries, refuse new keys (fail closed).
    fn ensure_capacity(
        map: &mut HashMap<String, Vec<Instant>>,
        now: Instant,
        window: Duration,
        key: &str,
        max_keys: usize,
    ) -> bool {
        if map.contains_key(key) || map.len() < max_keys {
            return true;
        }
        Self::sweep(map, now, window, key);
        map.contains_key(key) || map.len() < max_keys
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
        if !Self::ensure_capacity(&mut map, now, window, key, self.max_keys) {
            return;
        }
        let hits = map.entry(key.to_string()).or_default();
        hits.retain(|t| now.duration_since(*t) < window);
        hits.push(now);
    }

    /// Atomically reject if already limited, otherwise record a hit and allow.
    pub fn check(&self, key: &str, limit: u32, window: Duration) -> bool {
        let now = Instant::now();
        let mut map = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if !Self::ensure_capacity(&mut map, now, window, key, self.max_keys) {
            return false;
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

    #[test]
    fn saturated_map_does_not_evict_live_keys() {
        let lim = RateLimiter {
            inner: Mutex::new(HashMap::new()),
            max_keys: 2,
        };
        let w = Duration::from_secs(60);
        assert!(lim.check("victim", 10, w));
        assert!(lim.check("other", 10, w));
        assert!(!lim.check("attacker", 10, w));
        // Victim bucket still tracked and can accumulate hits.
        assert!(!lim.is_limited("victim", 2, w));
        lim.hit("victim", w);
        assert!(lim.is_limited("victim", 2, w));
    }
}
