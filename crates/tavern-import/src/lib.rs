//! Campfire / intermediate project import.
//!
//! Supported Campfire ingress is **HTML Export Server** dumps (`campfire_html`).
//! Proprietary desktop-only project backups are not targeted (web/Android users
//! cannot produce them). Owned intermediate JSON remains the primary portable
//! format; unknown ZIP/binary blobs are best-effort mapped or stubbed so
//! nothing is silently dropped.

use anyhow::{anyhow, Context, Result};
use serde_json::Value;
use std::collections::HashMap;
use std::io::{Cursor, Read};
use std::path::Path;
use tavern_core::{
    IntermediateElement, IntermediateLink, IntermediatePanel, IntermediateProject, ModuleType,
    PanelLayout,
};

mod campfire_html;
mod html_scan;

#[derive(Debug, Clone)]
pub struct ImportReport {
    pub format: String,
    pub title: String,
    pub element_count: usize,
    pub link_count: usize,
    pub unsupported_modules: Vec<String>,
    pub notes: Vec<String>,
}

pub fn load_path(path: &Path) -> Result<(IntermediateProject, ImportReport)> {
    let bytes = std::fs::read(path).with_context(|| format!("read {}", path.display()))?;
    load_bytes(&bytes, path.file_name().and_then(|s| s.to_str()))
}

pub fn load_bytes(
    bytes: &[u8],
    filename: Option<&str>,
) -> Result<(IntermediateProject, ImportReport)> {
    if looks_like_json(bytes) {
        let project: IntermediateProject =
            serde_json::from_slice(bytes).context("parse intermediate / tavern JSON")?;
        let report = ImportReport {
            format: "tavern_intermediate_json".into(),
            title: project.title.clone(),
            element_count: project.elements.len(),
            link_count: project.links.len(),
            unsupported_modules: vec![],
            notes: vec!["Loaded Tavern intermediate JSON".into()],
        };
        return Ok((normalize_project(project), report));
    }

    if campfire_html::looks_like_campfire_html(bytes) {
        let (project, report) = campfire_html::load_campfire_html(bytes, filename)?;
        return Ok((normalize_project(project), report));
    }

    if bytes.starts_with(b"PK") {
        return load_zip(bytes, filename);
    }

    // Opaque proprietary blob — stash as encyclopedia stub carrier
    let name = filename.unwrap_or("campfire-backup");
    let project = IntermediateProject {
        title: name.to_string(),
        synopsis: "Imported opaque Campfire backup (pending reverse-engineering)".into(),
        elements: vec![IntermediateElement {
            module_type: "encyclopedia".into(),
            title: "Imported backup (raw)".into(),
            parent_title: None,
            metadata: serde_json::json!({
                "import_source": "opaque_binary",
                "filename": name,
                "byte_length": bytes.len()
            }),
            body_markdown: Some(format!(
                "This backup could not be parsed yet.\n\nFilename: `{name}`\nSize: {} bytes\n\nProvide a sample to extend `tavern-import`.",
                bytes.len()
            )),
            panels: vec![],
            unsupported_source: Some("unknown_binary".into()),
        }],
        links: vec![],
    };
    let report = ImportReport {
        format: "opaque_binary".into(),
        title: project.title.clone(),
        element_count: 1,
        link_count: 0,
        unsupported_modules: vec!["entire_backup".into()],
        notes: vec![
            "Backup is not JSON/ZIP; stored as encyclopedia stub. Export DOCX/MD from Campfire or share a sample backup for a real mapper.".into(),
        ],
    };
    Ok((project, report))
}

fn looks_like_json(bytes: &[u8]) -> bool {
    let trimmed = bytes
        .iter()
        .skip_while(|b| b.is_ascii_whitespace())
        .copied()
        .next();
    matches!(trimmed, Some(b'{'))
}

