import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";

export default function SignupPage() {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.signup({ username: username.trim(), email: email.trim(), password });
      setDone(true);
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
        {done ? (
          <>
            <p>Check your email for a verification link. Then you can sign in.</p>
            <p className="login-links">
              <Link to="/login">Back to sign in</Link>
            </p>
          </>
        ) : (
          <>
            <p>Create an account. We’ll send a link to confirm your email.</p>
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
                />
              </label>
              {error && <div className="error">{error}</div>}
              <button className="primary" disabled={busy}>
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
