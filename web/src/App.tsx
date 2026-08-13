import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { api, User } from "./api/client";
import LoginPage from "./pages/LoginPage";
import SignupPage from "./pages/SignupPage";
import ForgotPage from "./pages/ForgotPage";
import ResetPage from "./pages/ResetPage";
import VerifyPage from "./pages/VerifyPage";
import UnlockPage from "./pages/UnlockPage";
import ProjectsPage from "./pages/ProjectsPage";
import ProjectWorkspace from "./pages/ProjectWorkspace";
import UsersPage from "./pages/UsersPage";
import InvitePage from "./pages/InvitePage";
import { clearVault, getVault, restoreVault } from "./crypto/session";

function safeNext(search: string): string {
  const n = new URLSearchParams(search).get("next");
  if (n && n.startsWith("/") && !n.startsWith("//") && !n.includes("\\")) return n;
  return "/";
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [vaultReady, setVaultReady] = useState(false);

  useEffect(() => {
    api
      .me()
      .then(async (u) => {
        setUser(u);
        const restored = await restoreVault(u.id);
        setVaultReady(!!restored);
      })
      .catch(() => {
        setUser(null);
        clearVault();
        setVaultReady(false);
      })
      .finally(() => setLoading(false));
  }, []);

  async function logout() {
    await api.logout();
    clearVault();
    setVaultReady(false);
    setUser(null);
  }

  if (loading) {
    return (
      <div className="login-page">
        <p className="muted">Opening the tavern…</p>
      </div>
    );
  }

  const locked = !!user && !vaultReady && !getVault();

  return (
    <Routes>
      <Route
        path="/login"
        element={
          user ? (
            locked ? (
              <UnlockPage
                user={user}
                onReady={() => setVaultReady(true)}
                onLogout={logout}
              />
            ) : (
              <LoginRedirect />
            )
          ) : (
            <LoginPage
              onLogin={(u) => {
                setUser(u);
                setVaultReady(!!getVault());
              }}
            />
          )
        }
      />
      <Route path="/signup" element={user ? <Navigate to="/" replace /> : <SignupPage />} />
      <Route path="/forgot" element={user ? <Navigate to="/" replace /> : <ForgotPage />} />
      <Route path="/reset" element={<ResetPage />} />
      <Route path="/verify" element={<VerifyPage />} />
      <Route
        path="/invite/:token"
        element={
          locked && user ? (
            <UnlockPage user={user} onReady={() => setVaultReady(true)} onLogout={logout} />
          ) : (
            <InvitePage user={user} />
          )
        }
      />
      <Route
        path="/"
        element={
          user ? (
            locked ? (
              <UnlockPage user={user} onReady={() => setVaultReady(true)} onLogout={logout} />
            ) : (
              <ProjectsPage user={user} onLogout={logout} />
            )
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/users"
        element={
          user?.is_admin ? (
            locked ? (
              <UnlockPage user={user} onReady={() => setVaultReady(true)} onLogout={logout} />
            ) : (
              <UsersPage user={user} onLogout={logout} />
            )
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
            locked ? (
              <UnlockPage user={user} onReady={() => setVaultReady(true)} onLogout={logout} />
            ) : (
              <ProjectWorkspace user={user} onLogout={logout} />
            )
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
