import { FormEvent, useState } from "react";
import { api } from "../api/client";
import RecoveryKey from "../components/RecoveryKey";
import { createVault, vaultCryptoAvailable } from "../crypto/vault";
import { Link } from "../lib/router";

export default function SignupPage() {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const cryptoOk = vaultCryptoAvailable();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { envelope, recoveryKey: rk } = await createVault(password);
      await api.signup({
        username: username.trim(),
        email: email.trim(),
        password,
        crypto_json: envelope,
      });
      setRecoveryKey(rk);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign up failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="brand">Tavern</div>
        <h1>Take a seat</h1>
        {recoveryKey && !done ? (
          <>
            <h2 style={{ fontSize: "1.2rem", marginTop: 0 }}>Save your recovery key</h2>
            <RecoveryKey
              recoveryKey={recoveryKey}
              onContinue={() => setDone(true)}
              continueLabel="I’ve saved it — continue"
            />
          </>
        ) : done ? (
          <>
            <p>Check your email for a verification link. Then you can sign in.</p>
            <p className="login-links">
              <Link to="/login">Back to sign in</Link>
            </p>
          </>
        ) : (
          <>
            <p>
              Create an account. Writing is encrypted in your browser. We’ll email a link to confirm
              your address — never your recovery key.
            </p>
            {!cryptoOk && (
              <div className="error">
                Vault crypto needs a secure browser context. Open Tavern via{" "}
                <code>http://127.0.0.1</code> on this machine, or serve it over HTTPS before signing
                up.
              </div>
            )}
            <form onSubmit={submit}>
              <label>
                Username
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  minLength={3}
                  maxLength={32}
                  required
                  disabled={!cryptoOk}
                />
              </label>
              <label>
                Email
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                  disabled={!cryptoOk}
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={12}
                  required
                  disabled={!cryptoOk}
                />
              </label>
              {error && <div className="error">{error}</div>}
              <button className="primary" disabled={busy || !cryptoOk}>
                {busy ? "Creating…" : "Create account"}
              </button>
            </form>
            <p className="login-links">
              <Link to="/login">Already have an account</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
