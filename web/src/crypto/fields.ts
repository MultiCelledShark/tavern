import {
  decryptJson,
  decryptText,
  encryptJson,
  encryptText,
} from "./vault";
import { getProjectKey, getVault, projectCryptoMode } from "./session";

function keyFor(projectId: string | undefined): CryptoKey | undefined {
  return projectId ? getProjectKey(projectId) : undefined;
}

function sealDenied(projectId: string | undefined): never {
  const mode = projectId ? projectCryptoMode(projectId) : undefined;
  if (mode === "locked") {
    throw new Error("This project is locked. Unlock your vault (or ask for a share) before editing.");
  }
  if (!projectId) {
    throw new Error("Missing project context — cannot encrypt this change.");
  }
  throw new Error(
    "Missing project key — refusing to save plaintext into an encrypted project. Unlock the project or reload."
  );
}

/** Encrypt when a project key is present; allow plaintext only for known plaintext projects. */
export async function sealText(projectId: string | undefined, s: string): Promise<string> {
  if (!s) return s;
  const key = keyFor(projectId);
  if (key) return encryptText(key, s);
  const mode = projectId ? projectCryptoMode(projectId) : undefined;
  if (mode === "plaintext") return s;
  // No vault and no mode yet (legacy / never opened): leave plaintext.
  if (!getVault() && mode === undefined) return s;
  sealDenied(projectId);
}

export async function openText(projectId: string | undefined, s: string): Promise<string> {
  const key = keyFor(projectId);
  if (!key) return s;
  try {
    return await decryptText(key, s);
  } catch {
    return s;
  }
}

export async function sealMeta(
  projectId: string | undefined,
  meta: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const key = keyFor(projectId);
  if (key) return { e: await encryptJson(key, meta) };
  const mode = projectId ? projectCryptoMode(projectId) : undefined;
  if (mode === "plaintext") return meta;
  if (!getVault() && mode === undefined) return meta;
  // Empty meta on plaintext-adjacent paths
  if (!meta || Object.keys(meta).length === 0) {
    if (mode === "encrypted" || mode === "locked" || getVault()) sealDenied(projectId);
    return meta;
  }
  sealDenied(projectId);
}

export async function openMeta(
  projectId: string | undefined,
  meta: Record<string, unknown> | null | undefined
): Promise<Record<string, unknown>> {
  const m = meta && typeof meta === "object" ? meta : {};
  const key = keyFor(projectId);
  if (!key) return m;
  const e = m.e;
  if (typeof e === "string") {
    return (await decryptJson(key, e, m)) as Record<string, unknown>;
  }
  return m;
}

export function countWords(s: string): number {
  return s.trim() ? s.trim().split(/\s+/).length : 0;
}
