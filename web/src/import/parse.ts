/** Browser-side Campfire / Tavern import — never ships plaintext to the server. */

import { unzipSync, strFromU8 } from "fflate";
import type {
  ImportReport,
  IntermediateElement,
  IntermediateLink,
  IntermediatePanel,
  IntermediateProject,
} from "../api/client";
import { loadCampfireHtml, looksLikeCampfireHtml } from "./campfireHtml";
import { mapModuleName } from "./modules";

const MAX_FILE = 32 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 512;
const MAX_ENTRY = 16 * 1024 * 1024;
const MAX_TOTAL_UNCOMPRESSED = 64 * 1024 * 1024;
const MAX_JSON_ENTRIES = 64;
const MAX_ELEMENTS = 5000;
const MAX_LINKS = 20000;

export type ParsedImport = {
  intermediate: IntermediateProject;
  report: ImportReport;
};

export async function parseImportFile(file: File): Promise<ParsedImport> {
  if (file.size > MAX_FILE) {
    throw new Error("import too large (max 32MB)");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  return parseImportBytes(bytes, file.name);
}

export function parseImportBytes(bytes: Uint8Array, filename?: string): ParsedImport {
  if (looksLikeJson(bytes)) {
    const text = new TextDecoder().decode(bytes);
    const project = JSON.parse(text) as IntermediateProject;
    if (!project?.title || !Array.isArray(project.elements)) {
      throw new Error("invalid Tavern JSON (need title + elements)");
    }
    const normalized = normalizeProject(project);
    assertLimits(normalized);
    return {
      intermediate: normalized,
      report: {
        format: "tavern_intermediate_json",
        title: normalized.title,
        element_count: normalized.elements.length,
        link_count: normalized.links.length,
        unsupported_modules: [],
        notes: ["Loaded Tavern intermediate JSON"],
      },
    };
  }

  if (looksLikeCampfireHtml(bytes)) {
    const { project, report } = loadCampfireHtml(bytes, filename);
    const normalized = normalizeProject(project);
    assertLimits(normalized);
    return { intermediate: normalized, report: { ...report, title: normalized.title } };
  }

  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    return loadZip(bytes, filename);
  }

  const name = filename || "campfire-backup";
  const project: IntermediateProject = {
    title: name,
    synopsis: "Imported opaque Campfire backup (pending reverse-engineering)",
    elements: [
      {
        module_type: "encyclopedia",
        title: "Imported backup (raw)",
        metadata: {
          import_source: "opaque_binary",
          filename: name,
          byte_length: bytes.length,
        },
        body_markdown: `This backup could not be parsed yet.\n\nFilename: \`${name}\`\nSize: ${bytes.length} bytes\n\nProvide a sample to extend the browser importer.`,
        panels: [],
        unsupported_source: "unknown_binary",
      },
    ],
    links: [],
  };
  return {
    intermediate: project,
    report: {
      format: "opaque_binary",
      title: project.title,
      element_count: 1,
      link_count: 0,
      unsupported_modules: ["entire_backup"],
      notes: [
        "Backup is not JSON/ZIP/HTML; stored as encyclopedia stub. Export DOCX/MD from Campfire or share a sample for a real mapper.",
      ],
    },
  };
}

function looksLikeJson(bytes: Uint8Array): boolean {
  let i = 0;
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d)) {
    i += 1;
  }
  return bytes[i] === 0x7b; // '{'
}

