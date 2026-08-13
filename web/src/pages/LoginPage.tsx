import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, User } from "../api/client";
import { TIPS } from "../tips";

export default function LoginPage({ onLogin }: { onLogin: (u: User) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [signup, setSignup] = useState(false);

  useEffect(() => {
    api.authConfig().then((c) => setSignup(c.signup)).catch(() => setSignup(false));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.login(username, password);
      onLogin(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
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
