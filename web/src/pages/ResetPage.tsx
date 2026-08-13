import { FormEvent, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { parseEnvelope, rewrapVaultPassword, unlockWithRecovery } from "../crypto/vault";

export default function ResetPage() {
  const [params] = useSearchParams();
  const token = useMemo(() => params.get("token") || "", [params]);
  const [password, setPassword] = useState("");
  const [recoveryKey, setRecoveryKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { vault } = await api.resetVault(token);
      const envelope = parseEnvelope(vault);
      if (envelope) {
        if (!recoveryKey.trim()) {
          setError("Recovery key is required to keep your writing.");
          return;
        }
        const unlocked = await unlockWithRecovery(envelope, recoveryKey.trim());
        const next = await rewrapVaultPassword(envelope, unlocked.vaultKey, password);
        await api.resetPassword(token, password, next);
      } else {
        await api.resetPassword(token, password);
      }
      setDone(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Reset failed. Check the recovery key — without it, encrypted writing cannot be recovered."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="brand">Tavern</div>
        <h1>New password</h1>
        {!token ? (
          <p className="error">Missing reset token. Use the link from your email.</p>
        ) : done ? (
          <>
            <p>Password updated. Sign in with it.</p>
            <p className="login-links">
              <Link to="/login">Sign in</Link>
            </p>
          </>
        ) : (
          <form onSubmit={submit}>
            <p>
              Email only proves you can receive mail. To keep novels readable, enter the recovery
              key shown when you signed up. We cannot reconstruct it.
            </p>
            <label>
              Recovery key
              <input
                value={recoveryKey}
                onChange={(e) => setRecoveryKey(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                placeholder="xxxx-xxxx-xxxx-xxxx-xxxx-xxxx-xxxx-xxxx"
              />
            </label>
            <label>
              New password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                minLength={12}
                required
              />
            </label>
            {error && <div className="error">{error}</div>}
            <button className="primary" disabled={busy}>
              {busy ? "Saving…" : "Set password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
