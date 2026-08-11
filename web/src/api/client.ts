export type User = {
  id: string;
  username: string;
  is_admin: boolean;
};

export type Project = {
  id: string;
  title: string;
  synopsis: string;
  owner_id: string;
  theme_json: Record<string, string>;
  created_at: string;
  updated_at: string;
};

export type ModuleType =
  | "manuscript"
  | "character"
  | "encyclopedia"
  | "relationship"
  | "location"
  | "systems"
  | "maps"
  | "timeline";

export type Element = {
  id: string;
  project_id: string;
  module_type: ModuleType;
  title: string;
  parent_id: string | null;
  sort_order: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type Page = {
  id: string;
  element_id: string;
  title: string;
  sort_order: number;
  description: string;
};

export type PanelLayout = { x: number; y: number; w: number; h: number };

export type Panel = {
  id: string;
  page_id: string;
  panel_type: string;
  title: string;
  border_color: string | null;
  layout: PanelLayout;
  content: Record<string, unknown>;
  sort_order: number;
};

export type ElementLink = {
  id: string;
  project_id: string;
  from_element_id: string;
  to_element_id: string;
  label: string;
  link_type: string;
  metadata: Record<string, unknown>;
};

export type ProjectGrant = {
  project_id: string;
  user_id: string;
  role: string;
  username?: string;
};

export type AssetInfo = {
  name: string;
  url: string;
  size: number;
};

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    headers: {
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(init?.headers || {}),
    },
    ...init,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = await res.json();
      msg = j.error || msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  return res as unknown as T;
}

export const api = {
  me: () => req<User>("/api/auth/me"),
  login: (username: string, password: string) =>
    req<{ token: string; user: User }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  logout: () => req<void>("/api/auth/logout", { method: "POST" }),
  projects: () => req<Project[]>("/api/projects"),
  createProject: (title: string, synopsis = "") =>
    req<Project>("/api/projects", {
      method: "POST",
      body: JSON.stringify({ title, synopsis }),
    }),
  getProject: (id: string) => req<Project>(`/api/projects/${id}`),
  updateProject: (id: string, body: { title: string; synopsis: string; theme_json?: object }) =>
    req<Project>(`/api/projects/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteProject: (id: string) =>
    req<void>(`/api/projects/${id}`, { method: "DELETE" }),
  elements: (projectId: string, module?: ModuleType) =>
    req<Element[]>(
      `/api/projects/${projectId}/elements${module ? `?module=${module}` : ""}`
    ),
  createElement: (
    projectId: string,
    body: { module_type: ModuleType; title: string; parent_id?: string; metadata?: object }
  ) =>
    req<Element>(`/api/projects/${projectId}/elements`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateElement: (
    id: string,
    body: { title: string; parent_id: string | null; sort_order: number; metadata: object }
  ) => req<Element>(`/api/elements/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteElement: (id: string) => req<void>(`/api/elements/${id}`, { method: "DELETE" }),
  pages: (elementId: string) => req<Page[]>(`/api/elements/${elementId}/pages`),
  createPage: (elementId: string, title: string) =>
    req<Page>(`/api/elements/${elementId}/pages`, {
      method: "POST",
      body: JSON.stringify({ title }),
    }),
  panels: (pageId: string) => req<Panel[]>(`/api/pages/${pageId}/panels`),
  createPanel: (
    pageId: string,
    body: { panel_type: string; title: string; content?: object; layout?: PanelLayout; sort_order?: number }
  ) =>
    req<Panel>(`/api/pages/${pageId}/panels`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updatePanel: (
    id: string,
    body: {
      title: string;
      border_color: string | null;
      layout: PanelLayout;
      content: object;
      sort_order: number;
    }
  ) => req<Panel>(`/api/panels/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deletePanel: (id: string) => req<void>(`/api/panels/${id}`, { method: "DELETE" }),
  links: (projectId: string) => req<ElementLink[]>(`/api/projects/${projectId}/links`),
  createLink: (
    projectId: string,
    body: { from_element_id: string; to_element_id: string; label?: string; link_type?: string }
  ) =>
    req<ElementLink>(`/api/projects/${projectId}/links`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  deleteLink: (id: string) => req<void>(`/api/links/${id}`, { method: "DELETE" }),
  manuscript: (elementId: string) =>
    req<{ markdown: string; word_goal: number; word_count: number }>(
      `/api/elements/${elementId}/manuscript`
    ),
  saveManuscript: (elementId: string, markdown: string, word_goal?: number) =>
    req<{ markdown: string; word_goal: number; word_count: number }>(
      `/api/elements/${elementId}/manuscript`,
      { method: "PUT", body: JSON.stringify({ markdown, word_goal }) }
    ),
  grants: (projectId: string) => req<ProjectGrant[]>(`/api/projects/${projectId}/grants`),
  upsertGrant: (projectId: string, body: { username?: string; user_id?: string; role: string }) =>
    req<void>(`/api/projects/${projectId}/grants`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  deleteGrant: (projectId: string, userId: string) =>
    req<void>(`/api/projects/${projectId}/grants/${userId}`, { method: "DELETE" }),
  listAssets: (projectId: string) => req<AssetInfo[]>(`/api/projects/${projectId}/assets`),
  uploadAsset: async (projectId: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return req<AssetInfo>(`/api/projects/${projectId}/assets`, {
      method: "POST",
      body: fd,
      headers: {},
    });
  },
  deleteAsset: (projectId: string, name: string) =>
    req<void>(`/api/projects/${projectId}/assets/${encodeURIComponent(name)}`, {
      method: "DELETE",
    }),
  exportProject: async (projectId: string, format: string, kind = "manuscript") => {
    const res = await fetch(`/api/projects/${projectId}/export`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format, kind }),
    });
    if (!res.ok) throw new Error("export failed");
    return res.blob();
  },
  backupProject: async (projectId: string) => {
    const res = await fetch(`/api/projects/${projectId}/backup`, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) throw new Error("backup failed");
    return res.blob();
  },
  importProject: async (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return req<{ project: Project; report: { notes: string[]; unsupported_modules: string[] } }>(
      "/api/import",
      { method: "POST", body: fd, headers: {} }
    );
  },
};

export const MODULES: { id: ModuleType; label: string }[] = [
  { id: "manuscript", label: "Manuscript" },
  { id: "character", label: "Characters" },
  { id: "encyclopedia", label: "Encyclopedia" },
  { id: "relationship", label: "Relationships" },
  { id: "location", label: "Locations" },
  { id: "systems", label: "Systems" },
  { id: "maps", label: "Maps" },
  { id: "timeline", label: "Timeline" },
];
