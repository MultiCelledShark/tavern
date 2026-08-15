/** Campfire HTML Export Server parser (browser DOM). */

import type {
  ImportReport,
  IntermediateElement,
  IntermediateLink,
  IntermediatePanel,
  IntermediateProject,
} from "../api/client";
import { mapModuleName } from "./modules";

export function looksLikeCampfireHtml(bytes: Uint8Array): boolean {
  const head = new TextDecoder().decode(bytes.slice(0, Math.min(bytes.length, 4000)));
  return (
    head.includes("Campfire Export Server") ||
    (head.includes("<!DOCTYPE html") && head.includes("Campfire Export"))
  );
}

export function loadCampfireHtml(
  bytes: Uint8Array,
  filename?: string
): { project: IntermediateProject; report: ImportReport } {
  const html = new TextDecoder().decode(bytes);
  const doc = new DOMParser().parseFromString(html, "text/html");
  const items = Array.from(doc.querySelectorAll("section.export-item"));

  const elements: IntermediateElement[] = [];
  const links: IntermediateLink[] = [];
  const unsupported: string[] = [];
  const notes = [
    "Parsed Campfire HTML export (browser)",
    `Source: ${filename || "Campfire_Export.html"}`,
  ];
  const moduleCounts = new Map<string, number>();

  for (const item of items) {
    const title =
      textContent(item.querySelector("h2.item-title")) ||
      textContent(item.querySelector(".item-title")) ||
      "Untitled";
    const subtitleRaw = textContent(item.querySelector(".item-subtitle"));
    const subtitle = subtitleRaw || undefined;

    const { moduleType, unsup } = classifyItem(item, title, subtitle);
    moduleCounts.set(moduleType, (moduleCounts.get(moduleType) || 0) + 1);
    if (unsup) unsupported.push(unsup);

    const metadata: Record<string, unknown> = { import_source: "campfire_html" };
    if (subtitle) {
      if (mapModuleName(subtitle)) metadata.campfire_module = subtitle;
      else metadata.subtitle = subtitle;
    }
    if (moduleType === "timeline") {
      const date = extractTimelineDate(item);
      if (date) metadata.date = date;
    }

    let panels: IntermediatePanel[] = [];
    let body_markdown: string | null = null;

    if (moduleType === "manuscript") {
      const ms =
        item.querySelector(".manuscript-content") ||
        item.querySelector(".manuscript") ||
        item;
      body_markdown = htmlToMarkdown(ms);
    } else {
      for (const page of Array.from(item.querySelectorAll("section.page-section"))) {
        const pageTitle =
          textContent(page.querySelector("h3.page-title")) ||
          textContent(page.querySelector(".page-title")) ||
          "Page";
        let pageHadPanel = false;
        for (const panelEl of Array.from(page.querySelectorAll("section.panel-section"))) {
          const panelClass = panelEl.className || "";
          const panelTitle =
            textContent(panelEl.querySelector("h4.panel-header")) ||
            textContent(panelEl.querySelector(".panel-header")) ||
            pageTitle;
          const mapped = mapPanel(panelClass, panelTitle, panelEl, links, title);
          if (mapped) {
            mapped.page_title = pageTitle;
            panels.push(mapped);
            pageHadPanel = true;
          }
        }
        if (!pageHadPanel) {
          const md = htmlToMarkdown(page);
          if (md.trim()) {
            panels.push({
              panel_type: "text",
              title: pageTitle,
              content: { markdown: md },
              page_title: pageTitle,
            });
          }
        }
      }
    }

    elements.push({
      module_type: moduleType,
      title,
      parent_title: null,
      metadata,
      body_markdown,
      panels,
      unsupported_source: unsup,
    });
  }

  if (moduleCounts.size) {
    const parts = [...moduleCounts.entries()].map(([k, v]) => `${v} ${k}`);
    parts.sort();
    notes.push(`Mapped ${parts.join(", ")}`);
  }
  if (unsupported.length) {
    notes.push(`Heuristic fallbacks (${unsupported.length} items)`);
  }

  const projectTitle =
    guessProjectTitle(elements) ||
    (filename || "Campfire Import").replace(/\.html$/i, "").replace(/_/g, " ");

  const project: IntermediateProject = {
    title: projectTitle,
    synopsis: "Imported from Campfire HTML export",
    elements,
    links: dedupeLinks(links),
  };

  const uniqUnsup = [...new Set(unsupported)].sort();
  return {
    project,
    report: {
      format: "campfire_html",
      title: project.title,
      element_count: project.elements.length,
      link_count: project.links.length,
      unsupported_modules: uniqUnsup,
      notes,
    },
  };
}

