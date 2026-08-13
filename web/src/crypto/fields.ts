import {
  decryptJson,
  decryptText,
  encryptJson,
  encryptText,
} from "./vault";
import { getProjectKey } from "./session";

function keyFor(projectId: string | undefined): CryptoKey | undefined {
  return projectId ? getProjectKey(projectId) : undefined;
}

export async function sealText(projectId: string | undefined, s: string): Promise<string> {
  const key = keyFor(projectId);
  if (!key) return s;
  return encryptText(key, s);
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
  if (!key) return meta;
  return { e: await encryptJson(key, meta) };
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
