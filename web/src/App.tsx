import { useEffect, useState, type ReactNode } from "react";
import { api, User } from "./api/client";
import TipHost from "./components/TipHost";
import { Navigate, usePath } from "./lib/router";
import LoginPage from "./pages/LoginPage";
import ProjectsPage from "./pages/ProjectsPage";
import ProjectWorkspace from "./pages/ProjectWorkspace";

export default function App() {
  const path = usePath();
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

  const logout = async () => {
    await api.logout();
    setUser(null);
  };

  let page: ReactNode;
  if (path === "/login") {
    page = user ? <Navigate to="/" replace /> : <LoginPage onLogin={setUser} />;
  } else if (path === "/" || path === "") {
    page = user ? (
      <ProjectsPage user={user} onLogout={logout} />
    ) : (
      <Navigate to="/login" replace />
    );
  } else if (path.startsWith("/project/")) {
    page = user ? (
      <ProjectWorkspace user={user} onLogout={logout} />
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