function textContent(el: Element | null | undefined): string {
  return (el?.textContent || "").replace(/\s+/g, " ").trim();
}

function classifyItem(
  item: Element,
  title: string,
  subtitle?: string
): { moduleType: string; unsup: string | null } {
  const html = item.innerHTML;
  if (html.includes("manuscript-content") || item.querySelector(".manuscript")) {
    return { moduleType: "manuscript", unsup: null };
  }
  if (subtitle) {
    const mt = mapModuleName(subtitle);
    if (mt) return { moduleType: mt, unsup: null };
  }
  const className = item.className || "";
  if (className.includes("export-item")) {
    for (const token of className.replace(/export-item/g, " ").split(/\s+/)) {
      const mt = mapModuleName(token);
      if (mt) return { moduleType: mt, unsup: null };
    }
  }
  if (isResearch(item, html)) return { moduleType: "research", unsup: null };
  if (isLocation(html) || titleLooksLikePlace(title)) return { moduleType: "location", unsup: null };
  if (isCharacter(html) || titleLooksLikePerson(title, html)) {
    return { moduleType: "character", unsup: null };
  }
  if (titleLooksLikeSpecies(title)) return { moduleType: "species", unsup: "species_heuristic" };
  if (looksLikeTimeline(title)) return { moduleType: "timeline", unsup: "timeline_heuristic" };
  if (html.includes(">Magic</") || html.includes(">Technology</")) {
    return { moduleType: "systems", unsup: null };
  }
  return { moduleType: "encyclopedia", unsup: "unclassified" };
}

function isResearch(item: Element, html: string): boolean {
  return (
    !!item.querySelector(".panel-research, .research-panel, .research") ||
    html.includes("panel-research") ||
    html.includes("research-panel")
  );
}

function isCharacter(html: string): boolean {
  return (
    html.includes("Personality Traits") ||
    html.includes("Physical Traits") ||
    html.includes(">Sex</dt>") ||
    html.includes(">Age</dt>") ||
    html.includes(">Role</dt>") ||
    html.includes(">Backstory</h3>") ||
    html.includes(">Backstory</h4>")
  );
}

function isLocation(html: string): boolean {
  return (
    html.includes(">Geography</h4>") ||
    html.includes(">Weather</h4>") ||
    (html.includes(">History</h4>") && html.includes("attributes-list"))
  );
}

function titleLooksLikePerson(title: string, html: string): boolean {
  if (looksLikeTimeline(title) || titleLooksLikePlace(title) || titleLooksLikeSpecies(title)) {
    return false;
  }
  if (html.includes("panel-research") || html.includes("research-panel")) return false;
  const words = title.split(/\s+/).filter(Boolean).length;
  const hasSubtitle = html.includes("item-subtitle");
  const hasPanelsSlot = html.includes("page-panels");
  return (
    (words <= 2 && hasSubtitle) ||
    (words === 1 && hasPanelsSlot && !title.includes("-") && !title.includes("_"))
  );
}

function titleLooksLikeSpecies(title: string): boolean {
  const t = title.toLowerCase();
  return (
    t.includes("morph") ||
    t.includes("species") ||
    t.includes("race") ||
    t.endsWith("folk") ||
    t.endsWith("kin")
  );
}

function titleLooksLikePlace(title: string): boolean {
  const t = title.toLowerCase();
  return (
    t.includes("landing") ||
    t.includes(" station") ||
    t.includes(" port") ||
    t.endsWith("city") ||
    t.endsWith(" colony")
  );
}

