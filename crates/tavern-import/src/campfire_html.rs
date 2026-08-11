//! Parse Campfire "Export Server" HTML dumps (`Campfire_Export.html`).

use anyhow::Result;
use once_cell::sync::Lazy;
use regex::Regex;
use tavern_core::{
    IntermediateElement, IntermediateLink, IntermediatePanel, IntermediateProject,
};

use crate::ImportReport;

static RE_TITLE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"(?s)<h2 class="item-title">(.*?)</h2>"#).unwrap());
static RE_SUBTITLE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"(?s)class="item-subtitle"[^>]*>(.*?)</"#).unwrap());
static RE_PAGE_TITLE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"(?s)<h3 class="page-title">(.*?)</h3>"#).unwrap());
static RE_PANEL_HEADER: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"(?s)<h4 class="panel-header">(.*?)</h4>"#).unwrap());
static RE_ATTR_ROW: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r#"(?s)<div class="attribute-row"><dt class="attribute-label">(.*?)</dt><dd class="attribute-value">(.*?)</dd></div>"#,
    )
    .unwrap()
});
static RE_MS: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"(?s)<div class="manuscript-content"[^>]*>(.*?)</div>\s*<div class="manuscript-notes"#).unwrap()
});
static RE_MS_FALLBACK: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"(?s)class="manuscript-content"[^>]*>(.*?)</div>"#).unwrap());
static RE_LINK_NAME: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"(?s)class="link-name"[^>]*>(.*?)</"#).unwrap());
static RE_LIST_ITEM: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r#"(?s)class="list-item-title"[^>]*>(.*?)</h6>.*?class="list-item-description"[^>]*>(.*?)</div>"#,
    )
    .unwrap()
});
static RE_SECTION_OPEN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)<section\b[^>]*>").unwrap());
static RE_SECTION_CLOSE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)</section>").unwrap());
static RE_CLASS: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"class="([^"]*)""#).unwrap());

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

    let mut n_character = 0usize;
    let mut n_location = 0usize;
    let mut n_manuscript = 0usize;
    let mut n_encyclopedia = 0usize;

    for chunk in split_export_items(&html) {
        let title = html_to_text(
            &RE_TITLE
                .captures(chunk)
                .and_then(|c| c.get(1).map(|m| m.as_str().to_string()))
                .unwrap_or_else(|| "Untitled".into()),
        );
        let subtitle = RE_SUBTITLE
            .captures(chunk)
            .map(|c| html_to_text(c.get(1).map(|m| m.as_str()).unwrap_or("")))
            .filter(|s| !s.is_empty());

        let (module_type, unsup) = classify_item(chunk, &title);
        if let Some(ref u) = unsup {
            unsupported.push(u.clone());
        }

        let mut metadata = serde_json::json!({
            "import_source": "campfire_html",
        });
        if let Some(sub) = &subtitle {
            metadata["subtitle"] = serde_json::json!(sub);
        }

        let mut panels = Vec::new();
        let mut body_markdown = None;

        if module_type == "manuscript" {
            body_markdown = Some(extract_manuscript(chunk));
        } else {
            for (_tag, page_html) in extract_sections(chunk, "page-section") {
                let page_title = RE_PAGE_TITLE
                    .captures(page_html)
                    .map(|c| html_to_text(c.get(1).map(|m| m.as_str()).unwrap_or("")))
                    .unwrap_or_else(|| "Page".into());

                let mut page_had_panel = false;
                for (panel_tag, panel_html) in extract_sections(page_html, "panel-section") {
                    let panel_class = RE_CLASS
                        .captures(panel_tag)
                        .and_then(|c| c.get(1).map(|m| m.as_str().to_string()))
                        .unwrap_or_default();
                    let panel_title = RE_PANEL_HEADER
                        .captures(panel_html)
                        .map(|c| html_to_text(c.get(1).map(|m| m.as_str()).unwrap_or("")))
                        .unwrap_or_else(|| page_title.clone());

                    if let Some(p) =
                        map_panel(&panel_class, &panel_title, panel_html, &mut links, &title)
                    {
                        panels.push(p);
                        page_had_panel = true;
                    }
                }

                if !page_had_panel {
                    let md = html_to_markdown(page_html);
                    if !md.trim().is_empty() {
                        panels.push(IntermediatePanel {
                            panel_type: "text".into(),
                            title: page_title,
                            content: serde_json::json!({ "markdown": md }),
                            layout: None,
                        });
                    }
                }
            }
        }

        match module_type.as_str() {
            "character" => n_character += 1,
            "location" => n_location += 1,
            "manuscript" => n_manuscript += 1,
            _ => n_encyclopedia += 1,
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

    notes.push(format!(
        "Mapped {n_character} characters, {n_location} locations, {n_manuscript} chapters, {n_encyclopedia} encyclopedia/timeline stubs"
    ));
    if !unsupported.is_empty() {
        notes.push(format!(
            "Non-v1 modules folded into encyclopedia ({} tagged items)",
            unsupported.len()
        ));
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
        links,
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

/// Split on export-item opens; each chunk runs until the next export-item (not first nested `</section>`).
fn split_export_items(html: &str) -> Vec<&str> {
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
        // skip to end of opening tag
        let Some(gt) = html[start..].find('>') else {
            continue;
        };
        let content_start = start + gt + 1;
        let content_end = starts.get(i + 1).copied().unwrap_or(html.len());
        // trim trailing close of this section if present before next item
        let mut chunk = &html[content_start..content_end];
        if let Some(idx) = chunk.rfind("</section>") {
            // only trim the outermost trailing closer near the end
            let after = &chunk[idx..];
            if after.len() < 40 || chunk[idx..].matches("</section>").count() >= 1 {
                // find the last </section> that closes export-item — take everything before final one if next item follows
                if i + 1 < starts.len() {
                    chunk = &chunk[..idx];
                }
            }
        }
        out.push(chunk);
    }
    out
}

fn classify_item(chunk: &str, title: &str) -> (String, Option<String>) {
    if chunk.contains("manuscript-content") || chunk.contains("class=\"manuscript\"") {
        return ("manuscript".into(), None);
    }
    if is_location(chunk) || title_looks_like_place(title) {
        return ("location".into(), None);
    }
    if is_character(chunk) || title_looks_like_person(title, chunk) {
        return ("character".into(), None);
    }
    let unsup = if looks_like_timeline(title, chunk) {
        Some("timeline".into())
    } else if chunk.to_ascii_lowercase().contains("research") {
        Some("research".into())
    } else {
        Some("unclassified".into())
    };
    ("encyclopedia".into(), unsup)
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
    if looks_like_timeline(title, chunk) || title_looks_like_place(title) {
        return false;
    }
    let words = title.split_whitespace().count();
    // Campfire character stubs often have a short subtitle ("The Ship", "Port", …)
    let has_subtitle = chunk.contains("item-subtitle");
    (words <= 2 && has_subtitle) || (words == 1 && !chunk.contains("Research"))
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

/// Extract `<section class="…needle…">…</section>` bodies with nest-aware matching.
fn extract_sections<'a>(html: &'a str, needle: &str) -> Vec<(&'a str, &'a str)> {
    let mut out = Vec::new();
    let mut pos = 0;
    while let Some(m) = RE_SECTION_OPEN.find_at(html, pos) {
        let tag = m.as_str();
        if !tag.contains(needle) {
            pos = m.end();
            continue;
        }
        let mut depth = 1usize;
        let mut cursor = m.end();
        let content_start = m.end();
        while depth > 0 {
            let next_open = RE_SECTION_OPEN.find_at(html, cursor);
            let next_close = RE_SECTION_CLOSE.find_at(html, cursor);
            match (next_open, next_close) {
                (_, None) => {
                    cursor = html.len();
                    break;
                }
                (Some(o), Some(c)) if o.start() < c.start() => {
                    depth += 1;
                    cursor = o.end();
                }
                (_, Some(c)) => {
                    depth -= 1;
                    if depth == 0 {
                        out.push((tag, &html[content_start..c.start()]));
                        cursor = c.end();
                        break;
                    }
                    cursor = c.end();
                }
            }
        }
        pos = cursor;
    }
    out
}

fn looks_like_timeline(title: &str, _chunk: &str) -> bool {
    let t = title.to_ascii_lowercase();
    let verbs = [
        "proposed",
        "begins",
        "begin",
        "launch",
        "enters",
        "disabled",
        "online",
        "manufactures",
        "attempted",
        "established",
        "reassigned",
        "refitted",
        "effects on",
        "species",
        "morphs",
    ];
    verbs.iter().any(|v| t.contains(v))
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
        for row in RE_ATTR_ROW.captures_iter(panel_html) {
            let key = html_to_text(row.get(1).map(|m| m.as_str()).unwrap_or(""));
            let value = html_to_text(row.get(2).map(|m| m.as_str()).unwrap_or(""));
            if !key.is_empty() {
                items.push(serde_json::json!({ "key": key, "value": value }));
            }
        }
        return Some(IntermediatePanel {
            panel_type: "attributes".into(),
            title: panel_title.into(),
            content: serde_json::json!({ "items": items }),
            layout: None,
        });
    }
    if class.contains("panel-list") || class.contains("list-panel") {
        let mut items = Vec::new();
        for row in RE_LIST_ITEM.captures_iter(panel_html) {
            let title = html_to_text(row.get(1).map(|m| m.as_str()).unwrap_or(""));
            let desc = html_to_text(row.get(2).map(|m| m.as_str()).unwrap_or(""));
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
        // also grab tag badges as list entries when present
        if items.is_empty() {
            for tag in Regex::new(r#"(?s)class="tag-badge"[^>]*>(.*?)</"#)
                .unwrap()
                .captures_iter(panel_html)
            {
                let t = html_to_text(tag.get(1).map(|m| m.as_str()).unwrap_or(""));
                if !t.is_empty() {
                    items.push(t);
                }
            }
        }
        return Some(IntermediatePanel {
            panel_type: "list".into(),
            title: panel_title.into(),
            content: serde_json::json!({ "items": items }),
            layout: None,
        });
    }
    if class.contains("panel-image") || panel_title.eq_ignore_ascii_case("Image") {
        return Some(IntermediatePanel {
            panel_type: "image".into(),
            title: panel_title.into(),
            content: serde_json::json!({ "images": [], "note": "Images from Campfire HTML not extracted yet" }),
            layout: None,
        });
    }
    if class.contains("link") || panel_title.eq_ignore_ascii_case("Links") {
        for name in RE_LINK_NAME.captures_iter(panel_html) {
            let to = html_to_text(name.get(1).map(|m| m.as_str()).unwrap_or(""));
            if !to.is_empty() {
                links.push(IntermediateLink {
                    from_title: from_title.into(),
                    to_title: to,
                    label: "linked".into(),
                    link_type: "related".into(),
                });
            }
        }
        return Some(IntermediatePanel {
            panel_type: "links".into(),
            title: panel_title.into(),
            content: serde_json::json!({ "element_ids": [] }),
            layout: None,
        });
    }
    // text / stats / default
    let md = html_to_markdown(panel_html);
    if md.trim().is_empty() {
        return None;
    }
    Some(IntermediatePanel {
        panel_type: if class.contains("stat") {
            "stats".into()
        } else {
            "text".into()
        },
        title: panel_title.into(),
        content: serde_json::json!({ "markdown": md }),
        layout: None,
    })
}

fn extract_manuscript(chunk: &str) -> String {
    if let Some(c) = RE_MS.captures(chunk) {
        return html_to_markdown(c.get(1).map(|m| m.as_str()).unwrap_or(""));
    }
    if let Some(c) = RE_MS_FALLBACK.captures(chunk) {
        return html_to_markdown(c.get(1).map(|m| m.as_str()).unwrap_or(""));
    }
    let mut md = String::new();
    for (_tag, page_html) in extract_sections(chunk, "page-section") {
        let t = RE_PAGE_TITLE
            .captures(page_html)
            .map(|c| html_to_text(c.get(1).map(|m| m.as_str()).unwrap_or("")))
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

fn html_to_text(s: &str) -> String {
    let mut out = s.to_string();
    out = Regex::new(r"(?is)<script[^>]*>.*?</script>")
        .unwrap()
        .replace_all(&out, "")
        .into_owned();
    out = Regex::new(r"(?is)<style[^>]*>.*?</style>")
        .unwrap()
        .replace_all(&out, "")
        .into_owned();
    out = Regex::new(r"(?i)<br\s*/?>")
        .unwrap()
        .replace_all(&out, "\n")
        .into_owned();
    out = Regex::new(r"(?i)</p>")
        .unwrap()
        .replace_all(&out, "\n")
        .into_owned();
    out = Regex::new(r"<[^>]+>").unwrap().replace_all(&out, " ").into_owned();
    out = html_unescape(&out);
    collapse_ws(&out)
}

fn html_to_markdown(s: &str) -> String {
    let mut out = s.to_string();
    out = Regex::new(r"(?is)<script[^>]*>.*?</script>")
        .unwrap()
        .replace_all(&out, "")
        .into_owned();
    out = Regex::new(r"(?is)<style[^>]*>.*?</style>")
        .unwrap()
        .replace_all(&out, "")
        .into_owned();
    // drop panel headers already captured separately when present in chunk
    out = Regex::new(r#"(?is)<h4 class="panel-header">.*?</h4>"#)
        .unwrap()
        .replace_all(&out, "")
        .into_owned();
    out = Regex::new(r#"(?is)<header class="page-header">.*?</header>"#)
        .unwrap()
        .replace_all(&out, "")
        .into_owned();
    out = Regex::new(r"(?i)<br\s*/?>")
        .unwrap()
        .replace_all(&out, "\n")
        .into_owned();
    out = Regex::new(r"(?i)</p\s*>")
        .unwrap()
        .replace_all(&out, "\n\n")
        .into_owned();
    out = Regex::new(r"(?i)<p[^>]*>")
        .unwrap()
        .replace_all(&out, "")
        .into_owned();
    out = Regex::new(r"(?i)<strong[^>]*>(.*?)</strong>")
        .unwrap()
        .replace_all(&out, "**$1**")
        .into_owned();
    out = Regex::new(r"(?i)<b[^>]*>(.*?)</b>")
        .unwrap()
        .replace_all(&out, "**$1**")
        .into_owned();
    out = Regex::new(r"(?i)<em[^>]*>(.*?)</em>")
        .unwrap()
        .replace_all(&out, "*$1*")
        .into_owned();
    out = Regex::new(r"(?i)<i[^>]*>(.*?)</i>")
        .unwrap()
        .replace_all(&out, "*$1*")
        .into_owned();
    out = Regex::new(r"(?i)<li[^>]*>")
        .unwrap()
        .replace_all(&out, "- ")
        .into_owned();
    out = Regex::new(r"(?i)</li\s*>")
        .unwrap()
        .replace_all(&out, "\n")
        .into_owned();
    out = Regex::new(r"<[^>]+>").unwrap().replace_all(&out, "").into_owned();
    out = html_unescape(&out);
    // tidy blank lines
    let lines: Vec<_> = out
        .lines()
        .map(|l| l.trim_end())
        .collect();
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

fn html_unescape(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#039;", "'")
        .replace("&apos;", "'")
        .replace("&nbsp;", " ")
}

fn collapse_ws(s: &str) -> String {
    Regex::new(r"[ \t\r\n]+")
        .unwrap()
        .replace_all(s, " ")
        .trim()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_generator() {
        let s = br#"<html><head><meta name="generator" content="Campfire Export Server">"#;
        assert!(looks_like_campfire_html(s));
    }
}
