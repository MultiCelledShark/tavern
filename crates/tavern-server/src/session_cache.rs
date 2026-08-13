use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tavern_core::User;
use uuid::Uuid;

/// In-process session lookup. Auth is a hashed PK read today; this keeps the
/// hot path off Postgres for ~60s (and until logout). 100k entries is tens of MB.
pub struct SessionCache {
    inner: Mutex<HashMap<String, Entry>>,
    max: usize,
    ttl: Duration,
}

struct Entry {
    user: User,
    until: Instant,
}

impl SessionCache {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
            max: 100_000,
            ttl: Duration::from_secs(60),
        }
    }

    pub fn get(&self, token_hash: &str) -> Option<User> {
        let now = Instant::now();
        let mut map = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        match map.get(token_hash) {
            Some(e) if e.until > now => Some(e.user.clone()),
            Some(_) => {
                map.remove(token_hash);
                None
            }
            None => None,
        }
    }

    pub fn insert(&self, token_hash: String, user: User) {
        let mut map = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if map.len() >= self.max && !map.contains_key(&token_hash) {
            if let Some(old) = map.keys().next().cloned() {
                map.remove(&old);
            }
        }
        map.insert(
            token_hash,
            Entry {
                user,
                until: Instant::now() + self.ttl,
            },
        );
    }

    pub fn remove(&self, token_hash: &str) {
        self.inner
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(token_hash);
    }

    pub fn remove_user(&self, user_id: Uuid) {
        let mut map = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        map.retain(|_, e| e.user.id != user_id);
    }
}