function looksLikeTimeline(title: string): boolean {
  const t = title.toLowerCase();
  const signals = [
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
  if (signals.some((v) => t.includes(v))) return true;
  return t.split(/\s+/).some((w) => w === "enter" || w === "enters");
}

function extractTimelineDate(item: Element): string | null {
  for (const row of Array.from(item.querySelectorAll(".attribute-row"))) {
    const key = textContent(row.querySelector(".attribute-label, dt"));
    const value = textContent(row.querySelector(".attribute-value, dd"));
    if (/^(date|when|year)$/i.test(key) && value) return value;
  }
  return null;
}

function mapPanel(
  panelClass: string,
  panelTitle: string,
  panelEl: Element,
  links: IntermediateLink[],
  fromTitle: string
): IntermediatePanel | null {
  const classLower = panelClass.toLowerCase();
  const html = panelEl.innerHTML;

  if (classLower.includes("panel-custom") || panelEl.querySelector(".attributes-list")) {
    const items = Array.from(panelEl.querySelectorAll(".attribute-row")).map((row) => ({
      key: textContent(row.querySelector(".attribute-label, dt")),
      value: textContent(row.querySelector(".attribute-value, dd")),
    })).filter((i) => i.key);
    return {
      panel_type: "attributes",
      title: panelTitle,
      content: { items },
    };
  }

  if (classLower.includes("panel-list") || classLower.includes("list-panel")) {
    const items: string[] = [];
    for (const li of Array.from(panelEl.querySelectorAll(".list-item"))) {
      const t = textContent(li.querySelector(".list-item-title"));
      const d = textContent(li.querySelector(".list-item-description"));
      const line = !t ? d : !d ? t : `${t}: ${d}`;
      if (line) items.push(line);
    }
    if (!items.length) {
      for (const badge of Array.from(panelEl.querySelectorAll(".tag-badge"))) {
        const t = textContent(badge);
        if (t) items.push(t);
      }
    }
    return { panel_type: "list", title: panelTitle, content: { items } };
  }

  if (classLower.includes("panel-table") || classLower.includes("table-panel") || panelEl.querySelector("table")) {
    const table = extractTable(panelEl);
    if (table) return { panel_type: "table", title: panelTitle, content: table };
  }

  if (classLower.includes("panel-image") || panelTitle.toLowerCase() === "image") {
    const images = Array.from(panelEl.querySelectorAll("img")).map((img) => ({
      src: img.getAttribute("src") || "",
      alt: img.getAttribute("alt") || "",
    }));
    return { panel_type: "image", title: panelTitle, content: { images } };
  }

  if (classLower.includes("link") || panelTitle.toLowerCase() === "links") {
    for (const nameEl of Array.from(panelEl.querySelectorAll(".link-name"))) {
      const to = textContent(nameEl);
      if (to) {
        links.push({
          from_title: fromTitle,
          to_title: to,
          label: "linked",
          link_type: "related",
        });
      }
    }
    return { panel_type: "links", title: panelTitle, content: { element_ids: [] } };
  }

  if (classLower.includes("stat") || html.includes("stats-panel") || html.includes("stat-item")) {
    const items = Array.from(panelEl.querySelectorAll(".stat-item, .stat-main")).map((el) => ({
      key: textContent(el.querySelector(".stat-name")),
      value: textContent(el.querySelector(".stat-value")),
    })).filter((i) => i.key || i.value);
    if (!items.length) {
      for (const row of Array.from(panelEl.querySelectorAll(".attribute-row"))) {
        const key = textContent(row.querySelector(".attribute-label, dt"));
        const value = textContent(row.querySelector(".attribute-value, dd"));
        if (key) items.push({ key, value });
      }
    }
    if (items.length) {
      return { panel_type: "stats", title: panelTitle, content: { items } };
    }
  }

  if (classLower.includes("research") || html.includes("research-panel")) {
    const inner = panelEl.querySelector(".research-text-content") || panelEl;
    const md = htmlToMarkdown(inner);
    if (!md.trim()) return null;
    return { panel_type: "text", title: panelTitle, content: { markdown: md } };
  }

  const md = htmlToMarkdown(panelEl);
  if (!md.trim()) return null;
  return { panel_type: "text", title: panelTitle, content: { markdown: md } };
}

function extractTable(panelEl: Element): Record<string, unknown> | null {
  const table = panelEl.querySelector("table");
  if (!table) return null;
  const rows: string[][] = [];
  for (const tr of Array.from(table.querySelectorAll("tr"))) {
    const cells = Array.from(tr.querySelectorAll("th, td")).map((c) => textContent(c));
    if (cells.length) rows.push(cells);
  }
  if (!rows.length) return null;
  return { rows };
}

function htmlToMarkdown(root: Element): string {
  const clone = root.cloneNode(true) as Element;
  clone.querySelectorAll("script, style").forEach((n) => n.remove());
  // Prefer visible text with light structure
  const blocks: string[] = [];
  for (const p of Array.from(clone.querySelectorAll("p, h1, h2, h3, h4, h5, h6, li"))) {
    const t = textContent(p);
    if (t) blocks.push(t);
  }
  if (blocks.length) return blocks.join("\n\n");
  return textContent(clone);
}

function guessProjectTitle(elements: IntermediateElement[]): string | null {
  const world = elements.find(
    (e) =>
      e.module_type === "encyclopedia" &&
      /world|setting|overview/i.test(e.title)
  );
  return world?.title || null;
}

function dedupeLinks(links: IntermediateLink[]): IntermediateLink[] {
  const seen = new Set<string>();
  const out: IntermediateLink[] = [];
  for (const l of links) {
    const key = `${l.from_title}\0${l.to_title}\0${l.link_type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(l);
  }
  return out;
}
