import {
  UnlockedVault,
  VaultEnvelope,
  b64,
  unb64,
  unlockWithPassword,
} from "./vault";

const STORE = "tavern_vault_v1";

let current: UnlockedVault | null = null;
const projectKeys = new Map<string, CryptoKey>();
const elemProject = new Map<string, string>();
const pageProject = new Map<string, string>();
const panelPage = new Map<string, string>();
const blobUrls = new Map<string, string>();

export function getVault(): UnlockedVault | null {
  return current;
}

export function setVault(v: UnlockedVault | null) {
  current = v;
  if (!v) {
    projectKeys.clear();
    sessionStorage.removeItem(STORE);
    return;
  }
  persist(v).catch(() => undefined);
}

export function rememberElementProject(elementId: string, projectId: string) {
  elemProject.set(elementId, projectId);
}

export function rememberPageProject(pageId: string, projectId: string) {
  pageProject.set(pageId, projectId);
}

export function projectForElement(elementId: string): string | undefined {
  return elemProject.get(elementId);
}

export function projectForPage(pageId: string): string | undefined {
  return pageProject.get(pageId);
}

export function rememberPanelPage(panelId: string, pageId: string) {
  panelPage.set(panelId, pageId);
}

export function pageForPanel(panelId: string): string | undefined {
  return panelPage.get(panelId);
}

export function setProjectKey(projectId: string, key: CryptoKey) {
  projectKeys.set(projectId, key);
}

export function getProjectKey(projectId: string): CryptoKey | undefined {
  return projectKeys.get(projectId);
}

export function cacheBlobUrl(key: string, url: string) {
  blobUrls.set(key, url);
}

export function cachedBlobUrl(key: string): string | undefined {
  return blobUrls.get(key);
}

async function persist(v: UnlockedVault) {
  const vaultRaw = new Uint8Array(await crypto.subtle.exportKey("raw", v.vaultKey));
  const priv = new Uint8Array(await crypto.subtle.exportKey("pkcs8", v.privateKey));
  sessionStorage.setItem(
    STORE,
    JSON.stringify({
      userId: v.userId,
      vault: b64(vaultRaw),
      priv: b64(priv),
      pub: b64(v.publicRaw),
    })
  );
}

export async function restoreVault(userId: string): Promise<UnlockedVault | null> {
  const raw = sessionStorage.getItem(STORE);
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as { userId: string; vault: string; priv: string; pub: string };
    if (j.userId !== userId) return null;
    const vaultKey = await crypto.subtle.importKey(
      "raw",
      unb64(j.vault),
      "AES-GCM",
      true,
      ["encrypt", "decrypt"]
    );
    const privateKey = await crypto.subtle.importKey(
      "pkcs8",
      unb64(j.priv),
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveBits"]
    );
    current = { userId, vaultKey, privateKey, publicRaw: unb64(j.pub) };
    return current;
  } catch {
    sessionStorage.removeItem(STORE);
    return null;
  }
}

export async function unlockEnvelope(
  userId: string,
  envelope: VaultEnvelope,
  password: string
): Promise<UnlockedVault> {
  const u = await unlockWithPassword(envelope, password);
  const v: UnlockedVault = { userId, ...u };
  setVault(v);
  return v;
}

export function clearVault() {
  setVault(null);
  for (const url of blobUrls.values()) URL.revokeObjectURL(url);
  blobUrls.clear();
  elemProject.clear();
  pageProject.clear();
  panelPage.clear();
}
