//! Parse Campfire "Export Server" HTML dumps (`Campfire_Export.html`).

use anyhow::Result;
use std::collections::HashMap;
use tavern_core::{IntermediateElement, IntermediateLink, IntermediatePanel, IntermediateProject};

use crate::html_scan::{
    after_marker_until, after_marker_until_all, attr_quoted, between, class_attr, collapse_ws,
    extract_sections, find_ci, html_unescape, remove_blocks_ci, remove_marked_element, replace_ci,
    replace_open_tag_ci, rewrite_wrapped_ci, strip_tags,
};
use crate::ImportReport;

pub fn looks_like_campfire_html(bytes: &[u8]) -> bool {
    let head = String::from_utf8_lossy(&bytes[..bytes.len().min(4000)]);
    head.contains("Campfire Export Server")
        || (head.contains("<!DOCTYPE html") && head.contains("Campfire Export"))
}

pub fn load_campfire_html(
    bytes: &[u8],
    filename: Option<&str>,
) -> Result<(IntermediateProject, ImportReport)> {
    let html = String::from_utf8_lossy(bytes);
    let mut elements = Vec::new();
    let mut links = Vec::new();
    let mut unsupported = Vec::new();
    let mut notes = vec![
        "Parsed Campfire HTML export".into(),
        format!("Source: {}", filename.unwrap_or("Campfire_Export.html")),
    ];
    let mut module_counts: HashMap<String, usize> = HashMap::new();

    for (item_tag, chunk) in split_export_items(&html) {
        let title = html_to_text(
            between(chunk, r#"<h2 class="item-title">"#, "</h2>").unwrap_or("Untitled"),
        );
        let subtitle = after_marker_until(chunk, r#"class="item-subtitle""#, "</")
            .map(html_to_text)
            .filter(|s| !s.is_empty());

        let (module_type, unsup) = classify_item(chunk, &title, subtitle.as_deref(), item_tag);
        *module_counts.entry(module_type.clone()).or_default() += 1;
        if let Some(ref u) = unsup {
            unsupported.push(u.clone());
        }

        let mut metadata = serde_json::json!({
            "import_source": "campfire_html",
        });
        if let Some(sub) = &subtitle {
            if campfire_module_from_label(sub).is_some() {
                metadata["campfire_module"] = serde_json::json!(sub);
            } else {
                metadata["subtitle"] = serde_json::json!(sub);
            }
        }
        if module_type == "timeline" {
            if let Some(date) = extract_timeline_date(chunk) {
                metadata["date"] = serde_json::json!(date);
            }
        }

        let mut panels = Vec::new();
        let mut body_markdown = None;

        if module_type == "manuscript" {
            body_markdown = Some(extract_manuscript(chunk));
        } else {
            for (_tag, page_html) in extract_sections(chunk, "page-section") {
                let page_title = between(page_html, r#"<h3 class="page-title">"#, "</h3>")
                    .map(html_to_text)
                    .unwrap_or_else(|| "Page".into());

                let mut page_had_panel = false;
                for (panel_tag, panel_html) in extract_sections(page_html, "panel-section") {
                    let panel_class = class_attr(panel_tag).unwrap_or_default().to_string();
                    let panel_title = between(panel_html, r#"<h4 class="panel-header">"#, "</h4>")
                        .map(html_to_text)
                        .unwrap_or_else(|| page_title.clone());

                    if let Some(mut p) =
                        map_panel(&panel_class, &panel_title, panel_html, &mut links, &title)
                    {
                        p.page_title = Some(page_title.clone());
                        panels.push(p);
                        page_had_panel = true;
                    }
                }

                if !page_had_panel {
                    let md = html_to_markdown(page_html);
                    if !md.trim().is_empty() {
                        panels.push(IntermediatePanel {
                            panel_type: "text".into(),
                            title: page_title.clone(),
                            content: serde_json::json!({ "markdown": md }),
                            layout: None,
                            page_title: Some(page_title),
                        });
                    }
                }
            }
        }

        elements.push(IntermediateElement {
            module_type,
            title,
            parent_title: None,
            metadata,
            body_markdown,
            panels,
            unsupported_source: unsup,
        });
    }

    if !module_counts.is_empty() {
        let mut parts: Vec<_> = module_counts
            .iter()
            .map(|(k, v)| format!("{v} {k}"))
            .collect();
        parts.sort();
        notes.push(format!("Mapped {}", parts.join(", ")));
    }
    if !unsupported.is_empty() {
        notes.push(format!("Heuristic fallbacks ({} items)", unsupported.len()));
    }

    unsupported.sort();
    unsupported.dedup();

    let project_title = guess_project_title(&elements).unwrap_or_else(|| {
        filename
            .unwrap_or("Campfire Import")
            .trim_end_matches(".html")
            .replace('_', " ")
    });

    let project = IntermediateProject {
        title: project_title,
        synopsis: "Imported from Campfire HTML export".into(),
        elements,
        links: dedupe_links(links),
    };

    let report = ImportReport {
        format: "campfire_html".into(),
        title: project.title.clone(),
        element_count: project.elements.len(),
        link_count: project.links.len(),
        unsupported_modules: unsupported,
        notes,
    };
    Ok((project, report))
}

/// Split on export-item opens; returns the opening tag and inner HTML for each item.
fn split_export_items(html: &str) -> Vec<(&str, &str)> {
    let marker = r#"<section class="export-item"#;
    let mut starts = Vec::new();
    let mut search = 0;
    while let Some(rel) = html[search..].find(marker) {
        let abs = search + rel;
        starts.push(abs);
        search = abs + marker.len();
    }
    let mut out = Vec::new();
    for (i, &start) in starts.iter().enumerate() {
        let Some(gt) = html[start..].find('>') else {
            continue;
        };
        let tag_end = start + gt + 1;
        let item_tag = &html[start..tag_end];
        let content_start = tag_end;
        let content_end = starts.get(i + 1).copied().unwrap_or(html.len());
        let mut chunk = &html[content_start..content_end];
        if let Some(idx) = chunk.rfind("</section>") {
            chunk = &chunk[..idx];
        }
        out.push((item_tag, chunk));
    }
    out
}

fn campfire_module_from_label(label: &str) -> Option<&'static str> {
    match label.trim().to_ascii_lowercase().as_str() {
        "manuscript" | "manuscripts" | "chapter" | "chapters" | "scene" | "scenes" => {
            Some("manuscript")
        }
        "character" | "characters" => Some("character"),
        "encyclopedia" | "article" | "articles" => Some("encyclopedia"),
        "relationship" | "relationships" => Some("relationship"),
        "location" | "locations" | "place" | "places" => Some("location"),
        "systems" | "system" | "magic" | "tech" | "technology" => Some("systems"),
        "maps" | "map" => Some("maps"),
        "timeline" | "timelines" | "event" | "events" => Some("timeline"),
        "species" | "races" | "race" => Some("species"),
        "cultures" | "culture" => Some("cultures"),
        "items" | "item" | "objects" | "object" => Some("items"),
        "arcs" | "arc" | "plots" | "plot" => Some("arcs"),
        "languages" | "language" => Some("languages"),
        "religions" | "religion" | "beliefs" | "belief" => Some("religions"),
        "research" | "notes" => Some("research"),
        "philosophies" | "philosophy" => Some("philosophies"),
        "calendar" | "calendars" => Some("calendar"),
        _ => None,
    }
}

fn classify_item(
    chunk: &str,
    title: &str,
    subtitle: Option<&str>,
    item_tag: &str,
) -> (String, Option<String>) {
    if chunk.contains("manuscript-content") || chunk.contains("class=\"manuscript\"") {
        return ("manuscript".into(), None);
    }

    // Real Campfire exports put nicknames in item-subtitle; only trust it when it
    // is an actual module label (e.g. "Characters", "Timeline").
    if let Some(sub) = subtitle {
        if let Some(mt) = campfire_module_from_label(sub) {
            return (mt.into(), None);
        }
    }

    if let Some(class) = class_attr(item_tag) {
        // `<section class="export-item character foo">` → tokens after export-item
        if let Some(rest) = class.strip_prefix("export-item") {
            for token in rest.split_whitespace() {
                if let Some(mt) = campfire_module_from_label(token) {
                    return (mt.into(), None);
                }
            }
        }
    }

    if is_research(chunk) {
        return ("research".into(), None);
    }
    if is_location(chunk) || title_looks_like_place(title) {
        return ("location".into(), None);
    }
    if is_character(chunk) || title_looks_like_person(title, chunk) {
        return ("character".into(), None);
    }
    if title_looks_like_species(title) {
        return ("species".into(), Some("species_heuristic".into()));
    }
    if looks_like_timeline(title, chunk) {
        return ("timeline".into(), Some("timeline_heuristic".into()));
    }
    if chunk.contains(">Magic</") || chunk.contains(">Technology</") {
        return ("systems".into(), None);
    }
    ("encyclopedia".into(), Some("unclassified".into()))
}

fn is_research(chunk: &str) -> bool {
    chunk.contains("panel-research")
        || chunk.contains("research-panel")
        || chunk.contains("class=\"research\"")
}

fn extract_timeline_date(chunk: &str) -> Option<String> {
    for (key, value) in iter_attr_rows(chunk) {
        if key.eq_ignore_ascii_case("date")
            || key.eq_ignore_ascii_case("when")
            || key.eq_ignore_ascii_case("year")
        {
            if !value.is_empty() {
                return Some(value);
            }
        }
    }
    None
}

fn iter_attr_rows(html: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut pos = 0;
    let open = r#"<div class="attribute-row">"#;
    while let Some(rel) = html[pos..].find(open) {
        let abs = pos + rel + open.len();
        let Some(key) = between(&html[abs..], r#"<dt class="attribute-label">"#, "</dt>") else {
            pos = abs;
            continue;
        };
        let after_key = abs
            + html[abs..]
                .find("</dt>")
                .map(|i| i + "</dt>".len())
                .unwrap_or(0);
        let Some(value) = between(
            &html[after_key..],
            r#"<dd class="attribute-value">"#,
            "</dd>",
        ) else {
            pos = after_key;
            continue;
        };
        out.push((html_to_text(key), html_to_text(value)));
        pos = after_key
            + html[after_key..]
                .find("</dd>")
                .map(|i| i + "</dd>".len())
                .unwrap_or(1);
    }
    out
}

fn iter_list_items(html: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut pos = 0;
    while let Some(rel) = html
        .get(pos..)
        .and_then(|s| s.find(r#"class="list-item-title""#))
    {
        let abs = pos + rel;
        let Some(title) = after_marker_until(&html[abs..], r#"class="list-item-title""#, "</h6>")
        else {
            pos = abs + 1;
            continue;
        };
        let after_title = abs
            + html[abs..]
                .find("</h6>")
                .map(|i| i + "</h6>".len())
                .unwrap_or(1);
        let desc = after_marker_until(
            &html[after_title..],
            r#"class="list-item-description""#,
            "</div>",
        )
        .unwrap_or("");
        out.push((html_to_text(title), html_to_text(desc)));
        pos = html[after_title..]
            .find(r#"class="list-item-description""#)
            .and_then(|i| {
                let s = after_title + i;
                html[s..].find("</div>").map(|j| s + j + "</div>".len())
            })
            .unwrap_or(after_title + 1);
    }
    out
}

fn iter_stat_items(html: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut pos = 0;
    while let Some(rel) = html.get(pos..).and_then(|s| s.find(r#"class="stat-name""#)) {
        let abs = pos + rel;
        let Some(name) = after_marker_until(&html[abs..], r#"class="stat-name""#, "</span>") else {
            pos = abs + 1;
            continue;
        };
        let after_name = abs
            + html[abs..]
                .find("</span>")
                .map(|i| i + "</span>".len())
                .unwrap_or(1);
        let value = after_marker_until(&html[after_name..], r#"class="stat-value""#, "</span>")
            .unwrap_or("");
        out.push((html_to_text(name), html_to_text(value)));
        pos = html[after_name..]
            .find(r#"class="stat-value""#)
            .and_then(|i| {
                let s = after_name + i;
                html[s..].find("</span>").map(|j| s + j + "</span>".len())
            })
            .unwrap_or(after_name + 1);
    }
    out
}

fn iter_link_names(html: &str) -> Vec<String> {
    after_marker_until_all(html, r#"class="link-name""#, "</")
        .into_iter()
        .map(html_to_text)
        .filter(|s| !s.is_empty())
        .collect()
}

fn iter_tag_badges(html: &str) -> Vec<String> {
    after_marker_until_all(html, r#"class="tag-badge""#, "</")
        .into_iter()
        .map(html_to_text)
        .filter(|s| !s.is_empty())
        .collect()
}

fn is_character(chunk: &str) -> bool {
    chunk.contains("Personality Traits")
        || chunk.contains("Physical Traits")
        || chunk.contains(">Sex</dt>")
        || chunk.contains(">Age</dt>")
        || chunk.contains(">Role</dt>")
        || chunk.contains(">Backstory</h3>")
        || chunk.contains(">Backstory</h4>")
}

fn title_looks_like_person(title: &str, chunk: &str) -> bool {
    if looks_like_timeline(title, chunk)
        || title_looks_like_place(title)
        || title_looks_like_species(title)
        || is_research(chunk)
    {
        return false;
    }
    let words = title.split_whitespace().count();
    let has_subtitle = chunk.contains("item-subtitle");
    // Empty character stubs often still have an empty page-panels container;
    // timeline stubs frequently omit it.
    let has_panels_slot = chunk.contains("page-panels");
    (words <= 2 && has_subtitle)
        || (words == 1 && has_panels_slot && !title.contains('-') && !title.contains('_'))
}

fn title_looks_like_species(title: &str) -> bool {
    let t = title.to_ascii_lowercase();
    t.contains("morph")
        || t.contains("species")
        || t.contains("race")
        || t.ends_with("folk")
        || t.ends_with("kin")
}

fn title_looks_like_place(title: &str) -> bool {
    let t = title.to_ascii_lowercase();
    t.contains("landing")
        || t.contains(" station")
        || t.contains(" port")
        || t.ends_with("city")
        || t.ends_with(" colony")
}

fn is_location(chunk: &str) -> bool {
    chunk.contains(">Geography</h4>")
        || chunk.contains(">Weather</h4>")
        || (chunk.contains(">History</h4>") && chunk.contains("attributes-list"))
}

fn looks_like_timeline(title: &str, _chunk: &str) -> bool {
    let t = title.to_ascii_lowercase();
    // Event-style titles from Campfire Timeline modules. Avoid nouns like
    // "species" / "morphs" that belong to research or species entries.
    let signals = [
        "proposed",
        "begins",
        "begin",
        "launch",
        "enters",
        " enter ",
        "disabled",
        "online",
        "manufactures",
        "attempted",
        "established",
        "reassigned",
        "refitted",
        "constructed",
        "founded",
        "destroyed",
        "arrived",
        "departs",
        "departed",
    ];
    if signals.iter().any(|v| t.contains(v)) {
        return true;
    }
    // "Colony Ships Enter neighboring clusters"
    t.split_whitespace().any(|w| w == "enter" || w == "enters")
}

fn map_panel(
    panel_class: &str,
    panel_title: &str,
    panel_html: &str,
    links: &mut Vec<IntermediateLink>,
    from_title: &str,
) -> Option<IntermediatePanel> {
    let class = panel_class.to_ascii_lowercase();
    if class.contains("panel-custom") || panel_html.contains("attributes-list") {
        let mut items = Vec::new();
        for (key, value) in iter_attr_rows(panel_html) {
            if !key.is_empty() {
                items.push(serde_json::json!({ "key": key, "value": value }));
            }
        }
        return Some(IntermediatePanel {
            panel_type: "attributes".into(),
            title: panel_title.into(),
            content: serde_json::json!({ "items": items }),
            layout: None,
            page_title: None,
        });
    }
    if class.contains("panel-list") || class.contains("list-panel") {
        let mut items = Vec::new();
        for (title, desc) in iter_list_items(panel_html) {
            let line = if title.is_empty() {
                desc
            } else if desc.is_empty() {
                title
            } else {
                format!("{title}: {desc}")
            };
            if !line.is_empty() {
                items.push(line);
            }
        }
        if items.is_empty() {
            items.extend(iter_tag_badges(panel_html));
        }
        return Some(IntermediatePanel {
            panel_type: "list".into(),
            title: panel_title.into(),
            content: serde_json::json!({ "items": items }),
            layout: None,
            page_title: None,
        });
    }
    if class.contains("panel-table")
        || class.contains("table-panel")
        || panel_html.contains("<table")
    {
        if let Some(table) = extract_table(panel_html) {
            return Some(IntermediatePanel {
                panel_type: "table".into(),
                title: panel_title.into(),
                content: table,
                layout: None,
                page_title: None,
            });
        }
    }
    if class.contains("panel-image") || panel_title.eq_ignore_ascii_case("Image") {
        let images = extract_images(panel_html);
        return Some(IntermediatePanel {
            panel_type: "image".into(),
            title: panel_title.into(),
            content: serde_json::json!({ "images": images }),
            layout: None,
            page_title: None,
        });
    }
    if class.contains("link") || panel_title.eq_ignore_ascii_case("Links") {
        for to in iter_link_names(panel_html) {
            links.push(IntermediateLink {
                from_title: from_title.into(),
                to_title: to,
                label: "linked".into(),
                link_type: "related".into(),
            });
        }
        return Some(IntermediatePanel {
            panel_type: "links".into(),
            title: panel_title.into(),
            content: serde_json::json!({ "element_ids": [] }),
            layout: None,
            page_title: None,
        });
    }
    if class.contains("stat")
        || panel_html.contains("stats-panel")
        || panel_html.contains("stat-item")
    {
        let mut items = Vec::new();
        for (key, value) in iter_stat_items(panel_html) {
            if !key.is_empty() || !value.is_empty() {
                items.push(serde_json::json!({ "key": key, "value": value }));
            }
        }
        if items.is_empty() {
            for (key, value) in iter_attr_rows(panel_html) {
                if !key.is_empty() {
                    items.push(serde_json::json!({ "key": key, "value": value }));
                }
            }
        }
        if !items.is_empty() {
            return Some(IntermediatePanel {
                panel_type: "stats".into(),
                title: panel_title.into(),
                content: serde_json::json!({ "items": items }),
                layout: None,
                page_title: None,
            });
        }
    }
    if class.contains("research") || panel_html.contains("research-panel") {
        let md = if let Some(inner) =
            after_marker_until(panel_html, r#"class="research-text-content""#, "</div>")
        {
            html_to_markdown(inner)
        } else {
            html_to_markdown(panel_html)
        };
        if md.trim().is_empty() {
            return None;
        }
        return Some(IntermediatePanel {
            panel_type: "text".into(),
            title: panel_title.into(),
            content: serde_json::json!({ "markdown": md }),
            layout: None,
            page_title: None,
        });
    }
    let md = html_to_markdown(panel_html);
    if md.trim().is_empty() {
        return None;
    }
    Some(IntermediatePanel {
        panel_type: "text".into(),
        title: panel_title.into(),
        content: serde_json::json!({ "markdown": md }),
        layout: None,
        page_title: None,
    })
}

fn extract_table(html: &str) -> Option<serde_json::Value> {
    let mut rows = Vec::new();
    let mut pos = 0;
    while let Some(rel) = find_ci(&html[pos..], "<tr") {
        let abs = pos + rel;
        let Some(gt) = html[abs..].find('>') else {
            break;
        };
        let inner_start = abs + gt + 1;
        let Some(close_rel) = find_ci(&html[inner_start..], "</tr>") else {
            break;
        };
        let row_html = &html[inner_start..inner_start + close_rel];
        let mut cells = Vec::new();
        let mut cell_pos = 0;
        loop {
            let td = find_ci(&row_html[cell_pos..], "<td").map(|i| (i, false));
            let th = find_ci(&row_html[cell_pos..], "<th").map(|i| (i, true));
            let next = match (td, th) {
                (Some((a, _)), Some((b, _))) if a <= b => td,
                (Some(_), Some(_)) => th,
                (Some(_), None) => td,
                (None, Some(_)) => th,
                (None, None) => None,
            };
            let Some((rel, is_th)) = next else {
                break;
            };
            let cell_abs = cell_pos + rel;
            let after_open = cell_abs + 3; // "<td" / "<th"
                                           // name-bound: next char must be tag boundary
            if after_open < row_html.len() {
                let c = row_html.as_bytes()[after_open];
                if c != b'>' && c != b'/' && !c.is_ascii_whitespace() {
                    cell_pos = after_open;
                    continue;
                }
            }
            let Some(gt) = row_html[cell_abs..].find('>') else {
                break;
            };
            let content_start = cell_abs + gt + 1;
            let close = if is_th { "</th>" } else { "</td>" };
            let Some(cend) = find_ci(&row_html[content_start..], close) else {
                break;
            };
            cells.push(html_to_text(&row_html[content_start..content_start + cend]));
            cell_pos = content_start + cend + close.len();
        }
        if !cells.is_empty() {
            rows.push(cells);
        }
        pos = inner_start + close_rel + "</tr>".len();
    }
    if rows.is_empty() {
        return None;
    }
    let headers = rows[0].clone();
    let body = if rows.len() > 1 {
        rows[1..].to_vec()
    } else {
        vec![]
    };
    Some(serde_json::json!({ "headers": headers, "rows": body }))
}

fn extract_images(html: &str) -> Vec<serde_json::Value> {
    let mut out = Vec::new();
    let mut pos = 0;
    while let Some(rel) = find_ci(&html[pos..], "<img") {
        let abs = pos + rel;
        // name-bound: <img not <important
        let after = abs + 4;
        if after < html.len() {
            let c = html.as_bytes()[after];
            if c != b'>' && c != b'/' && !c.is_ascii_whitespace() {
                pos = after;
                continue;
            }
        }
        let Some(gt) = html[abs..].find('>') else {
            break;
        };
        let tag = &html[abs..abs + gt + 1];
        let url = attr_quoted(tag, "src").unwrap_or("").trim();
        if url.is_empty() {
            pos = abs + gt + 1;
            continue;
        }
        let mut caption = attr_quoted(tag, "alt")
            .map(html_to_text)
            .filter(|s| !s.is_empty());
        if caption.is_none() {
            if let Some(cap) = after_marker_until(html, r#"class="image-caption""#, "</") {
                let t = html_to_text(cap);
                if !t.is_empty() {
                    caption = Some(t);
                }
            }
        }
        out.push(if let Some(c) = caption {
            serde_json::json!({ "url": url, "caption": c })
        } else {
            serde_json::json!({ "url": url })
        });
        pos = abs + gt + 1;
    }
    out
}

fn extract_manuscript(chunk: &str) -> String {
    if let Some(marker) = chunk.find(r#"class="manuscript-content""#) {
        let after_marker = &chunk[marker..];
        if let Some(gt) = after_marker.find('>') {
            let content_start = marker + gt + 1;
            if let Some(notes_rel) = chunk[content_start..].find(r#"class="manuscript-notes""#) {
                let before_notes = &chunk[content_start..content_start + notes_rel];
                if let Some(end) = before_notes.rfind("</div>") {
                    return html_to_markdown(&before_notes[..end]);
                }
            }
            if let Some(end) = chunk[content_start..].find("</div>") {
                return html_to_markdown(&chunk[content_start..content_start + end]);
            }
        }
    }
    let mut md = String::new();
    for (_tag, page_html) in extract_sections(chunk, "page-section") {
        let t = between(page_html, r#"<h3 class="page-title">"#, "</h3>")
            .map(html_to_text)
            .unwrap_or_default();
        let body = html_to_markdown(page_html);
        if !body.trim().is_empty() {
            if !t.is_empty() {
                md.push_str(&format!("## {t}\n\n"));
            }
            md.push_str(&body);
            md.push_str("\n\n");
        }
    }
    md
}

fn guess_project_title(elements: &[IntermediateElement]) -> Option<String> {
    elements
        .iter()
        .find(|e| e.module_type == "location")
        .map(|e| e.title.clone())
        .or_else(|| {
            elements
                .iter()
                .find(|e| e.module_type == "character")
                .map(|e| format!("{}'s Story", e.title))
        })
}

fn dedupe_links(links: Vec<IntermediateLink>) -> Vec<IntermediateLink> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for link in links {
        let key = (
            link.from_title.clone(),
            link.to_title.clone(),
            link.link_type.clone(),
        );
        if seen.insert(key) {
            out.push(link);
        }
    }
    out
}

fn html_to_text(s: &str) -> String {
    let mut out = s.to_string();
    out = remove_blocks_ci(out, "<script", "</script>");
    out = remove_blocks_ci(out, "<style", "</style>");
    out = replace_ci(out, "<br>", "\n");
    out = replace_ci(out, "<br/>", "\n");
    out = replace_ci(out, "<br />", "\n");
    out = replace_ci(out, "</p>", "\n");
    out = replace_ci(out, "</P>", "\n");
    // strip remaining tags → spaces (matches prior regex behavior)
    let stripped = {
        let mut buf = String::with_capacity(out.len());
        let mut in_tag = false;
        for ch in out.chars() {
            match ch {
                '<' => {
                    in_tag = true;
                    buf.push(' ');
                }
                '>' => in_tag = false,
                _ if !in_tag => buf.push(ch),
                _ => {}
            }
        }
        buf
    };
    collapse_ws(&html_unescape(&stripped))
}

fn html_to_markdown(s: &str) -> String {
    let mut out = s.to_string();
    out = remove_blocks_ci(out, "<script", "</script>");
    out = remove_blocks_ci(out, "<style", "</style>");
    out = remove_marked_element(out, r#"<h4 class="panel-header">"#, "</h4>");
    out = remove_marked_element(out, r#"<header class="page-header">"#, "</header>");
    out = replace_ci(out, "<br>", "\n");
    out = replace_ci(out, "<br/>", "\n");
    out = replace_ci(out, "<br />", "\n");
    out = replace_ci(out, "</p>", "\n\n");
    out = replace_ci(out, "</P>", "\n\n");
    out = replace_open_tag_ci(out, "p", "");
    out = rewrite_wrapped_ci(out, "strong", "**", "**");
    out = rewrite_wrapped_ci(out, "b", "**", "**");
    out = rewrite_wrapped_ci(out, "em", "*", "*");
    out = rewrite_wrapped_ci(out, "i", "*", "*");
    out = replace_open_tag_ci(out, "li", "- ");
    out = replace_ci(out, "</li>", "\n");
    out = replace_ci(out, "</LI>", "\n");
    out = strip_tags(&out);
    out = html_unescape(&out);
    let lines: Vec<_> = out.lines().map(|l| l.trim_end()).collect();
    let mut cleaned = String::new();
    let mut blank = 0;
    for line in lines {
        if line.trim().is_empty() {
            blank += 1;
            if blank <= 2 {
                cleaned.push('\n');
            }
        } else {
            blank = 0;
            cleaned.push_str(line.trim_start());
            cleaned.push('\n');
        }
    }
    cleaned.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = include_str!("../../../samples/campfire_export.html");

    #[test]
    fn detects_generator() {
        let s = br#"<html><head><meta name="generator" content="Campfire Export Server">"#;
        assert!(looks_like_campfire_html(s));
    }

    #[test]
    fn parses_sample_export() {
        let (project, report) =
            load_campfire_html(FIXTURE.as_bytes(), Some("campfire_export.html"))
                .expect("parse sample");
        assert_eq!(report.format, "campfire_html");
        assert!(project.elements.len() >= 8, "expected multiple modules");

        let modules: std::collections::HashSet<_> = project
            .elements
            .iter()
            .map(|e| e.module_type.as_str())
            .collect();
        assert!(modules.contains("character"));
        assert!(modules.contains("location"));
        assert!(modules.contains("manuscript"));
        assert!(modules.contains("timeline"));
        assert!(modules.contains("species"));
        assert!(modules.contains("research"));

        let sirah = project
            .elements
            .iter()
            .find(|e| e.title == "Sirah")
            .expect("character");
        assert_eq!(sirah.module_type, "character");
        assert!(sirah.panels.iter().any(|p| p.panel_type == "attributes"));
        assert!(sirah.panels.iter().any(|p| p.panel_type == "stats"));
        assert!(sirah.panels.iter().any(|p| p.panel_type == "image"));
        assert!(sirah
            .panels
            .iter()
            .any(|p| p.page_title.as_deref() == Some("Backstory")));

        let rati = project
            .elements
            .iter()
            .find(|e| e.title == "Rati")
            .expect("character with nickname");
        assert_eq!(rati.module_type, "character");
        assert_eq!(rati.metadata["subtitle"], "The Ship");
        assert!(rati.metadata.get("campfire_module").is_none());

        let research = project
            .elements
            .iter()
            .find(|e| e.title == "Hurricane Effects on Radios")
            .expect("research");
        assert_eq!(research.module_type, "research");

        let species = project
            .elements
            .iter()
            .find(|e| e.title == "Shark-morphs")
            .expect("species");
        assert_eq!(species.module_type, "species");

        let timeline = project
            .elements
            .iter()
            .find(|e| e.title == "Colony Ships Enter neighboring clusters")
            .expect("timeline event");
        assert_eq!(timeline.module_type, "timeline");

        // Duplicate Links panels across pages should not duplicate edges.
        assert_eq!(project.links.len(), 2);
    }

    #[test]
    fn maps_subtitle_modules() {
        assert_eq!(campfire_module_from_label("Characters"), Some("character"));
        assert_eq!(campfire_module_from_label("Timeline"), Some("timeline"));
        assert_eq!(campfire_module_from_label("Species"), Some("species"));
        assert_eq!(campfire_module_from_label("Research"), Some("research"));
        assert_eq!(campfire_module_from_label("The Ship"), None);
    }
}
