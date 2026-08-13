import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, User } from "../api/client";
import { TIPS } from "../tips";

export default function UsersPage({
  user,
  onLogout,
}: {
  user: User;
  onLogout: () => Promise<void>;
}) {
  const [users, setUsers] = useState<User[]>([]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [makeAdmin, setMakeAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setUsers(await api.listUsers());
  }

  useEffect(() => {
    refresh().catch((e) => setError(String(e)));
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setBusy(true);
    setError(null);
    try {
      await api.createUser({
        username: username.trim(),
        password,
        is_admin: makeAdmin,
      });
      setUsername("");
      setPassword("");
      setMakeAdmin(false);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create user");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <header className="topbar">
        <Link to="/" className="brand" style={{ textDecoration: "none" }} data-tip={TIPS.brand}>
          Tavern
        </Link>
        <span className="muted" style={{ color: "#c5cec8" }}>
          {user.username} · admin
        </span>
        <div className="spacer" />
        <Link to="/">
          <button type="button">Projects</button>
        </Link>
        <button type="button" data-tip={TIPS.logout} onClick={() => onLogout()}>
          Log out
        </button>
      </header>
      <div className="projects-page">
        <h1>Accounts</h1>
        <p className="muted">
          Provision writers for this instance. Admin is only for creating accounts — it does not
          open other people’s projects.
        </p>

        <form className="stack" onSubmit={create} style={{ marginTop: "1.25rem", maxWidth: 420 }}>
          <input
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="off"
            required
            data-tip={TIPS.createUser}
          />
          <input
            type="password"
            placeholder="Password (12+ characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            required
            minLength={12}
            data-tip={TIPS.createUserPass}
          />
          <label className="row muted" style={{ width: "auto" }}>
            <input
              type="checkbox"
              checked={makeAdmin}
              onChange={(e) => setMakeAdmin(e.target.checked)}
              style={{ width: "auto" }}
              data-tip={TIPS.createUserAdmin}
            />
            Also an admin (can create accounts, not browse others’ projects)
          </label>
          <button className="primary" type="submit" disabled={busy} data-tip={TIPS.createUser}>
            {busy ? "Creating…" : "Create user"}
          </button>
        </form>

        {error && <p className="error">{error}</p>}

        <ul className="stack" style={{ marginTop: "1.5rem", padding: 0, listStyle: "none" }}>
          {users.map((u) => (
            <li key={u.id} className="project-card" style={{ maxWidth: 480 }}>
              <strong>{u.username}</strong>
              <span className="muted" style={{ marginLeft: "0.5rem" }}>
                {u.is_admin ? "admin" : "writer"}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