fn load_zip(bytes: &[u8], filename: Option<&str>) -> Result<(IntermediateProject, ImportReport)> {
    const MAX_ENTRY: u64 = 32 * 1024 * 1024;
    let cursor = Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(cursor).context("open zip backup")?;
    let mut notes = vec![format!("ZIP archive with {} entries", archive.len())];
    let mut unsupported = Vec::new();

    // Prefer known intermediate / manifest names
    for candidate in [
        "tavern.json",
        "project.json",
        "manifest.json",
        "data.json",
        "export.json",
    ] {
        if let Ok(mut f) = archive.by_name(candidate) {
            if f.size() > MAX_ENTRY {
                anyhow::bail!("zip entry {candidate} too large");
            }
            let mut buf = String::new();
            f.read_to_string(&mut buf)?;
            if let Ok(project) = serde_json::from_str::<IntermediateProject>(&buf) {
                notes.push(format!("Parsed {candidate} as intermediate project"));
                let report = ImportReport {
                    format: format!("zip:{candidate}"),
                    title: project.title.clone(),
                    element_count: project.elements.len(),
                    link_count: project.links.len(),
                    unsupported_modules: vec![],
                    notes,
                };
                return Ok((normalize_project(project), report));
            }
            if let Ok(v) = serde_json::from_str::<Value>(&buf) {
                let (project, unsup) = map_generic_json(v, filename);
                unsupported.extend(unsup);
                let report = ImportReport {
                    format: format!("zip:{candidate}:generic"),
                    title: project.title.clone(),
                    element_count: project.elements.len(),
                    link_count: project.links.len(),
                    unsupported_modules: unsupported,
                    notes,
                };
                return Ok((normalize_project(project), report));
            }
        }
    }

    // Scan for any JSON files and try to harvest elements
    let names: Vec<String> = (0..archive.len())
        .filter_map(|i| archive.by_index(i).ok().map(|f| f.name().to_string()))
        .collect();
    notes.push(format!("Entries: {}", names.join(", ")));

    let mut harvested = IntermediateProject {
        title: filename.unwrap_or("Imported Project").to_string(),
        synopsis: "Harvested from ZIP backup".into(),
        elements: vec![],
        links: vec![],
    };

    for name in &names {
        if !name.ends_with(".json") {
            continue;
        }
        let Ok(mut f) = archive.by_name(name) else {
            continue;
        };
        if f.size() > MAX_ENTRY {
            notes.push(format!("Skipped oversized entry {name}"));
            continue;
        }
        let mut buf = String::new();
        if f.read_to_string(&mut buf).is_err() {
            continue;
        }
        if let Ok(v) = serde_json::from_str::<Value>(&buf) {
            let (partial, unsup) = map_generic_json(v, Some(name));
            harvested.elements.extend(partial.elements);
            harvested.links.extend(partial.links);
            unsupported.extend(unsup);
            notes.push(format!("Mapped JSON from {name}"));
        }
    }

    if harvested.elements.is_empty() {
        harvested.elements.push(IntermediateElement {
            module_type: "encyclopedia".into(),
            title: "ZIP backup (unmapped)".into(),
            parent_title: None,
            metadata: serde_json::json!({ "entries": names }),
            body_markdown: Some(format!(
                "Could not map this Campfire ZIP yet.\n\nFiles:\n{}",
                names
                    .iter()
                    .map(|n| format!("- `{n}`"))
                    .collect::<Vec<_>>()
                    .join("\n")
            )),
            panels: vec![],
            unsupported_source: Some("campfire_zip".into()),
        });
        unsupported.push("zip_structure".into());
    }

    let report = ImportReport {
        format: "zip:scanned".into(),
        title: harvested.title.clone(),
        element_count: harvested.elements.len(),
        link_count: harvested.links.len(),
        unsupported_modules: unsupported,
        notes,
    };
    Ok((normalize_project(harvested), report))
}

