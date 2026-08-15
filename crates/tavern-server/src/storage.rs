use std::path::Path;
use std::sync::Arc;
use uuid::Uuid;

use crate::state::AppState;

pub fn dir_size(path: &Path) -> u64 {
    if !path.exists() {
        return 0;
    }
    let mut total = 0u64;
    let walker = walkdir_files(path);
    for p in walker {
        if let Ok(meta) = std::fs::metadata(&p) {
            if meta.is_file() {
                total = total.saturating_add(meta.len());
            }
        }
    }
    total
}

fn walkdir_files(dir: &Path) -> Vec<std::path::PathBuf> {
    let mut out = Vec::new();
    fn walk(cur: &Path, out: &mut Vec<std::path::PathBuf>) {
        let Ok(entries) = std::fs::read_dir(cur) else {
            return;
        };
        for e in entries.flatten() {
            let p = e.path();
            if p.is_dir() {
                walk(&p, out);
            } else {
                out.push(p);
            }
        }
    }
    walk(dir, &mut out);
    out
}

pub async fn owned_storage_bytes(state: &Arc<AppState>, owner_id: Uuid) -> anyhow::Result<u64> {
    let ids = state.db.list_owned_project_ids(owner_id).await?;
    let dirs: Vec<_> = ids
        .iter()
        .flat_map(|id| {
            [
                state.config.project_assets_dir(*id),
                state.config.project_exports_dir(*id),
                state.config.data_dir.join("imports").join(id.to_string()),
            ]
        })
        .collect();
    tokio::task::spawn_blocking(move || {
        let mut total = 0u64;
        for d in dirs {
            total = total.saturating_add(dir_size(&d));
        }
        total
    })
    .await
    .map_err(|e| anyhow::anyhow!("storage walk: {e}"))
}

pub fn format_bytes(n: u64) -> String {
    const KIB: f64 = 1024.0;
    const MIB: f64 = 1024.0 * 1024.0;
    const GIB: f64 = 1024.0 * 1024.0 * 1024.0;
    let x = n as f64;
    if x >= GIB {
        format!("{:.1} GB", x / GIB)
    } else if x >= MIB {
        format!("{:.0} MB", x / MIB)
    } else if x >= KIB {
        format!("{:.0} KB", x / KIB)
    } else {
        format!("{n} B")
    }
}
