import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { api, User } from "../api/client";

export default function InvitePage({ user }: { user: User | null }) {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  const next = `/invite/${encodeURIComponent(token)}`;

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