fn map_generic_json(v: Value, hint: Option<&str>) -> (IntermediateProject, Vec<String>) {
    let mut unsupported = Vec::new();
    let title = v
        .get("title")
        .or_else(|| v.get("name"))
        .and_then(|x| x.as_str())
        .unwrap_or(hint.unwrap_or("Imported Project"))
        .to_string();
    let synopsis = v
        .get("synopsis")
        .or_else(|| v.get("description"))
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();

    let mut elements = Vec::new();
    let mut links = Vec::new();

    // Common shapes: { elements: [...] } or { modules: { characters: [...] } }
    if let Some(arr) = v.get("elements").and_then(|x| x.as_array()) {
        for item in arr {
            elements.push(map_element_value(item, &mut unsupported));
        }
    }

    if let Some(modules) = v.get("modules").and_then(|x| x.as_object()) {
        for (mod_name, content) in modules {
            let mapped = map_module_name(mod_name);
            if mapped.is_none() {
                unsupported.push(mod_name.clone());
            }
            let module_type = mapped.unwrap_or("encyclopedia");
            if let Some(arr) = content.as_array() {
                for item in arr {
                    let mut el = map_element_value(item, &mut unsupported);
                    if el.module_type.is_empty() || el.module_type == "encyclopedia" {
                        el.module_type = module_type.to_string();
                    }
                    if mapped.is_none() {
                        el.unsupported_source = Some(mod_name.clone());
                        el.module_type = "encyclopedia".into();
                        if el.title.is_empty() {
                            el.title = format!("[{mod_name}] entry");
                        }
                    }
                    elements.push(el);
                }
            }
        }
    }

    // Character / location style top-level arrays
    for (key, module) in [
        ("characters", "character"),
        ("locations", "location"),
        ("manuscript", "manuscript"),
        ("chapters", "manuscript"),
        ("encyclopedia", "encyclopedia"),
        ("articles", "encyclopedia"),
        ("relationships", "relationship"),
        ("magic", "systems"),
        ("tech", "systems"),
        ("systems", "systems"),
    ] {
        if let Some(arr) = v.get(key).and_then(|x| x.as_array()) {
            for item in arr {
                let mut el = map_element_value(item, &mut unsupported);
                el.module_type = module.into();
                elements.push(el);
            }
        }
    }

    if let Some(arr) = v.get("links").and_then(|x| x.as_array()) {
        for item in arr {
            links.push(IntermediateLink {
                from_title: item
                    .get("from")
                    .or_else(|| item.get("from_title"))
                    .and_then(|x| x.as_str())
                    .unwrap_or("")
                    .to_string(),
                to_title: item
                    .get("to")
                    .or_else(|| item.get("to_title"))
                    .and_then(|x| x.as_str())
                    .unwrap_or("")
                    .to_string(),
                label: item
                    .get("label")
                    .and_then(|x| x.as_str())
                    .unwrap_or("")
                    .to_string(),
                link_type: item
                    .get("type")
                    .or_else(|| item.get("link_type"))
                    .and_then(|x| x.as_str())
                    .unwrap_or("related")
                    .to_string(),
            });
        }
    }

    if elements.is_empty() {
        elements.push(IntermediateElement {
            module_type: "encyclopedia".into(),
            title: format!("Raw JSON ({title})"),
            parent_title: None,
            metadata: serde_json::json!({ "keys": v.as_object().map(|o| o.keys().cloned().collect::<Vec<_>>()) }),
            body_markdown: Some(format!("```json\n{}\n```", serde_json::to_string_pretty(&v).unwrap_or_default())),
            panels: vec![],
            unsupported_source: Some("generic_json".into()),
        });
    }

    (
        IntermediateProject {
            title,
            synopsis,
            elements,
            links,
        },
        unsupported,
    )
}

fn map_module_name(name: &str) -> Option<&'static str> {
    match name.to_ascii_lowercase().as_str() {
        "manuscript" | "chapters" | "scenes" => Some("manuscript"),
        "character" | "characters" => Some("character"),
        "encyclopedia" | "articles" | "wiki" => Some("encyclopedia"),
        "relationship" | "relationships" => Some("relationship"),
        "location" | "locations" => Some("location"),
        "systems" | "magic" | "tech" | "technology" => Some("systems"),
        "maps" | "map" => Some("maps"),
        "timeline" | "timelines" | "events" => Some("timeline"),
        "species" | "races" => Some("species"),
        "cultures" | "culture" => Some("cultures"),
        "items" | "item" | "objects" => Some("items"),
        "arcs" | "arc" | "plots" | "plot" => Some("arcs"),
        "languages" | "language" => Some("languages"),
        "religions" | "religion" | "beliefs" => Some("religions"),
        "research" | "notes" => Some("research"),
        "philosophies" | "philosophy" => Some("philosophies"),
        "calendar" | "calendars" => Some("calendar"),
        _ => None,
    }
}

