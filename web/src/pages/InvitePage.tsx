import { useEffect, useState } from "react";
import { api, User } from "../api/client";
import { Link, Navigate, useHash, useNavigate, usePath } from "../lib/router";

const PENDING_INVITE_KEY = "tavern_pending_invite";

function readStowedInvite(): string {
  try {
    return sessionStorage.getItem(PENDING_INVITE_KEY) || "";
  } catch {
    return "";
  }
}

function stowInvite(token: string) {
  try {
    sessionStorage.setItem(PENDING_INVITE_KEY, token);
  } catch {
    /* private mode / quota */
  }
}

function clearStowedInvite() {
  try {
    sessionStorage.removeItem(PENDING_INVITE_KEY);
  } catch {
    /* ignore */
  }
}

export default function InvitePage({ user }: { user: User | null }) {
  const path = usePath();
  const hash = useHash();
  const navigate = useNavigate();
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Fragment or sessionStorage only — path tokens hit proxy access logs.
  useEffect(() => {
    if (path.startsWith("/invite/")) {
      setError("This invite link format is no longer supported. Ask for a fresh invite link.");
      navigate("/invite", { replace: true });
      setToken("");
      return;
    }
    let t = "";
    if (hash) {
      t = hash;
    } else {
      t = readStowedInvite();
    }
    if (t) {
      stowInvite(t);
      if (hash) {
        navigate("/invite", { replace: true });
      }
    }
    setToken(t);
  }, [hash, path, navigate]);

  useEffect(() => {
    if (!user || !token) return;
    (async () => {
      try {
        const res = await api.acceptInvite(token);
        clearStowedInvite();
        navigate(`/project/${res.project_id}`, { replace: true });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Invite failed");
      }
    })();
  }, [user, token, navigate]);

  if (!user) {
    return <Navigate to="/login?next=%2Finvite" replace />;
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
