import { FormEvent, useEffect, useState } from "react";
import { api, Project, User } from "../api/client";
import { Link, useNavigate } from "../lib/router";
import { TIPS } from "../tips";

export default function ProjectsPage({
  user,
  onLogout,
}: {
  user: User;
  onLogout: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [importNote, setImportNote] = useState<string | null>(null);
  const [busyTutorial, setBusyTutorial] = useState(false);

  async function refresh() {
    setProjects(await api.projects());
  }

  useEffect(() => {
    refresh().catch((e) => setError(String(e)));
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    await api.createProject(title.trim());
    setTitle("");
    await refresh();
  }

  async function onImport(file: File | null) {
    if (!file) return;
    setImportNote(null);
    try {
      const res = await api.importProject(file);
      setImportNote(
        `Imported “${res.project.title}”. Notes: ${res.report.notes.join(" ")}`
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    }
  }

  async function loadTutorial() {
    setBusyTutorial(true);
    setError(null);
    try {
      const res = await api.createTutorial();
      setImportNote(
        `Loaded “${res.project.title}”. Open Encyclopedia → Welcome — start here.`
      );
      await refresh();
      navigate(`/project/${res.project.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load tutorial");
    } finally {
      setBusyTutorial(false);
    }
  }

  return (
    <div>
      <header className="topbar">
        <div className="brand" data-tip={TIPS.brand}>
          Tavern
        </div>
        <span className="muted" style={{ color: "#c5cec8" }}>
          {user.username}
          {user.is_admin ? " · admin" : ""}
        </span>
        <div className="spacer" />
        <button type="button" data-tip={TIPS.logout} onClick={() => onLogout()}>
          Log out
        </button>
      </header>
      <div className="projects-page">
        <h1>Your projects</h1>
        <p className="muted">
          Manuscripts, characters, lore, and systems — linked together. Hover any control for a
          short tip.
        </p>

        <form className="row" onSubmit={create} style={{ marginTop: "1.25rem" }}>
          <input
            placeholder="New project title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            data-tip={TIPS.createProject}
          />
          <button className="primary" type="submit" data-tip={TIPS.createProject}>
            Create
          </button>
          <button
            type="button"
            data-tip={TIPS.tutorial}
            disabled={busyTutorial}
            onClick={loadTutorial}
          >
            {busyTutorial ? "Loading tour…" : "Load tutorial project"}
          </button>
        </form>

        <div className="row" style={{ marginTop: "0.85rem" }}>
          <label className="muted" data-tip={TIPS.importProject}>
            Import Campfire / `.tavern` / JSON{" "}
            <input
              type="file"
              accept=".json,.zip,.tavern,.camp,.html,*"
              onChange={(e) => onImport(e.target.files?.[0] || null)}
            />
          </label>
        </div>
        {importNote && <p>{importNote}</p>}
        {error && <p className="error">{error}</p>}

        {projects.length === 0 && (
          <p className="muted" style={{ marginTop: "1.5rem" }}>
            No projects yet — create one, or{" "}
            <button type="button" className="primary" data-tip={TIPS.tutorial} onClick={loadTutorial}>
              start the guided tour
            </button>
            .
          </p>
        )}

        <div className="project-grid">
          {projects.map((p) => (
            <div key={p.id} className="project-card">
              <Link to={`/project/${p.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                <h3 style={{ margin: "0 0 0.35rem" }}>{p.title}</h3>
                <p className="muted" style={{ margin: 0 }}>
                  {p.synopsis || "No synopsis yet"}
                </p>
              </Link>
              <div className="row" style={{ marginTop: "0.75rem" }}>
                <Link to={`/project/${p.id}`}>
                  <button type="button" className="primary" data-tip={TIPS.openProject}>
                    Open
                  </button>
                </Link>
                <button
                  type="button"
                  className="danger"
                  data-tip={TIPS.deleteProject}
                  onClick={async () => {
                    if (!confirm(`Delete project “${p.title}”?`)) return;
                    await api.deleteProject(p.id);
                    await refresh();
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
