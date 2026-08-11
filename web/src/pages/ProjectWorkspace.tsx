import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  api,
  Element,
  ElementLink,
  MODULES,
  ModuleType,
  Project,
  ProjectGrant,
  User,
} from "../api/client";
import PanelCanvas from "../components/PanelCanvas";
import ManuscriptEditor from "../components/ManuscriptEditor";
import RelationshipGraph from "../components/RelationshipGraph";

export default function ProjectWorkspace({
  user,
  onLogout,
}: {
  user: User;
  onLogout: () => Promise<void>;
}) {
  const { projectId = "" } = useParams();
  const [project, setProject] = useState<Project | null>(null);
  const [module, setModule] = useState<ModuleType>("manuscript");
  const [elements, setElements] = useState<Element[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [links, setLinks] = useState<ElementLink[]>([]);
  const [allElements, setAllElements] = useState<Element[]>([]);
  const [grants, setGrants] = useState<ProjectGrant[]>([]);
  const [focus, setFocus] = useState(false);
  const [corkboard, setCorkboard] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [grantUser, setGrantUser] = useState("");
  const [newTitle, setNewTitle] = useState("");

  const selected = useMemo(
    () => elements.find((e) => e.id === selectedId) || null,
    [elements, selectedId]
  );

  const refreshElements = useCallback(async () => {
    const list = await api.elements(projectId, module);
    setElements(list);
    if (list.length && !list.find((e) => e.id === selectedId)) {
      setSelectedId(list[0].id);
    }
    if (!list.length) setSelectedId(null);
  }, [projectId, module, selectedId]);

  useEffect(() => {
    (async () => {
      try {
        setProject(await api.getProject(projectId));
        setLinks(await api.links(projectId));
        setAllElements(await api.elements(projectId));
        setGrants(await api.grants(projectId));
      } catch (e) {
        setError(String(e));
      }
    })();
  }, [projectId]);

  useEffect(() => {
    refreshElements().catch((e) => setError(String(e)));
  }, [module, projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function createElement() {
    const title = newTitle.trim() || `New ${module}`;
    const el = await api.createElement(projectId, {
      module_type: module,
      title,
      metadata: module === "systems" ? { kind: "magic" } : {},
    });
    setNewTitle("");
    await refreshElements();
    setSelectedId(el.id);
    setAllElements(await api.elements(projectId));
  }

  async function download(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className={`app-shell${focus ? " focus-mode" : ""}`}>
      <header className="topbar">
        <Link to="/" className="brand" style={{ textDecoration: "none" }}>
          Tavern
        </Link>
        <span>{project?.title || "…"}</span>
        <div className="spacer" />
        <button onClick={() => setFocus((f) => !f)}>{focus ? "Exit focus" : "Focus"}</button>
        <button
          onClick={async () => {
            const blob = await api.exportProject(projectId, "markdown", "manuscript");
            await download(blob, `${project?.title || "project"}-manuscript.md`);
          }}
        >
          Export MD
        </button>
        <button
          onClick={async () => {
            try {
              const blob = await api.exportProject(projectId, "docx", "manuscript");
              await download(blob, `${project?.title || "project"}.docx`);
            } catch {
              setError("DOCX export needs pandoc on the server");
            }
          }}
        >
          Export DOCX
        </button>
        <button
          onClick={async () => {
            const blob = await api.backupProject(projectId);
            await download(blob, `${project?.title || "project"}.tavern`);
          }}
        >
          Backup
        </button>
        <span className="muted" style={{ color: "#c5cec8" }}>
          {user.username}
        </span>
        <button onClick={() => onLogout()}>Log out</button>
      </header>

      <nav className="module-rail">
        {MODULES.map((m) => (
          <button
            key={m.id}
            className={module === m.id ? "active" : ""}
            onClick={() => {
              setModule(m.id);
              setCorkboard(false);
            }}
          >
            {m.label}
          </button>
        ))}
      </nav>

      <aside className="element-list">
        <header>
          <input
            placeholder="Title"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
          />
          <button className="primary" onClick={createElement}>
            +
          </button>
        </header>
        {module === "manuscript" && (
          <div className="row" style={{ padding: "0.5rem 0.75rem" }}>
            <button className={corkboard ? "primary" : ""} onClick={() => setCorkboard((c) => !c)}>
              Corkboard
            </button>
          </div>
        )}
        <ul>
          {elements.map((el) => (
            <li key={el.id}>
              <button
                className={selectedId === el.id ? "active" : ""}
                onClick={() => setSelectedId(el.id)}
              >
                {el.title}
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <main className="main-canvas">
        {error && <p className="error">{error}</p>}
        {!selected && <p className="muted">Create or select an element.</p>}
        {selected && module === "manuscript" && !corkboard && (
          <ManuscriptEditor
            element={selected}
            allElements={allElements}
            onRenamed={async (title) => {
              await api.updateElement(selected.id, {
                title,
                parent_id: selected.parent_id,
                sort_order: selected.sort_order,
                metadata: selected.metadata,
              });
              await refreshElements();
            }}
          />
        )}
        {selected && module === "manuscript" && corkboard && (
          <div className="corkboard">
            {elements.map((el) => (
              <button
                key={el.id}
                className="cork-card"
                onClick={() => {
                  setSelectedId(el.id);
                  setCorkboard(false);
                }}
              >
                <h4>{el.title}</h4>
                <p>Open chapter</p>
              </button>
            ))}
          </div>
        )}
        {selected && module === "relationship" && (
          <RelationshipGraph
            projectId={projectId}
            elements={allElements.filter((e) => e.module_type === "character")}
            links={links}
            onChange={async () => setLinks(await api.links(projectId))}
          />
        )}
        {selected && module !== "manuscript" && module !== "relationship" && (
          <PanelCanvas
            element={selected}
            canEdit
            onTitle={async (title) => {
              await api.updateElement(selected.id, {
                title,
                parent_id: selected.parent_id,
                sort_order: selected.sort_order,
                metadata: selected.metadata,
              });
              await refreshElements();
            }}
          />
        )}
      </main>

      <aside className="inspector">
        <h3 style={{ marginTop: 0 }}>Inspector</h3>
        {selected && (
          <div className="stack">
            <div>
              <div className="muted">Element</div>
              <strong>{selected.title}</strong>
              <div className="muted">{selected.module_type}</div>
            </div>
            <button
              className="danger"
              onClick={async () => {
                if (!confirm("Delete this element?")) return;
                await api.deleteElement(selected.id);
                await refreshElements();
                setAllElements(await api.elements(projectId));
              }}
            >
              Delete
            </button>
          </div>
        )}
        <hr />
        <h4>Wiki tips</h4>
        <p className="muted" style={{ fontSize: "0.9rem" }}>
          Link with <code>[[Character:Name]]</code> in manuscript text.
        </p>
        <h4>Sharing</h4>
        <ul style={{ paddingLeft: "1.1rem" }}>
          {grants.map((g) => (
            <li key={g.user_id}>
              {g.username || g.user_id} · {g.role}
            </li>
          ))}
        </ul>
        <div className="stack">
          <input
            placeholder="Username to grant"
            value={grantUser}
            onChange={(e) => setGrantUser(e.target.value)}
          />
          <button
            onClick={async () => {
              await api.upsertGrant(projectId, { username: grantUser, role: "editor" });
              setGrantUser("");
              setGrants(await api.grants(projectId));
            }}
          >
            Grant editor
          </button>
        </div>
        <h4 style={{ marginTop: "1rem" }}>Export bible</h4>
        <button
          onClick={async () => {
            const blob = await api.exportProject(projectId, "markdown", "bible");
            await download(blob, `${project?.title || "project"}-bible.md`);
          }}
        >
          World bible MD
        </button>
      </aside>
    </div>
  );
}
