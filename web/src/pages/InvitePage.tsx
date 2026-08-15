import { useEffect, useMemo, useState } from "react";
import { api, User } from "../api/client";
import { Link, Navigate, useHash, useNavigate, usePath } from "../lib/router";

export default function InvitePage({ user }: { user: User | null }) {
  const path = usePath();
  const hash = useHash();
  const token = useMemo(() => {
    if (hash) return hash;
    // Legacy path-based invites: /invite/<token>
    if (path.startsWith("/invite/")) {
      try {
        return decodeURIComponent(path.slice("/invite/".length));
      } catch {
        return "";
      }
    }
    return "";
  }, [hash, path]);
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  // Preserve the secret in the fragment across the login redirect.
  const next = token ? `/invite#${encodeURIComponent(token)}` : "/invite";

  useEffect(() => {
    if (!user || !token) return;
    (async () => {
      try {
        const res = await api.acceptInvite(token);
        navigate(`/project/${res.project_id}`, { replace: true });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Invite failed");
      }
    })();
  }, [user, token, navigate]);

  if (!user) {
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>Invite</h1>
        {error ? (
          <>
            <p className="error">{error}</p>
            <Link to="/">Back to projects</Link>
          </>
        ) : (
          <p className="muted">Joining the project…</p>
        )}
      </div>
    </div>
  );
}
