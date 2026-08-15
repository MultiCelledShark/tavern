import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  canEditRole,
  canManageRole,
  Element,
  ElementLink,
  ModuleType,
  Project,
  ProjectGrant,
  User,
} from "../api/client";
import PanelCanvas from "../components/PanelCanvas";
import ManuscriptEditor from "../components/ManuscriptEditor";
import RelationshipGraph from "../components/RelationshipGraph";
import MapCanvas from "../components/MapCanvas";
import TimelineView from "../components/TimelineView";
import Corkboard from "../components/Corkboard";
import {
  ChromePanel,
  ChromeState,
  anyDrawerOpen,
  chromeClassNames,
  loadChrome,
  saveChrome,
} from "../lib/chrome";
import {
  loadModuleOrder,
  moveModule,
  orderedModules,
  saveModuleOrder,
} from "../lib/moduleOrder";
import { Link, useNavigate, useProjectId } from "../lib/router";
import { TIPS } from "../tips";
import { getProjectKey } from "../crypto/session";

const MODULE_TIPS: Record<ModuleType, string> = {
  manuscript: TIPS.moduleManuscript,
  character: TIPS.moduleCharacter,
  encyclopedia: TIPS.moduleEncyclopedia,
  relationship: TIPS.moduleRelationship,
  location: TIPS.moduleLocation,
  systems: TIPS.moduleSystems,
  maps: TIPS.moduleMaps,
  timeline: TIPS.moduleTimeline,
  species: TIPS.moduleSpecies,
  cultures: TIPS.moduleCultures,
  items: TIPS.moduleItems,
  arcs: TIPS.moduleArcs,
  languages: TIPS.moduleLanguages,
  religions: TIPS.moduleReligions,
  research: TIPS.moduleResearch,
  philosophies: TIPS.modulePhilosophies,
  calendar: TIPS.moduleCalendar,
};

const COMPACT_MQ = "(max-width: 1100px)";

