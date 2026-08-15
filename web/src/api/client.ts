import {
  decryptAsset,
  encryptAsset,
  encryptText,
  isEncryptedText,
  newProjectKey,
  unb64,
  unwrapProjectKey,
  unwrapProjectKeyWithToken,
  VaultEnvelope,
  wrapProjectKey,
  wrapProjectKeyWithToken,
} from "../crypto/vault";
import {
  cacheBlobUrl,
  cachedBlobUrl,
  getProjectKey,
  getVault,
  markProjectLocked,
  markProjectPlaintext,
  pageForPanel,
  projectCryptoMode,
  projectForElement,
  projectForPage,
  rememberElementProject,
  rememberPageProject,
  rememberPanelPage,
  setProjectKey,
} from "../crypto/session";
import { countWords, openMeta, openText, sealMeta, sealText } from "../crypto/fields";

export type User = {
  id: string;
  username: string;
  is_admin: boolean;
  email?: string;
  email_verified: boolean;
  has_vault?: boolean;
};

export type GrantRole = "owner" | "editor" | "viewer";

export type Project = {
  id: string;
  title: string;
  synopsis: string;
  owner_id: string;
  theme_json: Record<string, string>;
  created_at: string;
  updated_at: string;
  my_role: GrantRole;
  key_wrap?: string | null;
};

export function canEditRole(role?: GrantRole) {
  return role === "owner" || role === "editor";
}

export function canManageRole(role?: GrantRole) {
  return role === "owner";
}

export type ManuscriptBody = {
  markdown: string;
  word_goal: number;
  word_count: number;
  updated_at: string;
};

export class ConflictError extends Error {
  body: ManuscriptBody;
  constructor(body: ManuscriptBody) {
    super("edit conflict");
    this.body = body;
  }
}

export type ModuleType =
  | "manuscript"
  | "character"
  | "encyclopedia"
  | "relationship"
  | "location"
  | "systems"
  | "maps"
  | "timeline"
  | "species"
  | "cultures"
  | "items"
  | "arcs"
  | "languages"
  | "religions"
  | "research"
  | "philosophies"
  | "calendar";

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

