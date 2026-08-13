import { FormEvent, useEffect, useState } from "react";
import { api, User } from "../api/client";
import RecoveryKey from "../components/RecoveryKey";
import { createVault, parseEnvelope } from "../crypto/vault";
import { setVault, unlockEnvelope } from "../crypto/session";
import { Link } from "../lib/router";
import { TIPS } from "../tips";

export default function LoginPage({ onLogin }: { onLogin: (u: User) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [signup, setSignup] = useState(false);
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [pendingUser, setPendingUser] = useState<User | null>(null);

  useEffect(() => {
    api.authConfig().then((c) => setSignup(c.signup)).catch(() => setSignup(false));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.login(username, password);
      const envelope = parseEnvelope(res.vault);
      if (envelope) {
        await unlockEnvelope(res.user.id, envelope, password);
        onLogin(res.user);
        return;
      }
      if (res.user.has_vault) {
        setError("Vault on this account is unreadable. Writing cannot be unlocked from here.");
        return;
      }
      const { envelope: created, recoveryKey: rk, unlocked } = await createVault(password);
      await api.putVault(created);
      setVault({ userId: res.user.id, ...unlocked });
      setPendingUser({ ...res.user, has_vault: true });
      setRecoveryKey(rk);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  if (recoveryKey && pendingUser) {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="brand">Tavern</div>
          <h1>Save your recovery key</h1>
          <RecoveryKey
            recoveryKey={recoveryKey}
            onContinue={() => onLogin(pendingUser)}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="brand" data-tip={TIPS.brand}>
          Tavern
        </div>
        <h1>Pull up a chair</h1>
        <p>Self-hosted writing & worldbuilding — your stories, your fire.</p>
        <form onSubmit={submit}>
          <label data-tip={TIPS.loginUser}>
            Username
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
          </label>
          <label data-tip={TIPS.loginPass}>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          {error && <div className="error">{error}</div>}
          <button className="primary" disabled={busy} data-tip="Sign in to your writing workspace">
            {busy ? "Entering…" : "Enter"}
          </button>
        </form>
        <p className="login-links">
          <Link to="/forgot">Forgot password</Link>
          {signup && (
            <>
              {" · "}
              <Link to="/signup">Create an account</Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
