import { FormEvent, useState } from "react";
import { api, User } from "../api/client";
import RecoveryKey from "../components/RecoveryKey";
import {
  createVault,
  parseEnvelope,
  unlockWithPassword,
  vaultCryptoAvailable,
} from "../crypto/vault";
import { setVault } from "../crypto/session";

export default function UnlockPage({
  user,
  onReady,
  onLogout,
}: {
  user: User;
  onReady: () => void;
  onLogout: () => Promise<void>;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);

  const needsSetup = !user.has_vault;
  const cryptoOk = vaultCryptoAvailable();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (needsSetup) {
        const { envelope, recoveryKey: rk, unlocked } = await createVault(password);
        await api.putVault(envelope);
        setVault({ userId: user.id, ...unlocked });
        setRecoveryKey(rk);
        return;
      }
      const { vault } = await api.getVault();
      const envelope = parseEnvelope(vault);
      if (!envelope) {
        setError("No vault on this account. Refresh and try again.");
        return;
      }
      const unlocked = await unlockWithPassword(envelope, password);
      setVault({ userId: user.id, ...unlocked });
      onReady();
    } catch (err) {
      const msg = err instanceof Error ? err.message : null;
      if (msg && !/wrong password|operationerror|decrypt/i.test(msg)) {
        setError(msg);
      } else {
        setError(needsSetup ? "Could not create a vault." : "Wrong password, or vault is damaged.");
      }
    } finally {
      setBusy(false);
    }
  }

  if (recoveryKey) {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="brand">Tavern</div>
          <h1>Save your recovery key</h1>
          <RecoveryKey recoveryKey={recoveryKey} onContinue={onReady} />
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="brand">Tavern</div>
        <h1>{needsSetup ? "Lock your writing" : "Unlock vault"}</h1>
        <p>
          {needsSetup
            ? "Your stories are encrypted in the browser. The server only stores ciphertext. You’ll get a recovery key next — we cannot reset that for you."
            : "This tab doesn’t have your vault key. Enter your password to unwrap it. We never send the key to the server."}
        </p>
        {!cryptoOk && (
          <div className="error">
            Vault crypto needs a secure browser context. Open Tavern via{" "}
            <code>http://127.0.0.1</code> on this machine, or serve it over HTTPS — plain HTTP to a
            LAN IP cannot create or unlock a vault.
          </div>
        )}
        <form onSubmit={submit}>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={needsSetup ? "new-password" : "current-password"}
              minLength={needsSetup ? 12 : undefined}
              required
              disabled={!cryptoOk}
            />
          </label>
          {error && <div className="error">{error}</div>}
          <button className="primary" disabled={busy || !cryptoOk}>
            {busy ? "Working…" : needsSetup ? "Create vault" : "Unlock"}
          </button>
        </form>
        <p className="login-links">
          <button type="button" className="ghost" onClick={() => void onLogout()}>
            Log out
          </button>
        </p>
      </div>
    </div>
  );
}
