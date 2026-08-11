import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { api, User } from "./api/client";
import LoginPage from "./pages/LoginPage";
import ProjectsPage from "./pages/ProjectsPage";
import ProjectWorkspace from "./pages/ProjectWorkspace";

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
        element={user ? <Navigate to="/" replace /> : <LoginPage onLogin={setUser} />}
      />
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