function loadZip(bytes: Uint8Array, filename?: string): ParsedImport {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (file) => !file.originalSize || file.originalSize <= MAX_ENTRY });
  } catch {
    throw new Error("could not open zip backup");
  }
  const names = Object.keys(files);
  if (names.length > MAX_ZIP_ENTRIES) {
    throw new Error(`zip has too many entries (max ${MAX_ZIP_ENTRIES})`);
  }

  let total = 0;
  const notes = [`ZIP archive with ${names.length} entries`];
  const readEntry = (name: string): string | null => {
    const data = files[name];
    if (!data) return null;
    if (data.length > MAX_ENTRY) return null;
    total += data.length;
    if (total > MAX_TOTAL_UNCOMPRESSED) {
      throw new Error("zip uncompressed size exceeds limit");
    }
    return strFromU8(data);
  };

  for (const candidate of ["tavern.json", "project.json", "manifest.json", "data.json", "export.json"]) {
    const buf = readEntry(candidate);
    if (!buf) continue;
    try {
      const project = JSON.parse(buf) as IntermediateProject;
      if (project?.title && Array.isArray(project.elements)) {
        notes.push(`Parsed ${candidate} as intermediate project`);
        const normalized = normalizeProject(project);
        assertLimits(normalized);
        return {
          intermediate: normalized,
          report: {
            format: `zip:${candidate}`,
            title: normalized.title,
            element_count: normalized.elements.length,
            link_count: normalized.links.length,
            unsupported_modules: [],
            notes,
          },
        };
      }
    } catch {
      /* try generic */
    }
    try {
      const v = JSON.parse(buf);
      const { project, unsupported } = mapGenericJson(v, filename);
      const normalized = normalizeProject(project);
      assertLimits(normalized);
      return {
        intermediate: normalized,
        report: {
          format: `zip:${candidate}:generic`,
          title: normalized.title,
          element_count: normalized.elements.length,
          link_count: normalized.links.length,
          unsupported_modules: unsupported,
          notes,
        },
      };
    } catch {
      /* next */
    }
  }

  notes.push(`Entries: ${names.join(", ")}`);
  const harvested: IntermediateProject = {
    title: filename || "Imported Project",
    synopsis: "Harvested from ZIP backup",
    elements: [],
    links: [],
  };
  const unsupported: string[] = [];
  let jsonSeen = 0;
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    jsonSeen += 1;
    if (jsonSeen > MAX_JSON_ENTRIES) {
      notes.push(`Stopped after ${MAX_JSON_ENTRIES} JSON entries`);
      break;
    }
    const buf = readEntry(name);
    if (!buf) {
      notes.push(`Skipped oversized or invalid entry ${name}`);
      continue;
    }
    try {
      const v = JSON.parse(buf);
      const { project: partial, unsupported: unsup } = mapGenericJson(v, name);
      harvested.elements.push(...partial.elements);
      harvested.links.push(...partial.links);
      unsupported.push(...unsup);
      notes.push(`Mapped JSON from ${name}`);
      if (harvested.elements.length > MAX_ELEMENTS) {
        throw new Error("imported project has too many elements");
      }
    } catch {
      /* skip */
    }
  }

  if (harvested.elements.length === 0) {
    harvested.elements.push({
      module_type: "encyclopedia",
      title: "ZIP backup (unmapped)",
      metadata: { entries: names },
      body_markdown: `Could not map this Campfire ZIP yet.\n\nFiles:\n${names.map((n) => `- \`${n}\``).join("\n")}`,
      panels: [],
      unsupported_source: "campfire_zip",
    });
    unsupported.push("zip_structure");
  }

  const normalized = normalizeProject(harvested);
  assertLimits(normalized);
  return {
    intermediate: normalized,
    report: {
      format: "zip:scanned",
      title: normalized.title,
      element_count: normalized.elements.length,
      link_count: normalized.links.length,
      unsupported_modules: [...new Set(unsupported)],
      notes,
    },
  };
}

function mapGenericJson(
  v: unknown,
  hint?: string
): { project: IntermediateProject; unsupported: string[] } {
  const unsupported: string[] = [];
  const obj = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const title =
    (typeof obj.title === "string" && obj.title) ||
    (typeof obj.name === "string" && obj.name) ||
    hint ||
    "Imported Project";
  const synopsis =
    (typeof obj.synopsis === "string" && obj.synopsis) ||
    (typeof obj.description === "string" && obj.description) ||
    "";
  const elements: IntermediateElement[] = [];
  const links: IntermediateLink[] = [];

  if (Array.isArray(obj.elements)) {
    for (const item of obj.elements) {
      elements.push(mapElementValue(item, unsupported));
    }
  }
  if (obj.modules && typeof obj.modules === "object") {
    for (const [modName, content] of Object.entries(obj.modules as Record<string, unknown>)) {
      const mapped = mapModuleName(modName);
      if (!mapped) unsupported.push(modName);
      const moduleType = mapped || "encyclopedia";
      if (Array.isArray(content)) {
        for (const item of content) {
          const el = mapElementValue(item, unsupported);
          if (!el.module_type || el.module_type === "encyclopedia") {
            el.module_type = moduleType;
          }
          elements.push(el);
        }
      }
    }
  }
  if (Array.isArray(obj.links)) {
    for (const link of obj.links) {
      const L = link as Record<string, unknown>;
      links.push({
        from_title: String(L.from_title || L.from || ""),
        to_title: String(L.to_title || L.to || ""),
        label: String(L.label || "related"),
        link_type: String(L.link_type || L.type || "related"),
      });
    }
  }

  return {
    project: { title, synopsis, elements, links },
    unsupported,
  };
}

function mapElementValue(item: unknown, unsupported: string[]): IntermediateElement {
  const o = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
  let moduleType = String(o.module_type || o.type || "encyclopedia");
  const mapped = mapModuleName(moduleType);
  if (!mapped && moduleType !== "encyclopedia") {
    unsupported.push(moduleType);
  }
  moduleType = mapped || moduleType;
  const panels: IntermediatePanel[] = [];
  if (Array.isArray(o.panels)) {
    for (const p of o.panels) {
      const panel = p as Record<string, unknown>;
      panels.push({
        panel_type: String(panel.panel_type || "text"),
        title: String(panel.title || ""),
        content: (panel.content as Record<string, unknown>) || {},
        layout: panel.layout as IntermediatePanel["layout"],
        page_title: panel.page_title ? String(panel.page_title) : undefined,
      });
    }
  }
  return {
    module_type: moduleType,
    title: String(o.title || o.name || "Untitled"),
    parent_title: o.parent_title ? String(o.parent_title) : null,
    metadata: (o.metadata as Record<string, unknown>) || {},
    body_markdown:
      o.body_markdown != null
        ? String(o.body_markdown)
        : o.body != null
          ? String(o.body)
          : null,
    panels,
    unsupported_source: o.unsupported_source ? String(o.unsupported_source) : null,
  };
}

function normalizeProject(project: IntermediateProject): IntermediateProject {
  const elements = project.elements.map((el) => {
    const mapped = mapModuleName(el.module_type);
    if (mapped) {
      return { ...el, module_type: mapped };
    }
    if (!el.unsupported_source) {
      return {
        ...el,
        unsupported_source: el.module_type,
        module_type: "encyclopedia",
      };
    }
    return { ...el, module_type: "encyclopedia" };
  });
  return {
    title: project.title,
    synopsis: project.synopsis || "",
    elements,
    links: project.links || [],
  };
}

function assertLimits(project: IntermediateProject) {
  if (!project.title.trim()) throw new Error("imported project needs a title");
  if (project.elements.length > MAX_ELEMENTS) {
    throw new Error("imported project has too many elements (max 5000)");
  }
  if ((project.links || []).length > MAX_LINKS) {
    throw new Error("imported project has too many links (max 20000)");
  }
}
