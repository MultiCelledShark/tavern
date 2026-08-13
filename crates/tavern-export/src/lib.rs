//! Manuscript compile + pandoc wrappers + `.tavern` project backup helpers.

use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use tavern_core::{
    Element, IntermediateElement, IntermediateLink, IntermediateProject, ModuleType,
};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExportFormat {
    Markdown,
    Docx,
    Epub,
    Pdf,
    Html,
}

impl ExportFormat {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "markdown" | "md" => Some(Self::Markdown),
            "docx" => Some(Self::Docx),
            "epub" => Some(Self::Epub),
            "pdf" => Some(Self::Pdf),
            "html" => Some(Self::Html),
            _ => None,
        }
    }

    pub fn extension(self) -> &'static str {
        match self {
            Self::Markdown => "md",
            Self::Docx => "docx",
            Self::Epub => "epub",
            Self::Pdf => "pdf",
            Self::Html => "html",
        }
    }

    pub fn pandoc_to(self) -> Option<&'static str> {
        match self {
            Self::Markdown => None,
            Self::Docx => Some("docx"),
            Self::Epub => Some("epub"),
            Self::Pdf => Some("pdf"),
            Self::Html => Some("html"),
        }
    }
}

pub struct ChapterBody {
    pub title: String,
    pub markdown: String,
    pub sort_order: i64,
}

pub fn compile_manuscript_markdown(project_title: &str, chapters: &[ChapterBody]) -> String {
    let mut out = String::new();
    out.push_str(&format!("# {project_title}\n\n"));
    let mut sorted: Vec<_> = chapters.iter().collect();
    sorted.sort_by_key(|c| c.sort_order);
    for ch in sorted {
        out.push_str(&format!("## {}\n\n", ch.title));
        out.push_str(ch.markdown.trim());
        out.push_str("\n\n");
    }
    out
}

pub fn compile_world_bible_markdown(
    project_title: &str,
    elements: &[(Element, Option<String>)],
) -> String {
    let mut out = String::new();
    out.push_str(&format!("# {project_title} — World Bible\n\n"));
    let mut by_module: Vec<&(Element, Option<String>)> = elements.iter().collect();
    by_module.sort_by(|a, b| {
        a.0.module_type
            .as_str()
            .cmp(b.0.module_type.as_str())
            .then(a.0.sort_order.cmp(&b.0.sort_order))
            .then(a.0.title.cmp(&b.0.title))
    });
    let mut current = "";
    for (el, body) in by_module {
        if el.module_type == ModuleType::Manuscript {
            continue;
        }
        if el.module_type.as_str() != current {
            current = el.module_type.as_str();
            out.push_str(&format!("## {}\n\n", title_case(current)));
        }
        out.push_str(&format!("### {}\n\n", el.title));
        if let Some(md) = body {
            out.push_str(md.trim());
            out.push_str("\n\n");
        } else {
            out.push_str("_No body text_\n\n");
        }
    }
    out
}

fn title_case(s: &str) -> String {
    let mut c = s.chars();
    match c.next() {
        None => String::new(),
        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
    }
}

pub fn write_with_pandoc(markdown: &str, out_path: &Path, format: ExportFormat) -> Result<PathBuf> {
    std::fs::create_dir_all(out_path.parent().unwrap_or(Path::new(".")))?;
    match format.pandoc_to() {
        None => {
            std::fs::write(out_path, markdown)?;
            Ok(out_path.to_path_buf())
        }
        Some(to) => {
            let tmp = out_path.with_extension("md.tmp");
            std::fs::write(&tmp, markdown)?;
            let status = Command::new("pandoc")
                .arg(&tmp)
                .arg("-o")
                .arg(out_path)
                .arg("-t")
                .arg(to)
                .status()
                .context("run pandoc (is it installed?)")?;
            let _ = std::fs::remove_file(&tmp);
            if !status.success() {
                return Err(anyhow!("pandoc failed with {status}"));
            }
            Ok(out_path.to_path_buf())
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TavernBackupMeta {
    pub format: String,
    pub version: u32,
    pub exported_at: String,
}

pub fn write_tavern_backup(
    out_path: &Path,
    project: &IntermediateProject,
    assets_dir: Option<&Path>,
) -> Result<PathBuf> {
    if let Some(parent) = out_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let file = std::fs::File::create(out_path)?;
    let mut zip = zip::ZipWriter::new(file);
    let opts = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    let meta = TavernBackupMeta {
        format: "tavern_backup".into(),
        version: 1,
        exported_at: chrono::Utc::now().to_rfc3339(),
    };
    zip.start_file("meta.json", opts)?;
    zip.write_all(serde_json::to_string_pretty(&meta)?.as_bytes())?;
    zip.start_file("tavern.json", opts)?;
    zip.write_all(serde_json::to_string_pretty(project)?.as_bytes())?;

    if let Some(dir) = assets_dir {
        if dir.is_dir() {
            for entry in walkdir_shallow(dir)? {
                let rel = entry.strip_prefix(dir).unwrap_or(&entry);
                let name = format!("assets/{}", rel.display());
                zip.start_file(name, opts)?;
                zip.write_all(&std::fs::read(&entry)?)?;
            }
        }
    }
    zip.finish()?;
    Ok(out_path.to_path_buf())
}

fn walkdir_shallow(dir: &Path) -> Result<Vec<PathBuf>> {
    let mut out = Vec::new();
    fn walk(base: &Path, cur: &Path, out: &mut Vec<PathBuf>) -> Result<()> {
        for e in std::fs::read_dir(cur)? {
            let e = e?;
            let p = e.path();
            if p.is_dir() {
                walk(base, &p, out)?;
            } else {
                out.push(p);
            }
        }
        Ok(())
    }
    walk(dir, dir, &mut out)?;
    Ok(out)
}

pub fn elements_to_intermediate(
    title: &str,
    synopsis: &str,
    elements: Vec<(Element, Option<String>, Vec<tavern_core::Panel>)>,
    links: Vec<tavern_core::ElementLink>,
    id_to_title: &std::collections::HashMap<uuid::Uuid, String>,
) -> IntermediateProject {
    let mut out_elements = Vec::new();
    for (el, body, panels) in elements {
        let panels = panels
            .into_iter()
            .map(|p| tavern_core::IntermediatePanel {
                panel_type: p.panel_type.as_str().into(),
                title: p.title,
                content: p.content,
                layout: Some(p.layout),
                page_title: None,
            })
            .collect();
        out_elements.push(IntermediateElement {
            module_type: el.module_type.as_str().into(),
            title: el.title.clone(),
            parent_title: el.parent_id.and_then(|id| id_to_title.get(&id).cloned()),
            metadata: el.metadata,
            body_markdown: body,
            panels,
            unsupported_source: None,
        });
    }
    let out_links = links
        .into_iter()
        .filter_map(|l| {
            Some(IntermediateLink {
                from_title: id_to_title.get(&l.from_element_id)?.clone(),
                to_title: id_to_title.get(&l.to_element_id)?.clone(),
                label: l.label,
                link_type: l.link_type,
            })
        })
        .collect();
    IntermediateProject {
        title: title.to_string(),
        synopsis: synopsis.to_string(),
        elements: out_elements,
        links: out_links,
    }
}

pub fn pandoc_available() -> bool {
    Command::new("pandoc")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}
