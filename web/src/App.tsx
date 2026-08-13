import { useEffect, useState, type ReactNode } from "react";
import { api, User } from "./api/client";
import TipHost from "./components/TipHost";
import { Navigate, usePath } from "./lib/router";
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
  const path = usePath();
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

  let page: ReactNode;
  if (path === "/login") {
    page = user ? (
      locked ? (
        <UnlockPage user={user} onReady={() => setVaultReady(true)} onLogout={logout} />
      ) : (
        <Navigate to={safeNext(window.location.search)} replace />
      )
    ) : (
      <LoginPage
        onLogin={(u) => {
          setUser(u);
          setVaultReady(!!getVault());
        }}
      />
    );
  } else if (path === "/signup") {
    page = user ? <Navigate to="/" replace /> : <SignupPage />;
  } else if (path === "/forgot") {
    page = user ? <Navigate to="/" replace /> : <ForgotPage />;
  } else if (path === "/reset") {
    page = <ResetPage />;
  } else if (path === "/verify") {
    page = <VerifyPage />;
  } else if (path.startsWith("/invite/")) {
    page =
      locked && user ? (
        <UnlockPage user={user} onReady={() => setVaultReady(true)} onLogout={logout} />
      ) : (
        <InvitePage user={user} />
      );
  } else if (path === "/" || path === "") {
    page = user ? (
      locked ? (
        <UnlockPage user={user} onReady={() => setVaultReady(true)} onLogout={logout} />
      ) : (
        <ProjectsPage user={user} onLogout={logout} />
      )
    ) : (
      <Navigate to="/login" replace />
    );
  } else if (path === "/users") {
    page = user?.is_admin ? (
      locked ? (
        <UnlockPage user={user} onReady={() => setVaultReady(true)} onLogout={logout} />
      ) : (
        <UsersPage user={user} onLogout={logout} />
      )
    ) : (
      <Navigate to={user ? "/" : "/login"} replace />
    );
  } else if (path.startsWith("/project/")) {
    page = user ? (
      locked ? (
        <UnlockPage user={user} onReady={() => setVaultReady(true)} onLogout={logout} />
      ) : (
        <ProjectWorkspace user={user} onLogout={logout} />
      )
    ) : (
      <Navigate to="/login" replace />
    );
  } else {
    page = <Navigate to={user ? "/" : "/login"} replace />;
  }

  return (
    <>
      <TipHost />
      {page}
    </>
  );
}