const elementTitleCache = new Map<string, string>();

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  // Let the browser set multipart boundaries for FormData; JSON otherwise.
  if (!(init?.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(path, {
    ...init,
    credentials: "include",
    headers,
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

async function openProject(p: Project): Promise<Project> {
  const vault = getVault();
  const looksEncrypted =
    !!p.key_wrap || isEncryptedText(p.title) || isEncryptedText(p.synopsis || "");

  if (p.key_wrap && vault) {
    try {
      const key = getProjectKey(p.id) || (await unwrapProjectKey(p.key_wrap, vault.privateKey));
      setProjectKey(p.id, key);
      return {
        ...p,
        title: await openText(p.id, p.title),
        synopsis: await openText(p.id, p.synopsis),
      };
    } catch {
      markProjectLocked(p.id);
      return { ...p, title: "Locked project", synopsis: "" };
    }
  }

  if (looksEncrypted) {
    markProjectLocked(p.id);
    return { ...p, title: "Locked project", synopsis: "" };
  }

  markProjectPlaintext(p.id);
  return p;
}

async function openElement(el: Element): Promise<Element> {
  rememberElementProject(el.id, el.project_id);
  const opened = {
    ...el,
    title: await openText(el.project_id, el.title),
    metadata: await openMeta(el.project_id, el.metadata),
  };
  elementTitleCache.set(opened.id, opened.title);
  return opened;
}

async function openPage(page: Page, projectId: string): Promise<Page> {
  rememberPageProject(page.id, projectId);
  return {
    ...page,
    title: await openText(projectId, page.title),
    description: await openText(projectId, page.description),
  };
}

async function openPanel(panel: Panel, projectId: string): Promise<Panel> {
  rememberPanelPage(panel.id, panel.page_id);
  rememberPageProject(panel.page_id, projectId);
  return {
    ...panel,
    title: await openText(projectId, panel.title),
    content: await openMeta(projectId, panel.content),
  };
}

async function putOwnWrap(projectId: string, projectKey: CryptoKey) {
  const vault = getVault();
  if (!vault) return;
  const wrap = await wrapProjectKey(projectKey, vault.privateKey, vault.publicRaw, vault.publicRaw);
  await req<void>(`/api/projects/${projectId}/key-wrap`, {
    method: "PUT",
    body: JSON.stringify({ wrap }),
  });
}

export const api = {
  me: () => req<User>("/api/auth/me"),
  authConfig: () => req<{ signup: boolean }>("/api/auth/config"),
  storage: () =>
    req<{ used_bytes: number; quota_bytes: number; used: string; quota: string }>(
      "/api/auth/storage"
    ),
  login: (username: string, password: string) =>
    req<{ user: User; vault?: VaultEnvelope | null }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  signup: (body: {
    username: string;
    email: string;
    password: string;
    crypto_json?: VaultEnvelope;
  }) => req<void>("/api/auth/signup", { method: "POST", body: JSON.stringify(body) }),
  verifyEmail: (token: string) =>
    req<void>("/api/auth/verify", { method: "POST", body: JSON.stringify({ token }) }),
  resendVerify: (email: string) =>
    req<void>("/api/auth/resend", { method: "POST", body: JSON.stringify({ email }) }),
  forgotPassword: (email: string) =>
    req<void>("/api/auth/forgot", { method: "POST", body: JSON.stringify({ email }) }),
  resetPassword: (token: string, password: string, crypto_json?: VaultEnvelope) =>
    req<void>("/api/auth/reset", {
      method: "POST",
      body: JSON.stringify({ token, password, crypto_json }),
    }),
  getVault: () => req<{ vault: VaultEnvelope | null }>("/api/auth/vault"),
  putVault: (crypto_json: VaultEnvelope) =>
    req<void>("/api/auth/vault", { method: "PUT", body: JSON.stringify({ crypto_json }) }),
  resetVault: (token: string) =>
    req<{ vault: VaultEnvelope | null }>(`/api/auth/reset-vault?token=${encodeURIComponent(token)}`),
  cryptoPubkey: (username: string) =>
    req<{ user_id: string; pub: string }>(`/api/crypto/pubkey/${encodeURIComponent(username)}`),
  listUsers: () => req<User[]>("/api/users"),
  createUser: (body: {
    username: string;
    password: string;
    email?: string;
    is_admin?: boolean;
  }) => req<User>("/api/users", { method: "POST", body: JSON.stringify(body) }),
  logout: () => req<void>("/api/auth/logout", { method: "POST" }),
  projects: async () => {
    const rows = await req<Project[]>("/api/projects");
    return Promise.all(rows.map(openProject));
  },
  createProject: async (title: string, synopsis = "") => {
    if (!title.trim()) throw new Error("title required");
    const vault = getVault();
    let key: CryptoKey | undefined;
    let sendTitle = title;
    let sendSynopsis = synopsis;
    if (vault) {
      key = await newProjectKey();
      sendTitle = await encryptText(key, title);
      sendSynopsis = await encryptText(key, synopsis);
    }
    const p = await req<Project>("/api/projects", {
      method: "POST",
      body: JSON.stringify({ title: sendTitle, synopsis: sendSynopsis }),
    });
    if (key) {
      setProjectKey(p.id, key);
      await putOwnWrap(p.id, key);
    } else {
      markProjectPlaintext(p.id);
    }
    return { ...p, title, synopsis };
  },
  getProject: async (id: string) => openProject(await req<Project>(`/api/projects/${id}`)),
  updateProject: async (id: string, body: { title: string; synopsis: string; theme_json?: object }) => {
    const p = await req<Project>(`/api/projects/${id}`, {
      method: "PUT",
      body: JSON.stringify({
        ...body,
        title: await sealText(id, body.title),
        synopsis: await sealText(id, body.synopsis),
      }),
    });
    return openProject(p);
  },
  deleteProject: (id: string) => req<void>(`/api/projects/${id}`, { method: "DELETE" }),
  elements: async (projectId: string, module?: ModuleType) => {
    const rows = await req<Element[]>(
      `/api/projects/${projectId}/elements${module ? `?module=${module}` : ""}`
    );
    return Promise.all(rows.map(openElement));
  },
  createElement: async (
    projectId: string,
    body: { module_type: ModuleType; title: string; parent_id?: string; metadata?: object }
  ) => {
    if (!body.title.trim()) throw new Error("title required");
    const el = await req<Element>(`/api/projects/${projectId}/elements`, {
      method: "POST",
      body: JSON.stringify({
        ...body,
        title: await sealText(projectId, body.title),
        metadata: await sealMeta(projectId, (body.metadata as Record<string, unknown>) || {}),
      }),
    });
    return openElement(el);
  },
  updateElement: async (
    id: string,
    body: { title: string; parent_id: string | null; sort_order: number; metadata: object }
  ) => {
    if (!body.title.trim()) throw new Error("title required");
    let projectId = projectForElement(id);
    let oldTitle = elementTitleCache.get(id);
    if (!projectId || oldTitle === undefined) {
      const existing = await openElement(await req<Element>(`/api/elements/${id}`));
      projectId = existing.project_id;
      oldTitle = existing.title;
    }
    rememberElementProject(id, projectId);
    const el = await req<Element>(`/api/elements/${id}`, {
      method: "PUT",
      body: JSON.stringify({
        ...body,
        title: await sealText(projectId, body.title),
        metadata: await sealMeta(projectId, body.metadata as Record<string, unknown>),
      }),
    });
    const opened = await openElement(el);
    if (getProjectKey(projectId) && oldTitle !== body.title) {
      await rewriteEncryptedWikilinks(
        projectId,
        opened.module_type,
        oldTitle,
        body.title
      );
    }
    return opened;
  },
  deleteElement: (id: string) => req<void>(`/api/elements/${id}`, { method: "DELETE" }),
  pages: async (elementId: string) => {
    const projectId =
      projectForElement(elementId) || (await req<Element>(`/api/elements/${elementId}`)).project_id;
    const rows = await req<Page[]>(`/api/elements/${elementId}/pages`);
    return Promise.all(rows.map((p) => openPage(p, projectId)));
  },
  createPage: async (elementId: string, title: string) => {
    const projectId =
      projectForElement(elementId) || (await req<Element>(`/api/elements/${elementId}`)).project_id;
    const page = await req<Page>(`/api/elements/${elementId}/pages`, {
      method: "POST",
      body: JSON.stringify({ title: await sealText(projectId, title) }),
    });
    return openPage(page, projectId);
  },
  updatePage: async (
    id: string,
    body: { title: string; description: string; sort_order: number },
    projectId?: string
  ) => {
    const pid = projectId || projectForPage(id);
    if (!pid) throw new Error("Missing project context for page update");
    rememberPageProject(id, pid);
    const page = await req<Page>(`/api/pages/${id}`, {
      method: "PUT",
      body: JSON.stringify({
        title: await sealText(pid, body.title),
        description: await sealText(pid, body.description),
        sort_order: body.sort_order,
      }),
    });
    return openPage(page, pid);
  },
  panels: async (pageId: string) => {
    const rows = await req<Panel[]>(`/api/pages/${pageId}/panels`);
    const projectId = projectForPage(pageId);
    if (!projectId) return rows;
    return Promise.all(rows.map((p) => openPanel(p, projectId)));
  },
  createPanel: async (
    pageId: string,
    body: { panel_type: string; title: string; content?: object; layout?: PanelLayout; sort_order?: number }
  ) => {
    const projectId = projectForPage(pageId);
    if (!projectId && getVault()) {
      throw new Error("Missing project context — reload the page and try again.");
    }
    const panel = await req<Panel>(`/api/pages/${pageId}/panels`, {
      method: "POST",
      body: JSON.stringify({
        ...body,
        title: await sealText(projectId, body.title),
        content: await sealMeta(projectId, (body.content as Record<string, unknown>) || {}),
      }),
    });
    return projectId ? openPanel(panel, projectId) : panel;
  },
  updatePanel: async (
    id: string,
    body: {
      title: string;
      border_color: string | null;
      layout: PanelLayout;
      content: object;
      sort_order: number;
    }
  ) => {
    const pageId = pageForPanel(id);
    const projectId = pageId ? projectForPage(pageId) : undefined;
    if (!projectId && getVault()) {
      throw new Error("Missing project context — reload the page and try again.");
    }
    const updated = await req<Panel>(`/api/panels/${id}`, {
      method: "PUT",
      body: JSON.stringify({
        ...body,
        title: await sealText(projectId, body.title),
        content: await sealMeta(projectId, body.content as Record<string, unknown>),
      }),
    });
    return projectId ? openPanel(updated, projectId) : updated;
  },
  deletePanel: (id: string) => req<void>(`/api/panels/${id}`, { method: "DELETE" }),
  links: async (projectId: string) => {
    const rows = await req<ElementLink[]>(`/api/projects/${projectId}/links`);
    return Promise.all(
      rows.map(async (l) => ({
        ...l,
        label: await openText(projectId, l.label),
        metadata: await openMeta(projectId, l.metadata),
      }))
    );
  },
  createLink: async (
    projectId: string,
    body: { from_element_id: string; to_element_id: string; label?: string; link_type?: string }
  ) => {
    const l = await req<ElementLink>(`/api/projects/${projectId}/links`, {
      method: "POST",
      body: JSON.stringify({
        ...body,
        label: await sealText(projectId, body.label || ""),
      }),
    });
    return { ...l, label: body.label || "" };
  },
  deleteLink: (id: string) => req<void>(`/api/links/${id}`, { method: "DELETE" }),
  manuscript: async (elementId: string) => {
    const el = await req<Element>(`/api/elements/${elementId}`);
    const body = await req<ManuscriptBody>(`/api/elements/${elementId}/manuscript`);
    const markdown = await openText(el.project_id, body.markdown);
    return { ...body, markdown, word_count: countWords(markdown) };
  },
  saveManuscript: async (
    elementId: string,
    markdown: string,
    word_goal: number | undefined,
    updated_at?: string
  ) => {
    const el = await req<Element>(`/api/elements/${elementId}`);
    const res = await fetch(`/api/elements/${elementId}/manuscript`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        markdown: await sealText(el.project_id, markdown),
        word_goal,
        updated_at,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as ManuscriptBody & { error?: string };
    if (res.status === 409) {
      const md = await openText(el.project_id, body.markdown);
      throw new ConflictError({ ...body, markdown: md, word_count: countWords(md) });
    }
    if (!res.ok) {
      throw new Error(body.error || res.statusText);
    }
    const md = await openText(el.project_id, body.markdown);
    return { ...body, markdown: md, word_count: countWords(md) } as ManuscriptBody;
  },
  grants: (projectId: string) => req<ProjectGrant[]>(`/api/projects/${projectId}/grants`),
  createInvite: async (projectId: string, role: string) => {
    const res = await req<{ token: string; invite: { id: string; role: string; expires_at: string } }>(
      `/api/projects/${projectId}/invites`,
      { method: "POST", body: JSON.stringify({ role }) }
    );
    const key = getProjectKey(projectId);
    if (key) {
      const wrap = await wrapProjectKeyWithToken(key, res.token);
      await req<void>(`/api/projects/${projectId}/invites/${res.invite.id}/key-wrap`, {
        method: "PUT",
        body: JSON.stringify({ wrap }),
      });
    }
    return res;
  },
  acceptInvite: async (token: string) => {
    const res = await req<{ project_id: string; role: string; key_wrap?: string | null }>(
      "/api/invites/accept",
      { method: "POST", body: JSON.stringify({ token }) }
    );
    if (res.key_wrap) {
      try {
        const key = await unwrapProjectKeyWithToken(res.key_wrap, token);
        setProjectKey(res.project_id, key);
        await putOwnWrap(res.project_id, key);
      } catch {
        /* invite had no usable wrap */
      }
    }
    return res;
  },
  upsertGrant: async (
    projectId: string,
    body: { username?: string; user_id?: string; role: string }
  ) => {
    await req<void>(`/api/projects/${projectId}/grants`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    const key = getProjectKey(projectId);
    const vault = getVault();
    const encrypted = projectCryptoMode(projectId) === "encrypted" || !!key;
    if (!body.username) {
      if (encrypted) {
        throw new Error(
          "Encrypted projects need a username so the project key can be wrapped for them."
        );
      }
      return;
    }
    if (!key || !vault) {
      if (encrypted) {
        throw new Error(
          "Unlock this project before granting access so the key can be shared."
        );
      }
      return;
    }
    try {
      const { pub } = await api.cryptoPubkey(body.username);
      const wrap = await wrapProjectKey(key, vault.privateKey, vault.publicRaw, unb64(pub));
      await req<void>(`/api/projects/${projectId}/key-wrap`, {
        method: "PUT",
        body: JSON.stringify({ wrap, username: body.username }),
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : "unknown error";
      throw new Error(
        `Access was granted, but the project key could not be wrapped for “${body.username}” (${detail}). They need a vault — have them sign in once, then grant again.`
      );
    }
  },
  deleteGrant: (projectId: string, userId: string) =>
    req<void>(`/api/projects/${projectId}/grants/${userId}`, { method: "DELETE" }),
  listAssets: (projectId: string) => req<AssetInfo[]>(`/api/projects/${projectId}/assets`),
  uploadAsset: async (projectId: string, file: File) => {
    const key = getProjectKey(projectId);
    if (!key) {
      const mode = projectCryptoMode(projectId);
      if (mode === "encrypted" || mode === "locked") {
        throw new Error(
          "This project is locked or missing its key — unlock before uploading images."
        );
      }
      if (getVault() && mode !== "plaintext") {
        throw new Error("Missing project key — refusing to upload an unencrypted asset.");
      }
    }
    let blob: Blob = file;
    if (key) {
      blob = await encryptAsset(key, await file.arrayBuffer());
    }
    const fd = new FormData();
    fd.append("file", new File([blob], file.name, { type: file.type || "application/octet-stream" }));
    return req<AssetInfo>(`/api/projects/${projectId}/assets`, {
      method: "POST",
      body: fd,
      headers: {},
    });
  },
  resolveAsset: async (projectId: string, url: string) => {
    if (!url || url.startsWith("blob:") || url.startsWith("data:")) return url;
    const key = getProjectKey(projectId);
    if (!key || !url.startsWith("/api/")) return url;
    const hit = cachedBlobUrl(url);
    if (hit) return hit;
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) return url;
    const buf = await res.arrayBuffer();
    const dec = await decryptAsset(key, buf);
    const blobUrl = URL.createObjectURL(new Blob([dec]));
    cacheBlobUrl(url, blobUrl);
    return blobUrl;
  },
  deleteAsset: (projectId: string, name: string) =>
    req<void>(`/api/projects/${projectId}/assets/${encodeURIComponent(name)}`, {
      method: "DELETE",
    }),
  exportProject: async (projectId: string, format: string, kind = "manuscript") => {
    if (getProjectKey(projectId)) {
      const md = await compileLocalMarkdown(projectId, kind);
      return new Blob([md], { type: "text/markdown;charset=utf-8" });
    }
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
    const project = await api.getProject(projectId);
    const base = (project.title || "project").replace(/[^\w\-]+/g, "_").slice(0, 80) || "project";
    // Encrypted projects: download decrypted intermediate JSON so restore works after re-import.
    if (getProjectKey(projectId)) {
      const data = await compileLocalIntermediate(projectId);
      return {
        blob: new Blob([JSON.stringify(data, null, 2)], {
          type: "application/json;charset=utf-8",
        }),
        filename: `${base}.tavern.json`,
      };
    }
    const res = await fetch(`/api/projects/${projectId}/backup`, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) {
      let msg = "backup failed";
      try {
        const j = await res.json();
        msg = j.error || msg;
      } catch {
        /* ignore */
      }
      throw new Error(msg);
    }
    return { blob: await res.blob(), filename: `${base}.tavern` };
  },
  importProject: async (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    const res = await req<{
      project: Project;
      report: { notes: string[]; unsupported_modules: string[] };
    }>("/api/import", { method: "POST", body: fd, headers: {} });
    const project = await ensureProjectEncrypted(res.project.id);
    return { ...res, project };
  },
  createTutorial: async () => {
    const res = await req<{ project: Project; report: { notes: string[] } }>(
      "/api/projects/tutorial",
      { method: "POST", body: "{}" }
    );
    const project = await ensureProjectEncrypted(res.project.id);
    return { ...res, project };
  },
};

async function ensureProjectEncrypted(projectId: string): Promise<Project> {
  const vault = getVault();
  const raw = await req<Project>(`/api/projects/${projectId}`);
  if (!vault) {
    markProjectPlaintext(projectId);
    return raw;
  }
  if (raw.key_wrap || getProjectKey(projectId)) {
    return openProject(raw);
  }

  // Server wrote plaintext (import/tutorial). Seal in place, then wrap the project key.
  const key = await newProjectKey();
  setProjectKey(projectId, key);

  await api.updateProject(projectId, {
    title: raw.title,
    synopsis: raw.synopsis,
    theme_json: raw.theme_json,
  });

  const elements = await req<Element[]>(`/api/projects/${projectId}/elements`);
  for (const el of elements) {
    rememberElementProject(el.id, projectId);
    await api.updateElement(el.id, {
      title: el.title,
      parent_id: el.parent_id,
      sort_order: el.sort_order,
      metadata: (el.metadata || {}) as Record<string, unknown>,
    });

    if (el.module_type === "manuscript") {
      const body = await req<ManuscriptBody>(`/api/elements/${el.id}/manuscript`);
      await api.saveManuscript(el.id, body.markdown, body.word_goal, body.updated_at);
    }

    const pages = await req<Page[]>(`/api/elements/${el.id}/pages`);
    for (const page of pages) {
      rememberPageProject(page.id, projectId);
      await api.updatePage(
        page.id,
        {
          title: page.title,
          description: page.description || "",
          sort_order: page.sort_order,
        },
        projectId
      );
      const panels = await req<Panel[]>(`/api/pages/${page.id}/panels`);
      for (const panel of panels) {
        rememberPanelPage(panel.id, page.id);
        await api.updatePanel(panel.id, {
          title: panel.title,
          border_color: panel.border_color,
          layout: panel.layout,
          content: (panel.content || {}) as Record<string, unknown>,
          sort_order: panel.sort_order,
        });
      }
    }
  }

  const links = await req<ElementLink[]>(`/api/projects/${projectId}/links`);
  for (const link of links) {
    await api.deleteLink(link.id);
    await api.createLink(projectId, {
      from_element_id: link.from_element_id,
      to_element_id: link.to_element_id,
      label: link.label,
      link_type: link.link_type,
    });
  }

  await putOwnWrap(projectId, key);
  return openProject(await req<Project>(`/api/projects/${projectId}`));
}

async function compileLocalIntermediate(projectId: string) {
  const project = await api.getProject(projectId);
  const elements = await api.elements(projectId);
  const links = await api.links(projectId);
  const idToTitle = new Map(elements.map((e) => [e.id, e.title]));
  const outElements = [];
  for (const el of elements.sort((a, b) => a.sort_order - b.sort_order)) {
    let body_markdown: string | null = null;
    const panels: {
      panel_type: string;
      title: string;
      content: Record<string, unknown>;
      layout: PanelLayout;
      page_title?: string;
    }[] = [];
    if (el.module_type === "manuscript") {
      const body = await api.manuscript(el.id);
      body_markdown = body.markdown;
    } else {
      const pages = await api.pages(el.id);
      for (const page of pages) {
        const pagePanels = await api.panels(page.id);
        for (const panel of pagePanels) {
          panels.push({
            panel_type: panel.panel_type,
            title: panel.title,
            content: panel.content,
            layout: panel.layout,
            page_title: page.title,
          });
        }
      }
    }
    outElements.push({
      module_type: el.module_type,
      title: el.title,
      parent_title: el.parent_id ? idToTitle.get(el.parent_id) || null : null,
      metadata: el.metadata,
      body_markdown,
      panels,
      unsupported_source: null,
    });
  }
  return {
    title: project.title,
    synopsis: project.synopsis,
    elements: outElements,
    links: links.map((l) => ({
      from_title: idToTitle.get(l.from_element_id) || "",
      to_title: idToTitle.get(l.to_element_id) || "",
      label: l.label,
      link_type: l.link_type,
    })),
  };
}

function rewriteWikiText(
  text: string,
  moduleType: ModuleType,
  oldTitle: string,
  newTitle: string
): string {
  const label = moduleType.charAt(0).toUpperCase() + moduleType.slice(1);
  return text
    .split(`[[${label}:${oldTitle}]]`)
    .join(`[[${label}:${newTitle}]]`)
    .split(`[[${moduleType}:${oldTitle}]]`)
    .join(`[[${moduleType}:${newTitle}]]`);
}

function rewriteWikiValue(
  value: unknown,
  moduleType: ModuleType,
  oldTitle: string,
  newTitle: string
): [unknown, boolean] {
  if (typeof value === "string") {
    const next = rewriteWikiText(value, moduleType, oldTitle, newTitle);
    return [next, next !== value];
  }
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const [rewritten, itemChanged] = rewriteWikiValue(item, moduleType, oldTitle, newTitle);
      changed ||= itemChanged;
      return rewritten;
    });
    return [next, changed];
  }
  if (value && typeof value === "object") {
    let changed = false;
    const next = Object.fromEntries(
      Object.entries(value).map(([key, item]) => {
        const [rewritten, itemChanged] = rewriteWikiValue(item, moduleType, oldTitle, newTitle);
        changed ||= itemChanged;
        return [key, rewritten];
      })
    );
    return [next, changed];
  }
  return [value, false];
}

async function rewriteEncryptedWikilinks(
  projectId: string,
  moduleType: ModuleType,
  oldTitle: string,
  newTitle: string
) {
  const elements = await api.elements(projectId);
  for (const element of elements) {
    if (element.module_type === "manuscript") {
      const body = await api.manuscript(element.id);
      const markdown = rewriteWikiText(body.markdown, moduleType, oldTitle, newTitle);
      if (markdown !== body.markdown) {
        await api.saveManuscript(
          element.id,
          markdown,
          body.word_goal,
          body.updated_at
        );
      }
      continue;
    }
    const pages = await api.pages(element.id);
    for (const page of pages) {
      const panels = await api.panels(page.id);
      for (const panel of panels) {
        const [content, changed] = rewriteWikiValue(
          panel.content,
          moduleType,
          oldTitle,
          newTitle
        );
        if (!changed) continue;
        await api.updatePanel(panel.id, {
          title: panel.title,
          border_color: panel.border_color,
          layout: panel.layout,
          content: content as Record<string, unknown>,
          sort_order: panel.sort_order,
        });
      }
    }
  }
}

async function compileLocalMarkdown(projectId: string, kind: string): Promise<string> {
  const project = await api.getProject(projectId);
  const elements = await api.elements(projectId);
  const lines: string[] = [`# ${project.title}`, ""];
  if (project.synopsis) {
    lines.push(project.synopsis, "");
  }
  const want = kind === "bible" ? elements : elements.filter((e) => e.module_type === "manuscript");
  for (const el of want.sort((a, b) => a.sort_order - b.sort_order)) {
    lines.push(`## ${el.title}`, "");
    if (el.module_type === "manuscript") {
      const body = await api.manuscript(el.id);
      lines.push(body.markdown, "");
      continue;
    }
    const pages = await api.pages(el.id);
    for (const page of pages) {
      lines.push(`### ${page.title}`, "");
      if (page.description) lines.push(page.description, "");
      const panels = await api.panels(page.id);
      for (const panel of panels) {
        const md = panel.content.markdown;
        if (typeof md === "string" && md.trim()) lines.push(md, "");
        const text = panel.content.text;
        if (typeof text === "string" && text.trim()) lines.push(text, "");
      }
    }
  }
  return lines.join("\n");
}

export const MODULES: { id: ModuleType; label: string }[] = [
  { id: "manuscript", label: "Manuscript" },
  { id: "character", label: "Characters" },
  { id: "encyclopedia", label: "Encyclopedia" },
  { id: "relationship", label: "Relationships" },
  { id: "location", label: "Locations" },
  { id: "systems", label: "Systems" },
  { id: "maps", label: "Maps" },
  { id: "timeline", label: "Timeline" },
  { id: "species", label: "Species" },
  { id: "cultures", label: "Cultures" },
  { id: "items", label: "Items" },
  { id: "arcs", label: "Arcs" },
  { id: "languages", label: "Languages" },
  { id: "religions", label: "Religions" },
  { id: "research", label: "Research" },
  { id: "philosophies", label: "Philosophies" },
  { id: "calendar", label: "Calendar" },
];
