use anyhow::{bail, Result};
use std::path::PathBuf;

fn main() -> Result<()> {
    let mut args = std::env::args().skip(1);
    let input = PathBuf::from(
        args.next()
            .ok_or_else(|| anyhow::anyhow!("usage: tavern-import <file> [out.json]"))?,
    );
    let output = args
        .next()
        .map(PathBuf::from)
        .unwrap_or_else(|| input.with_extension("tavern.json"));

    let (project, report) = tavern_import::load_path(&input)?;
    serde_json::to_writer_pretty(std::fs::File::create(&output)?, &project)?;
    println!("Wrote {}", output.display());
    println!("format: {}", report.format);
    println!("title: {}", report.title);
    println!("elements: {}", report.element_count);
    println!("links: {}", report.link_count);
    if !report.unsupported_modules.is_empty() {
        println!(
            "unsupported tags: {}",
            report.unsupported_modules.join(", ")
        );
    }
    for n in report.notes {
        println!("note: {n}");
    }
    if report.element_count == 0 {
        bail!("no elements parsed");
    }
    Ok(())
}