fn map_element_value(item: &Value, _unsupported: &mut Vec<String>) -> IntermediateElement {
    let title = item
        .get("title")
        .or_else(|| item.get("name"))
        .and_then(|x| x.as_str())
        .unwrap_or("Untitled")
        .to_string();
    let module_type = item
        .get("module_type")
        .or_else(|| item.get("type"))
        .and_then(|x| x.as_str())
        .map(|s| map_module_name(s).unwrap_or("encyclopedia").to_string())
        .unwrap_or_else(|| "encyclopedia".into());
    let body = item
        .get("body_markdown")
        .or_else(|| item.get("markdown"))
        .or_else(|| item.get("text"))
        .or_else(|| item.get("content"))
        .and_then(|x| x.as_str())
        .map(|s| s.to_string());
    let mut panels = Vec::new();
    if let Some(arr) = item.get("panels").and_then(|x| x.as_array()) {
        for p in arr {
            panels.push(IntermediatePanel {
                panel_type: p
                    .get("panel_type")
                    .or_else(|| p.get("type"))
                    .and_then(|x| x.as_str())
                    .unwrap_or("text")
                    .to_string(),
                title: p
                    .get("title")
                    .and_then(|x| x.as_str())
                    .unwrap_or("")
                    .to_string(),
                content: p
                    .get("content")
                    .cloned()
                    .unwrap_or_else(|| serde_json::json!({})),
                layout: p
                    .get("layout")
                    .and_then(|v| serde_json::from_value::<PanelLayout>(v.clone()).ok()),
                page_title: p
                    .get("page_title")
                    .and_then(|x| x.as_str())
                    .map(|s| s.to_string()),
            });
        }
    } else if let Some(md) = &body {
        panels.push(IntermediatePanel {
            panel_type: "text".into(),
            title: "Content".into(),
            content: serde_json::json!({ "markdown": md }),
            layout: None,
            page_title: None,
        });
    }

    IntermediateElement {
        module_type,
        title,
        parent_title: item
            .get("parent_title")
            .and_then(|x| x.as_str())
            .map(|s| s.to_string()),
        metadata: item
            .get("metadata")
            .cloned()
            .unwrap_or_else(|| serde_json::json!({})),
        body_markdown: body,
        panels,
        unsupported_source: None,
    }
}

fn normalize_project(mut project: IntermediateProject) -> IntermediateProject {
    for el in &mut project.elements {
        if ModuleType::parse(&el.module_type).is_none() {
            if let Some(mapped) = map_module_name(&el.module_type) {
                el.module_type = mapped.into();
            } else {
                el.unsupported_source = Some(el.module_type.clone());
                el.module_type = "encyclopedia".into();
            }
        }
    }
    project
}

/// Apply an intermediate project into the database via callbacks-style API.
pub struct PreparedImport {
    pub project: IntermediateProject,
    pub report: ImportReport,
    pub title_index: HashMap<String, ()>,
}

pub fn prepare(project: IntermediateProject, report: ImportReport) -> Result<PreparedImport> {
    if project.title.trim().is_empty() {
        return Err(anyhow!("imported project needs a title"));
    }
    let mut title_index = HashMap::new();
    for el in &project.elements {
        title_index.insert(el.title.clone(), ());
    }
    Ok(PreparedImport {
        project,
        report,
        title_index,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_intermediate_json() {
        let json = r#"{
            "title": "Test World",
            "synopsis": "A place",
            "elements": [
                {"module_type": "character", "title": "Asha", "metadata": {}, "panels": [
                    {"panel_type": "text", "title": "Bio", "content": {"markdown": "Hero"}}
                ]}
            ],
            "links": []
        }"#;
        let (p, r) = load_bytes(json.as_bytes(), Some("test.json")).unwrap();
        assert_eq!(p.title, "Test World");
        assert_eq!(p.elements.len(), 1);
        assert_eq!(r.format, "tavern_intermediate_json");
    }
}
