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
            max_keys: 50_000,
        }
    }

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
