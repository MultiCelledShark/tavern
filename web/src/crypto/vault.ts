/** Client-side vault. The server stores envelopes only — never wrapping keys. */

export const TEXT_PREFIX = "tv1.";
export const ASSET_MAGIC = new Uint8Array([0x54, 0x56, 0x31, 0x00]); // TV1\0
const PBKDF2_ITERS = 210_000;

export type VaultEnvelope = {
  v: 1;
  kdf: "pbkdf2-sha256";
  iterations: number;
  pw_salt: string;
  rk_salt: string;
  vault_pw: string;
  vault_rk: string;
  pub: string;
  priv_wrap: string;
};

export type UnlockedVault = {
  userId: string;
  vaultKey: CryptoKey;
  privateKey: CryptoKey;
  publicRaw: Uint8Array;
};

const te = new TextEncoder();
const td = new TextDecoder();

export function b64(data: BufferSource): string {
  const u = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  let s = "";
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s);
}

export function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

export function formatRecoveryKey(raw: Uint8Array): string {
  const hex = [...raw].map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex.match(/.{1,4}/g)!.join("-");
}

export function parseRecoveryKey(s: string): Uint8Array {
  const hex = s.toLowerCase().replace(/[^0-9a-f]/g, "");
  if (hex.length !== 32) throw new Error("recovery key should be 32 hex characters (with optional dashes)");
  const u = new Uint8Array(16);
  for (let i = 0; i < 16; i++) u[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return u;
}

function randomBytes(n: number): Uint8Array {
  const u = new Uint8Array(n);
  crypto.getRandomValues(u);
  return u;
}

async function pbkdf2(secret: BufferSource, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", secret, "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function aesEncrypt(key: CryptoKey, plain: BufferSource): Promise<string> {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return b64(out);
}

export async function aesDecrypt(key: CryptoKey, packed: string): Promise<Uint8Array> {
  const raw = unb64(packed);
  if (raw.length < 13) throw new Error("ciphertext too short");
  const iv = raw.slice(0, 12);
  const ct = raw.slice(12);
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct));
}

export function isEncryptedText(s: string): boolean {
  return s.startsWith(TEXT_PREFIX);
}

export async function encryptText(key: CryptoKey, s: string): Promise<string> {
  if (!s) return s;
  if (isEncryptedText(s)) return s;
  return TEXT_PREFIX + (await aesEncrypt(key, te.encode(s)));
}

export async function decryptText(key: CryptoKey, s: string): Promise<string> {
  if (!s || !isEncryptedText(s)) return s;
  return td.decode(await aesDecrypt(key, s.slice(TEXT_PREFIX.length)));
}

export async function encryptJson(key: CryptoKey, v: unknown): Promise<string> {
  return encryptText(key, JSON.stringify(v ?? {}));
}

export async function decryptJson<T>(key: CryptoKey, s: string, fallback: T): Promise<T> {
  if (!s) return fallback;
  if (!isEncryptedText(s)) {
    try {
      return JSON.parse(s) as T;
    } catch {
      return fallback;
    }
  }
  try {
    return JSON.parse(await decryptText(key, s)) as T;
  } catch {
    return fallback;
  }
}

export function isEncryptedAsset(buf: ArrayBuffer): boolean {
  const u = new Uint8Array(buf);
  if (u.length < ASSET_MAGIC.length) return false;
  return ASSET_MAGIC.every((b, i) => u[i] === b);
}

export async function encryptAsset(key: CryptoKey, buf: ArrayBuffer): Promise<Blob> {
  const packed = unb64(await aesEncrypt(key, buf));
  const out = new Uint8Array(ASSET_MAGIC.length + packed.length);
  out.set(ASSET_MAGIC, 0);
  out.set(packed, ASSET_MAGIC.length);
  return new Blob([out]);
}

export async function decryptAsset(key: CryptoKey, buf: ArrayBuffer): Promise<ArrayBuffer> {
  if (!isEncryptedAsset(buf)) return buf;
  const packed = b64(new Uint8Array(buf).slice(ASSET_MAGIC.length));
  return (await aesDecrypt(key, packed)).buffer;
}

async function importAesRaw(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw, "AES-GCM", true, ["encrypt", "decrypt"]);
}

async function wrapRawKey(wrapKey: CryptoKey, raw: Uint8Array): Promise<string> {
  return aesEncrypt(wrapKey, raw);
}

async function unwrapRawKey(wrapKey: CryptoKey, packed: string): Promise<Uint8Array> {
  return aesDecrypt(wrapKey, packed);
}