export default function ProjectWorkspace({
  user,
  onLogout,
}: {
  user: User;
  onLogout: () => Promise<void>;
}) {
  const projectId = useProjectId() || "";
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [module, setModule] = useState<ModuleType>("manuscript");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [links, setLinks] = useState<ElementLink[]>([]);
  const [allElements, setAllElements] = useState<Element[]>([]);
  const [grants, setGrants] = useState<ProjectGrant[]>([]);
  const [corkboard, setCorkboard] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [grantUser, setGrantUser] = useState("");
  const [grantRole, setGrantRole] = useState<"editor" | "viewer">("editor");
  const [newTitle, setNewTitle] = useState("");
  const [chrome, setChrome] = useState<ChromeState>(() => loadChrome());
  const [moduleOrder, setModuleOrder] = useState<ModuleType[]>(() => loadModuleOrder());
  const [draggingModule, setDraggingModule] = useState<ModuleType | null>(null);
  const [overModule, setOverModule] = useState<ModuleType | null>(null);
  const dragModuleRef = useRef<ModuleType | null>(null);
  const moduleDidDragRef = useRef(false);
  const [compact, setCompact] = useState(
    () => typeof window !== "undefined" && window.matchMedia(COMPACT_MQ).matches
  );
  const focusSnapshot = useRef<ChromeState | null>(null);
  const topbarRef = useRef<HTMLElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);

  const elements = useMemo(
    () => allElements.filter((e) => e.module_type === module),
    [allElements, module]
  );
  const modules = useMemo(() => orderedModules(moduleOrder), [moduleOrder]);

  const selected = useMemo(
    () => elements.find((e) => e.id === selectedId) || null,
    [elements, selectedId]
  );

  const locations = useMemo(
    () => allElements.filter((e) => e.module_type === "location"),
    [allElements]
  );

  const focused =
    !chrome.modules && !chrome.list && !chrome.inspector;

  useEffect(() => {
    saveChrome(chrome);
  }, [chrome]);

  useEffect(() => {
    saveModuleOrder(moduleOrder);
  }, [moduleOrder]);

  function applyModuleMove(fromId: ModuleType, toId: ModuleType) {
    setModuleOrder((prev) => moveModule(prev, fromId, toId));
  }

  useEffect(() => {
    const mq = window.matchMedia(COMPACT_MQ);
    const apply = () => setCompact(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    const topbar = topbarRef.current;
    const shell = shellRef.current;
    if (!topbar || !shell) return;

    const syncSheetTop = () => {
      const bottom = topbar.getBoundingClientRect().bottom;
      shell.style.setProperty("--chrome-sheet-top", `${Math.ceil(bottom + 8)}px`);
    };

    syncSheetTop();
    const ro = new ResizeObserver(syncSheetTop);
    ro.observe(topbar);
    window.addEventListener("resize", syncSheetTop);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", syncSheetTop);
    };
  }, [compact, chrome.tools]);

  const setPanel = useCallback((panel: ChromePanel, open: boolean) => {
    setChrome((prev) => {
      // On compact layouts, keep drawers mutually exclusive for room to work.
      if (open && (panel === "modules" || panel === "list" || panel === "inspector")) {
        const next = { ...prev, modules: false, list: false, inspector: false, [panel]: true };
        if (!window.matchMedia(COMPACT_MQ).matches) {
          return { ...prev, [panel]: true };
        }
        return next;
      }
      return { ...prev, [panel]: open };
    });
    if (open) focusSnapshot.current = null;
  }, []);

  const togglePanel = useCallback(
    (panel: ChromePanel) => {
      setChrome((prev) => {
        const open = !prev[panel];
        if (open && (panel === "modules" || panel === "list" || panel === "inspector")) {
          if (window.matchMedia(COMPACT_MQ).matches) {
            return { ...prev, modules: false, list: false, inspector: false, [panel]: true };
          }
        }
        return { ...prev, [panel]: open };
      });
      focusSnapshot.current = null;
    },
    []
  );

  const closeDrawers = useCallback(() => {
    setChrome((prev) => ({ ...prev, modules: false, list: false, inspector: false }));
  }, []);

  const toggleFocus = useCallback(() => {
    setChrome((prev) => {
      const allClosed = !prev.modules && !prev.list && !prev.inspector;
      if (allClosed) {
        const restore = focusSnapshot.current || {
          ...prev,
          modules: true,
          list: true,
          inspector: !window.matchMedia(COMPACT_MQ).matches,
        };
        focusSnapshot.current = null;
        return { ...restore, tools: prev.tools };
      }
      focusSnapshot.current = prev;
      return { ...prev, modules: false, list: false, inspector: false };
    });
  }, []);

  const refreshElements = useCallback(async () => {
    setAllElements(await api.elements(projectId));
  }, [projectId]);

  useEffect(() => {
    (async () => {
      try {
        const [p, l, els, g] = await Promise.all([
          api.getProject(projectId),
          api.links(projectId),
          api.elements(projectId),
          api.grants(projectId),
        ]);
        setProject(p);
        setLinks(l);
        setAllElements(els);
        setGrants(g);
      } catch (e) {
        setError(String(e));
      }
    })();
  }, [projectId]);

  useEffect(() => {
    if (!elements.length) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !elements.some((e) => e.id === selectedId)) {
      setSelectedId(elements[0].id);
    }
  }, [elements, selectedId]);

  useEffect(() => {
    // Leaving/entering a module: refresh the active list and the project-wide
    // catalog used by manuscript quick links, maps, and relationship graph.
    refreshElements().catch((e) => setError(String(e)));
  }, [module, projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function createElement() {
    const title =
      newTitle.trim() ||
      (module === "timeline" ? "New event" : module === "maps" ? "New map" : `New ${module}`);
    const metadata =
      module === "systems"
        ? { kind: "magic" }
        : module === "timeline"
          ? { date: "", date_label: "" }
          : module === "maps"
            ? { background_url: "", pins: [] }
            : {};
    const el = await api.createElement(projectId, {
      module_type: module,
      title,
      metadata,
    });
    setNewTitle("");
    setAllElements((prev) => [...prev, el]);
    setSelectedId(el.id);
    await refreshElements();
    if (compact) setPanel("list", false);
  }

  async function download(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  const canEdit = canEditRole(project?.my_role);
  const canManage = canManageRole(project?.my_role);

  const createLabel =
    module === "timeline" ? "Event" : module === "maps" ? "Map" : "Title";

  const shellClass = [
    "app-shell",
    chromeClassNames(chrome),
    compact ? "is-compact" : "is-wide",
    focused ? "focus-mode" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={shellClass} ref={shellRef}>
      <header className="topbar" ref={topbarRef}>
        <Link to="/" className="brand" style={{ textDecoration: "none" }} data-tip={TIPS.brand}>
          Tavern
        </Link>
        <span className="topbar-title">{project?.title || "…"}</span>
        <div className="spacer" />

        <div className="chrome-toggles" role="toolbar" aria-label="Layout panels">
          <button
            type="button"
            className={chrome.modules ? "primary" : ""}
            aria-pressed={chrome.modules}
            data-tip={TIPS.chromeModules}
            onClick={() => togglePanel("modules")}
          >
            Modules
          </button>
          <button
            type="button"
            className={chrome.list ? "primary" : ""}
            aria-pressed={chrome.list}
            data-tip={TIPS.chromeList}
            onClick={() => togglePanel("list")}
          >
            Items
          </button>
          <button
            type="button"
            className={chrome.inspector ? "primary" : ""}
            aria-pressed={chrome.inspector}
            data-tip={TIPS.chromeInspector}
            onClick={() => togglePanel("inspector")}
          >
            Inspector
          </button>
          <button
            type="button"
            className={chrome.tools ? "primary" : ""}
            aria-pressed={chrome.tools}
            data-tip={TIPS.chromeTools}
            onClick={() => togglePanel("tools")}
          >
            Tools
          </button>
          <button type="button" data-tip={TIPS.focus} onClick={toggleFocus}>
            {focused ? "Exit focus" : "Focus"}
          </button>
        </div>

        <div className="topbar-tools">
          {canEdit && (
            <>
              <button
                type="button"
                data-tip={TIPS.exportMd}
                onClick={async () => {
                  const blob = await api.exportProject(projectId, "markdown", "manuscript");
                  await download(blob, `${project?.title || "project"}-manuscript.md`);
                }}
              >
                Export MD
              </button>
              <button
                type="button"
                data-tip={TIPS.exportDocx}
                onClick={async () => {
                  try {
                    const encrypted = !!getProjectKey(projectId);
                    const blob = await api.exportProject(
                      projectId,
                      encrypted ? "markdown" : "docx",
                      "manuscript"
                    );
                    await download(
                      blob,
                      `${project?.title || "project"}${encrypted ? "-manuscript.md" : ".docx"}`
                    );
                    if (encrypted) {
                      setError("Encrypted projects export markdown only — the server cannot decrypt for pandoc.");
                    }
                  } catch {
                    setError("DOCX export needs pandoc on the server");
                  }
                }}
              >
                Export DOCX
              </button>
              <button
                type="button"
                data-tip={TIPS.backup}
                onClick={async () => {
                  const { blob, filename } = await api.backupProject(projectId);
                  await download(blob, filename);
                }}
              >
                Backup
              </button>
            </>
          )}
          <span className="muted topbar-user" style={{ color: "#c5cec8" }}>
            {user.username}
          </span>
          <button type="button" data-tip={TIPS.logout} onClick={() => onLogout()}>
            Log out
          </button>
        </div>
      </header>

      {compact && anyDrawerOpen(chrome) && (
        <button
          type="button"
          className="chrome-backdrop"
          aria-label="Close panels"
          onClick={closeDrawers}
        />
      )}

      <nav className="module-rail" aria-hidden={!chrome.modules}>
        <div className="panel-chrome-head">
          <strong>Modules</strong>
          <button
            type="button"
            className="ghost"
            data-tip={TIPS.collapsePanel}
            onClick={() => setPanel("modules", false)}
          >
            Hide
          </button>
        </div>
        {modules.map((m) => (
          <button
            key={m.id}
            type="button"
            draggable
            className={[
              "module-rail-item",
              "tip-right",
              module === m.id ? "active" : "",
              draggingModule === m.id ? "dragging" : "",
              overModule === m.id && draggingModule && draggingModule !== m.id
                ? "drop-target"
                : "",
            ]
              .filter(Boolean)
              .join(" ")}
            data-tip={`${MODULE_TIPS[m.id]} — ${TIPS.moduleDrag}`}
            onDragStart={(e) => {
              moduleDidDragRef.current = false;
              dragModuleRef.current = m.id;
              setDraggingModule(m.id);
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", m.id);
            }}
            onDragEnd={() => {
              dragModuleRef.current = null;
              setDraggingModule(null);
              setOverModule(null);
              // click fires after dragend in some browsers — keep the flag briefly
              window.setTimeout(() => {
                moduleDidDragRef.current = false;
              }, 0);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (dragModuleRef.current && dragModuleRef.current !== m.id) {
                moduleDidDragRef.current = true;
                setOverModule((cur) => (cur === m.id ? cur : m.id));
              }
            }}
            onDragLeave={() => {
              setOverModule((id) => (id === m.id ? null : id));
            }}
            onDrop={(e) => {
              e.preventDefault();
              moduleDidDragRef.current = true;
              const fromId = (e.dataTransfer.getData("text/plain") ||
                dragModuleRef.current) as ModuleType | null;
              setOverModule(null);
              setDraggingModule(null);
              dragModuleRef.current = null;
              if (!fromId) return;
              applyModuleMove(fromId, m.id);
            }}
            onClick={() => {
              if (moduleDidDragRef.current) {
                moduleDidDragRef.current = false;
                return;
              }
              setModule(m.id);
              setCorkboard(false);
              if (compact) {
                setChrome((prev) => ({
                  ...prev,
                  modules: false,
                  list: true,
                  inspector: false,
                }));
                focusSnapshot.current = null;
              }
            }}
          >
            <span className="module-drag-handle" aria-hidden="true">
              ⠿
            </span>
            <span className="module-label">{m.label}</span>
          </button>
        ))}
      </nav>

      <aside className="element-list" aria-hidden={!chrome.list}>
        <div className="panel-chrome-head">
          <strong>Items</strong>
          <button
            type="button"
            className="ghost"
            data-tip={TIPS.collapsePanel}
            onClick={() => setPanel("list", false)}
          >
            Hide
          </button>
        </div>
        {canEdit && (
          <header>
            <input
              placeholder={createLabel}
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              data-tip={TIPS.newElement}
            />
            <button className="primary" type="button" data-tip={TIPS.newElement} onClick={createElement}>
              +
            </button>
          </header>
        )}
        {module === "manuscript" && (
          <div className="row" style={{ padding: "0.5rem 0.75rem" }}>
            <button
              type="button"
              className={corkboard ? "primary" : ""}
              data-tip={TIPS.corkboard}
              onClick={() => setCorkboard((c) => !c)}
            >
              Corkboard
            </button>
          </div>
        )}
        {module === "relationship" && (
          <p className="muted" style={{ padding: "0.5rem 0.75rem", margin: 0, fontSize: "0.9rem" }}>
            Graph uses Characters. Optional relationship notes live in the list.
          </p>
        )}
        <ul>
          {elements.map((el) => (
            <li key={el.id}>
              <button
                type="button"
                className={selectedId === el.id ? "active" : ""}
                data-tip={`Open “${el.title}” in the canvas`}
                onClick={() => {
                  setSelectedId(el.id);
                  if (compact) setPanel("list", false);
                }}
              >
                {el.title}
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <main className="main-canvas">
        {error && <p className="error">{error}</p>}

        {module === "relationship" && (
          <RelationshipGraph
            projectId={projectId}
            elements={allElements.filter((e) => e.module_type === "character")}
            links={links}
            canEdit={canEdit}
            onChange={async () => setLinks(await api.links(projectId))}
          />
        )}

        {module === "maps" && selected && (
          <MapCanvas
            projectId={projectId}
            element={selected}
            locations={locations}
            canEdit={canEdit}
            onSaved={async () => {
              await refreshElements();
            }}
          />
        )}
        {module === "maps" && !selected && (
          <p className="muted">Create or select a map.</p>
        )}

        {module === "timeline" && (
          <TimelineView
            projectId={projectId}
            elements={elements}
            selectedId={selectedId}
            onSelect={(id) => {
              setSelectedId(id);
              if (compact) setPanel("list", false);
            }}
            canEdit={canEdit}
            onChanged={async () => {
              await refreshElements();
            }}
          />
        )}

        {module === "manuscript" && !selected && !corkboard && (
          <p className="muted">Create or select an element.</p>
        )}
        {selected && module === "manuscript" && !corkboard && (
          <ManuscriptEditor
            element={selected}
            allElements={allElements}
            canEdit={canEdit}
            focusMode={focused}
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
        {module === "manuscript" && corkboard && (
          <Corkboard
            elements={elements}
            canEdit={canEdit}
            onOpen={(id) => {
              setSelectedId(id);
              setCorkboard(false);
            }}
            onChanged={async () => {
              await refreshElements();
            }}
          />
        )}

        {selected &&
          module !== "manuscript" &&
          module !== "relationship" &&
          module !== "maps" &&
          module !== "timeline" && (
            <PanelCanvas
              projectId={projectId}
              element={selected}
              canEdit={canEdit}
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
        {!selected &&
          module !== "manuscript" &&
          module !== "relationship" &&
          module !== "maps" &&
          module !== "timeline" && (
            <p className="muted">Create or select an element.</p>
          )}
      </main>

      <aside className="inspector" data-tip={TIPS.inspector} aria-hidden={!chrome.inspector}>
        <div className="panel-chrome-head">
          <h3 style={{ margin: 0 }}>Inspector</h3>
          <button
            type="button"
            className="ghost"
            data-tip={TIPS.collapsePanel}
            onClick={() => setPanel("inspector", false)}
          >
            Hide
          </button>
        </div>
        {selected && (
          <div className="stack">
            <div>
              <div className="muted">Element</div>
              <strong>{selected.title}</strong>
              <div className="muted">{selected.module_type}</div>
            </div>
            {canEdit && (
              <button
                type="button"
                className="danger"
                data-tip={TIPS.deleteElement}
                onClick={async () => {
                  if (!confirm("Delete this element?")) return;
                  await api.deleteElement(selected.id);
                  await refreshElements();
                }}
              >
                Delete
              </button>
            )}
          </div>
        )}
        <hr />
        <h4 data-tip={TIPS.wikiTip}>Wiki tips</h4>
        <p className="muted" style={{ fontSize: "0.9rem" }}>
          Link with <code>[[Character:Name]]</code> in manuscript text.
        </p>
        <h4>Sharing</h4>
        <p className="muted" style={{ fontSize: "0.85rem" }}>
          Your access: {project?.my_role || "…"}
        </p>
        <ul style={{ paddingLeft: "1.1rem" }}>
          {grants.map((g) => (
            <li key={g.user_id}>
              {g.username || g.user_id} · {g.role}{" "}
              {canManage && g.user_id !== user.id && (
                <button
                  type="button"
                  className="ghost"
                  style={{ padding: "0.1rem 0.35rem" }}
                  data-tip="Revoke this user's project access"
                  onClick={async () => {
                    await api.deleteGrant(projectId, g.user_id);
                    setGrants(await api.grants(projectId));
                  }}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
        {canManage && (
          <div className="stack">
            <input
              placeholder="Username to grant"
              value={grantUser}
              onChange={(e) => setGrantUser(e.target.value)}
              data-tip={TIPS.grant}
            />
            <select
              value={grantRole}
              onChange={(e) => setGrantRole(e.target.value as "editor" | "viewer")}
              data-tip={TIPS.grantRole}
            >
              <option value="editor">Editor</option>
              <option value="viewer">Viewer</option>
            </select>
            <button
              type="button"
              data-tip={TIPS.grant}
              onClick={async () => {
                setError(null);
                try {
                  await api.upsertGrant(projectId, {
                    username: grantUser.trim(),
                    role: grantRole,
                  });
                  setGrantUser("");
                  setGrants(await api.grants(projectId));
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Grant failed");
                }
              }}
            >
              Grant access
            </button>
            <p className="muted" style={{ fontSize: "0.8rem" }}>
              They’ll get access if the username exists. Encrypted projects also wrap the project
              key — they need to have signed in once (vault ready), or grant again after they do.
            </p>
            <button
              type="button"
              data-tip={TIPS.inviteLink}
              onClick={async () => {
                const res = await api.createInvite(projectId, grantRole);
                const url = `${window.location.origin}/invite/${res.token}`;
                try {
                  await navigator.clipboard.writeText(url);
                } catch {
                  /* ignore */
                }
                window.prompt("Invite link (7 days, single use)", url);
              }}
            >
              Copy invite link
            </button>
          </div>
        )}
        {!canManage && project && (
          <button
            type="button"
            data-tip={TIPS.leaveProject}
            onClick={async () => {
              if (!confirm("Leave this project? You will lose access until invited again.")) return;
              await api.deleteGrant(projectId, user.id);
              navigate("/");
            }}
          >
            Leave project
          </button>
        )}
        {canEdit && (
          <>
            <h4 style={{ marginTop: "1rem" }}>Export bible</h4>
            <button
              type="button"
              data-tip={TIPS.bible}
              onClick={async () => {
                const blob = await api.exportProject(projectId, "markdown", "bible");
                await download(blob, `${project?.title || "project"}-bible.md`);
              }}
            >
              World bible MD
            </button>
          </>
        )}
      </aside>
    </div>
  );
}
