import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { api, User } from "./api/client";
import LoginPage from "./pages/LoginPage";
import ProjectsPage from "./pages/ProjectsPage";
import ProjectWorkspace from "./pages/ProjectWorkspace";
import UsersPage from "./pages/UsersPage";
import InvitePage from "./pages/InvitePage";

function safeNext(search: string): string {
  const n = new URLSearchParams(search).get("next");
  if (n && n.startsWith("/") && !n.startsWith("//") && !n.includes("\\")) return n;
  return "/";
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .me()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="login-page">
        <p className="muted">Opening the tavern…</p>
      </div>
    );
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={
          user ? (
            <LoginRedirect />
          ) : (
            <LoginPage onLogin={setUser} />
          )
        }
      />
      <Route path="/invite/:token" element={<InvitePage user={user} />} />
      <Route
        path="/"
        element={
          user ? (
            <ProjectsPage
              user={user}
              onLogout={async () => {
                await api.logout();
                setUser(null);
              }}
            />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/users"
        element={
          user?.is_admin ? (
            <UsersPage
              user={user}
              onLogout={async () => {
                await api.logout();
                setUser(null);
              }}
            />
          ) : user ? (
            <Navigate to="/" replace />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/project/:projectId/*"
        element={
          user ? (
            <ProjectWorkspace
              user={user}
              onLogout={async () => {
                await api.logout();
                setUser(null);
              }}
            />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
    </Routes>
  );
}

function LoginRedirect() {
  const loc = useLocation();
  return <Navigate to={safeNext(loc.search)} replace />;
}