export async function createVault(
  password: string
): Promise<{ envelope: VaultEnvelope; recoveryKey: string; unlocked: Omit<UnlockedVault, "userId"> }> {
  const vaultRaw = randomBytes(32);
  const recoveryRaw = randomBytes(16);
  const pwSalt = randomBytes(16);
  const rkSalt = randomBytes(16);
  const vaultKey = await importAesRaw(vaultRaw);
  const pwKey = await pbkdf2(te.encode(password), pwSalt, PBKDF2_ITERS);
  const rkKey = await pbkdf2(recoveryRaw, rkSalt, PBKDF2_ITERS);
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ]);
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const privPkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const envelope: VaultEnvelope = {
    v: 1,
    kdf: "pbkdf2-sha256",
    iterations: PBKDF2_ITERS,
    pw_salt: b64(pwSalt),
    rk_salt: b64(rkSalt),
    vault_pw: await wrapRawKey(pwKey, vaultRaw),
    vault_rk: await wrapRawKey(rkKey, vaultRaw),
    pub: b64(pub),
    priv_wrap: await wrapRawKey(vaultKey, privPkcs8),
  };
  return {
    envelope,
    recoveryKey: formatRecoveryKey(recoveryRaw),
    unlocked: { vaultKey, privateKey: pair.privateKey, publicRaw: pub },
  };
}

export async function unlockWithPassword(
  envelope: VaultEnvelope,
  password: string
): Promise<Omit<UnlockedVault, "userId">> {
  const pwKey = await pbkdf2(te.encode(password), unb64(envelope.pw_salt), envelope.iterations);
  return finishUnlock(envelope, await unwrapRawKey(pwKey, envelope.vault_pw));
}

export async function unlockWithRecovery(
  envelope: VaultEnvelope,
  recoveryKey: string
): Promise<Omit<UnlockedVault, "userId">> {
  const rkKey = await pbkdf2(parseRecoveryKey(recoveryKey), unb64(envelope.rk_salt), envelope.iterations);
  return finishUnlock(envelope, await unwrapRawKey(rkKey, envelope.vault_rk));
}

async function finishUnlock(
  envelope: VaultEnvelope,
  vaultRaw: Uint8Array
): Promise<Omit<UnlockedVault, "userId">> {
  const vaultKey = await importAesRaw(vaultRaw);
  const privPkcs8 = await unwrapRawKey(vaultKey, envelope.priv_wrap);
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    privPkcs8,
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );
  return { vaultKey, privateKey, publicRaw: unb64(envelope.pub) };
}

export async function rewrapVaultPassword(
  envelope: VaultEnvelope,
  vaultKey: CryptoKey,
  newPassword: string
): Promise<VaultEnvelope> {
  const vaultRaw = new Uint8Array(await crypto.subtle.exportKey("raw", vaultKey));
  const pwSalt = randomBytes(16);
  const pwKey = await pbkdf2(te.encode(newPassword), pwSalt, envelope.iterations);
  return {
    ...envelope,
    pw_salt: b64(pwSalt),
    vault_pw: await wrapRawKey(pwKey, vaultRaw),
  };
}

async function ecdhAes(privateKey: CryptoKey, publicRaw: Uint8Array): Promise<CryptoKey> {
  const pub = await crypto.subtle.importKey(
    "raw",
    publicRaw,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );
  const bits = await crypto.subtle.deriveBits({ name: "ECDH", public: pub }, privateKey, 256);
  const hkdfBase = await crypto.subtle.importKey("raw", bits, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: te.encode("tavern-project-wrap"), info: te.encode("v1") },
    hkdfBase,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function newProjectKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

export async function wrapProjectKey(
  projectKey: CryptoKey,
  myPrivate: CryptoKey,
  myPublic: Uint8Array,
  theirPub: Uint8Array
): Promise<string> {
  const wrapKey = await ecdhAes(myPrivate, theirPub);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", projectKey));
  return JSON.stringify({ w: await aesEncrypt(wrapKey, raw), from: b64(myPublic) });
}

export async function unwrapProjectKey(packed: string, myPrivate: CryptoKey): Promise<CryptoKey> {
  const j = JSON.parse(packed) as { w: string; from: string };
  if (!j.w || !j.from) throw new Error("bad project wrap");
  const wrapKey = await ecdhAes(myPrivate, unb64(j.from));
  return importAesRaw(await aesDecrypt(wrapKey, j.w));
}

/** Invite token is the wrap secret; server only stores the hash. */
export async function wrapProjectKeyWithToken(projectKey: CryptoKey, token: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await pbkdf2(te.encode(token), salt, 120_000);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", projectKey));
  return b64(salt) + "." + (await aesEncrypt(key, raw));
}

export async function unwrapProjectKeyWithToken(packed: string, token: string): Promise<CryptoKey> {
  const [saltB64, ct] = packed.split(".");
  if (!saltB64 || !ct) throw new Error("bad invite wrap");
  const key = await pbkdf2(te.encode(token), unb64(saltB64), 120_000);
  return importAesRaw(await aesDecrypt(key, ct));
}

export function parseEnvelope(raw: unknown): VaultEnvelope | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as VaultEnvelope;
  if (e.v !== 1 || !e.vault_pw || !e.vault_rk || !e.pub || !e.priv_wrap) return null;
  return e;
}
