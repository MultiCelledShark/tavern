import { useEffect, useMemo, useRef, useState } from "react";
import { api, Element, Page, Panel } from "../api/client";
import AssetImg from "./AssetImg";
import { TIPS } from "../tips";
import ImageLightbox from "./ImageLightbox";
import PanelGrid, { type GridItem } from "./PanelGrid";

const PANEL_TYPES = [
  "attributes",
  "text",
  "list",
  "stats",
  "image",
  "table",
  "links",
] as const;

/** Minimum grid units so panels fit their primary inputs (rowHeight ≈ 36px). */
const PANEL_MIN: Record<string, { minW: number; minH: number }> = {
  text: { minW: 4, minH: 6 },
  attributes: { minW: 4, minH: 4 },
  stats: { minW: 4, minH: 4 },
  list: { minW: 4, minH: 4 },
  table: { minW: 4, minH: 5 },
  image: { minW: 3, minH: 5 },
  links: { minW: 3, minH: 4 },
};

type ImageRef = { url: string; caption?: string };

export default function PanelCanvas({
  projectId,
  element,
  canEdit,
  onTitle,
}: {
  projectId: string;
  element: Element;
  canEdit: boolean;
  onTitle: (title: string) => Promise<void>;
}) {
  const [pages, setPages] = useState<Page[]>([]);
  const [pageId, setPageId] = useState<string | null>(null);
  const [panels, setPanels] = useState<Panel[]>([]);
  const [title, setTitle] = useState(element.title);
  const [width, setWidth] = useState(900);
  const canvasRef = useRef<HTMLDivElement>(null);
  const panelsRef = useRef(panels);
  panelsRef.current = panels;
  const creatingPageRef = useRef(false);

  useEffect(() => {
    setTitle(element.title);
    let cancelled = false;
    creatingPageRef.current = false;
    (async () => {
      let list = await api.pages(element.id);
      if (cancelled) return;
      if (!list.length && canEdit) {
        if (creatingPageRef.current) return;
        creatingPageRef.current = true;
        try {
          await api.createPage(element.id, "Overview");
          list = await api.pages(element.id);
        } finally {
          creatingPageRef.current = false;
        }
      }
      if (cancelled) return;
      setPages(list);
      setPageId(list[0]?.id || null);
    })();
    return () => {
      cancelled = true;
    };
  }, [element.id, canEdit]);

  useEffect(() => {
    if (!pageId) return;
    let cancelled = false;
    api.panels(pageId).then((list) => {
      if (!cancelled) setPanels(list);
    });
    return () => {
      cancelled = true;
    };
  }, [pageId]);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const apply = () => setWidth(Math.max(320, Math.floor(el.clientWidth)));
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const layout: GridItem[] = useMemo(
    () =>
      panels.map((p) => {
        const mins = PANEL_MIN[p.panel_type] || { minW: 3, minH: 4 };
        return {
          i: p.id,
          x: Math.round(p.layout.x),
          y: Math.round(p.layout.y),
          w: Math.max(mins.minW, Math.round(p.layout.w)),
          h: Math.max(mins.minH, Math.round(p.layout.h)),
          minW: mins.minW,
          minH: mins.minH,
        };
      }),
    [panels]
  );

  async function persistLayout(next: GridItem[]) {
    const byId = new Map(next.map((item) => [item.i, item]));
    const snapshot = panelsRef.current;
    setPanels((all) =>
      all.map((p) => {
        const item = byId.get(p.id);
        if (!item) return p;
        return {
          ...p,
          layout: { x: item.x, y: item.y, w: item.w, h: item.h },
        };
      })
    );
    for (const panel of snapshot) {
      const item = byId.get(panel.id);
      if (!item) continue;
      const same =
        panel.layout.x === item.x &&
        panel.layout.y === item.y &&
        panel.layout.w === item.w &&
        panel.layout.h === item.h;
      if (same) continue;
      await api.updatePanel(panel.id, {
        title: panel.title,
        border_color: panel.border_color,
        layout: { x: item.x, y: item.y, w: item.w, h: item.h },
        content: panel.content,
        sort_order: panel.sort_order,
      });
    }
  }

  async function persistPanel(panel: Panel, patch: Partial<Panel>) {
    const next = { ...panel, ...patch };
    const saved = await api.updatePanel(panel.id, {
      title: next.title,
      border_color: next.border_color,
      layout: next.layout,
      content: next.content,
      sort_order: next.sort_order,
    });
    setPanels((all) => all.map((p) => (p.id === saved.id ? saved : p)));
  }

  return (
    <div>
      <div className="row" style={{ marginBottom: "0.85rem", flexWrap: "wrap" }}>
        <input
          value={title}
          readOnly={!canEdit}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            if (canEdit && title !== element.title) onTitle(title);
          }}
          style={{ fontFamily: "var(--font-display)", fontSize: "1.4rem", fontWeight: 700 }}
          data-tip={TIPS.elementTitle}
        />
        <select
          value={pageId || ""}
          onChange={(e) => setPageId(e.target.value)}
          style={{ maxWidth: 180 }}
          data-tip={TIPS.pageSelect}
        >
          {pages.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
        {canEdit && pageId && (
          <>
            <select
              defaultValue=""
              data-tip={TIPS.addPanel}
              onChange={async (e) => {
                const panel_type = e.target.value;
                e.target.value = "";
                if (!panel_type || !pageId) return;
                const created = await api.createPanel(pageId, {
                  panel_type,
                  title: panel_type,
                  sort_order: panels.length,
                  content: defaultContent(panel_type),
                });
                setPanels((p) => [...p, created]);
              }}
            >
              <option value="">Add panel…</option>
              {PANEL_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <button
              type="button"
              data-tip={TIPS.addPage}
              onClick={async () => {
                const page = await api.createPage(element.id, `Page ${pages.length + 1}`);
                const list = await api.pages(element.id);
                setPages(list);
                setPageId(page.id);
              }}
            >
              + Page
            </button>
          </>
        )}
      </div>

      <div className="panel-canvas" ref={canvasRef}>
        <PanelGrid
          layout={layout}
          cols={12}
          rowHeight={36}
          width={width}
          draggableHandle=".drag-handle"
          editable={canEdit}
          onDragStop={(l) => {
            void persistLayout(l);
          }}
          onResizeStop={(l) => {
            void persistLayout(l);
          }}
        >
          {panels.map((panel) => (
            <div
              key={panel.id}
              className="panel-card"
              style={{ borderColor: panel.border_color || undefined }}
            >
              <div className="panel-header">
                <span className="drag-handle" data-tip={TIPS.panelDrag}>
                  ⠿
                </span>
                <textarea
                  className="panel-title"
                  value={panel.title}
                  readOnly={!canEdit}
                  rows={1}
                  wrap="soft"
                  onChange={(e) => {
                    const next = e.target.value.replace(/\n/g, " ");
                    setPanels((all) =>
                      all.map((p) => (p.id === panel.id ? { ...p, title: next } : p))
                    );
                    e.target.style.height = "auto";
                    e.target.style.height = `${Math.max(e.target.scrollHeight, 22)}px`;
                  }}
                  onBlur={(e) => {
                    if (!canEdit) return;
                    void persistPanel(panel, {
                      title: e.target.value.replace(/\n/g, " "),
                    });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      (e.target as HTMLTextAreaElement).blur();
                    }
                  }}
                  ref={(node) => {
                    if (node) {
                      node.style.height = "auto";
                      node.style.height = `${Math.max(node.scrollHeight, 22)}px`;
                    }
                  }}
                  data-tip={TIPS.panelTitle}
                />
                <div className="spacer" />
                {canEdit && (
                  <button
                    className="ghost"
                    type="button"
                    data-tip={TIPS.deletePanel}
                    onClick={async () => {
                      await api.deletePanel(panel.id);
                      setPanels((all) => all.filter((p) => p.id !== panel.id));
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
              <div className="panel-body">
                <PanelEditor
                  projectId={projectId}
                  panel={panel}
                  canEdit={canEdit}
                  onChange={(content) =>
                    setPanels((all) =>
                      all.map((p) => (p.id === panel.id ? { ...p, content } : p))
                    )
                  }
                  commit={(content) => {
                    setPanels((all) =>
                      all.map((p) => (p.id === panel.id ? { ...p, content } : p))
                    );
                    const latest = panelsRef.current.find((p) => p.id === panel.id) || panel;
                    return persistPanel(latest, { content });
                  }}
                />
              </div>
            </div>
          ))}
        </PanelGrid>
      </div>
    </div>
  );
}

function defaultContent(type: string): Record<string, unknown> {
  switch (type) {
    case "attributes":
    case "stats":
      return { items: [{ key: "", value: "" }] };
    case "list":
      return { items: [""] };
    case "text":
      return { markdown: "" };
    case "image":
      return { images: [] };
    case "table":
      return { headers: ["A", "B"], rows: [["", ""]] };
    case "links":
      return { element_ids: [] };
    default:
      return {};
  }
}

function PanelEditor({
  projectId,
  panel,
  canEdit,
  onChange,
  commit,
}: {
  projectId: string;
  panel: Panel;
  canEdit: boolean;
  onChange: (c: Record<string, unknown>) => void;
  commit: (c: Record<string, unknown>) => void | Promise<void>;
}) {
  const content = panel.content;
  const draftRef = useRef(content);
  draftRef.current = content;

  function setDraft(next: Record<string, unknown>) {
    draftRef.current = next;
    onChange(next);
  }

  function commitDraft() {
    return commit(draftRef.current);
  }

  if (panel.panel_type === "text") {
    return (
      <textarea
        value={String(content.markdown || "")}
        onChange={(e) => setDraft({ ...draftRef.current, markdown: e.target.value })}
        onBlur={() => void commitDraft()}
        placeholder="Write markdown…"
        disabled={!canEdit}
        data-tip={TIPS.panelText}
      />
    );
  }

  if (panel.panel_type === "attributes" || panel.panel_type === "stats") {
    const items = (content.items as { key: string; value: string }[]) || [];
    return (
      <div>
        {items.map((item, i) => (
          <div className="attr-row" key={i}>
            <input
              placeholder="Key"
              value={item.key}
              disabled={!canEdit}
              onChange={(e) => {
                const cur = (draftRef.current.items as { key: string; value: string }[]) || items;
                const next = cur.slice();
                next[i] = { ...next[i], key: e.target.value };
                setDraft({ ...draftRef.current, items: next });
              }}
              onBlur={() => void commitDraft()}
            />
            <input
              placeholder="Value"
              value={item.value}
              disabled={!canEdit}
              onChange={(e) => {
                const cur = (draftRef.current.items as { key: string; value: string }[]) || items;
                const next = cur.slice();
                next[i] = { ...next[i], value: e.target.value };
                setDraft({ ...draftRef.current, items: next });
              }}
              onBlur={() => void commitDraft()}
            />
            {canEdit && (
              <button
                type="button"
                onClick={() => {
                  const cur = (draftRef.current.items as { key: string; value: string }[]) || items;
                  const next = { ...draftRef.current, items: cur.filter((_, j) => j !== i) };
                  draftRef.current = next;
                  void commit(next);
                }}
              >
                ×
              </button>
            )}
          </div>
        ))}
        {canEdit && (
          <button
            type="button"
            data-tip={TIPS.addAttrRow}
            onClick={() => {
              const cur = (draftRef.current.items as { key: string; value: string }[]) || items;
              const next = {
                ...draftRef.current,
                items: [...cur, { key: "", value: "" }],
              };
              draftRef.current = next;
              void commit(next);
            }}
          >
            Add row
          </button>
        )}
      </div>
    );
  }

  if (panel.panel_type === "list") {
    const items = (content.items as string[]) || [];
    return (
      <div>
        {items.map((item, i) => (
          <div className="list-row" key={i}>
            <input
              value={item}
              disabled={!canEdit}
              onChange={(e) => {
                const cur = (draftRef.current.items as string[]) || items;
                const next = cur.slice();
                next[i] = e.target.value;
                setDraft({ ...draftRef.current, items: next });
              }}
              onBlur={() => void commitDraft()}
              style={{ gridColumn: "1 / 3" }}
            />
            {canEdit && (
              <button
                type="button"
                onClick={() => {
                  const cur = (draftRef.current.items as string[]) || items;
                  const next = { ...draftRef.current, items: cur.filter((_, j) => j !== i) };
                  draftRef.current = next;
                  void commit(next);
                }}
              >
                ×
              </button>
            )}
          </div>
        ))}
        {canEdit && (
          <button
            type="button"
            data-tip={TIPS.addListItem}
            onClick={() => {
              const cur = (draftRef.current.items as string[]) || items;
              const next = { ...draftRef.current, items: [...cur, ""] };
              draftRef.current = next;
              void commit(next);
            }}
          >
            Add item
          </button>
        )}
      </div>
    );
  }

  if (panel.panel_type === "table") {
    const headers = (content.headers as string[]) || [];
    const rows = (content.rows as string[][]) || [];
    return (
      <div className="stack">
        <div className="row">
          {headers.map((h, i) => (
            <input
              key={i}
              value={h}
              disabled={!canEdit}
              onChange={(e) => {
                const cur = (draftRef.current.headers as string[]) || headers;
                const next = cur.slice();
                next[i] = e.target.value;
                setDraft({ ...draftRef.current, headers: next });
              }}
              onBlur={() => void commitDraft()}
            />
          ))}
        </div>
        {rows.map((row, ri) => (
          <div className="row" key={ri}>
            {row.map((cell, ci) => (
              <input
                key={ci}
                value={cell}
                disabled={!canEdit}
                onChange={(e) => {
                  const cur = ((draftRef.current.rows as string[][]) || rows).map((r) => r.slice());
                  cur[ri][ci] = e.target.value;
                  setDraft({ ...draftRef.current, rows: cur });
                }}
                onBlur={() => void commitDraft()}
              />
            ))}
          </div>
        ))}
        {canEdit && (
          <button
            type="button"
            data-tip={TIPS.addTableRow}
            onClick={() => {
              const hdrs = (draftRef.current.headers as string[]) || headers;
              const cur = (draftRef.current.rows as string[][]) || rows;
              const next = {
                ...draftRef.current,
                rows: [...cur, hdrs.map(() => "")],
              };
              draftRef.current = next;
              void commit(next);
            }}
          >
            Add row
          </button>
        )}
      </div>
    );
  }

  if (panel.panel_type === "image") {
    return (
      <ImagePanelEditor
        projectId={projectId}
        content={content}
        canEdit={canEdit}
        onChange={onChange}
        commit={commit}
      />
    );
  }

  if (panel.panel_type === "links") {
    return (
      <textarea
        value={(content.element_ids as string[] | undefined)?.join("\n") || ""}
        disabled={!canEdit}
        data-tip={TIPS.panelLinks}
        onChange={(e) =>
          setDraft({
            ...draftRef.current,
            element_ids: e.target.value
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean),
          })
        }
        onBlur={() => void commitDraft()}
        placeholder="One element id per line"
      />
    );
  }

  return (
    <textarea
      value={JSON.stringify(content, null, 2)}
      disabled={!canEdit}
      onChange={(e) => {
        try {
          setDraft(JSON.parse(e.target.value));
        } catch {
          /* ignore */
        }
      }}
      onBlur={() => void commitDraft()}
    />
  );
}

function ImagePanelEditor({
  projectId,
  content,
  canEdit,
  onChange,
  commit,
}: {
  projectId: string;
  content: Record<string, unknown>;
  canEdit: boolean;
  onChange: (c: Record<string, unknown>) => void;
  commit: (c: Record<string, unknown>) => void | Promise<void>;
}) {
  const images = (content.images as ImageRef[]) || [];
  const solo = images.length === 1;
  const [lightbox, setLightbox] = useState<ImageRef | null>(null);

  return (
    <>
      <div className={`image-panel stack${solo ? " solo" : ""}`}>
        <div className={`image-grid${solo ? " solo" : ""}`}>
          {images.map((img, i) => {
            const caption = (img.caption || "").trim();
            return (
              <figure key={`${img.url.slice(0, 48)}-${i}`} className="image-figure">
                <button
                  type="button"
                  className="image-frame"
                  data-tip={caption || TIPS.expandImage}
                  onClick={() => setLightbox(img)}
                >
                  <AssetImg projectId={projectId} url={img.url} alt={caption || "Image"} />
                </button>
                <figcaption className="image-caption">
                  {canEdit ? (
                    <>
                      <input
                        value={img.caption || ""}
                        placeholder="Caption"
                        data-tip={TIPS.imageCaption}
                        onChange={(e) => {
                          const next = images.slice();
                          next[i] = { ...img, caption: e.target.value };
                          const payload = { ...content, images: next };
                          onChange(payload);
                          // Keep caption draft for blur even if parent hasn't re-rendered.
                          (e.target as HTMLInputElement).dataset.draft = e.target.value;
                        }}
                        onBlur={(e) => {
                          const next = images.slice();
                          next[i] = {
                            ...img,
                            caption: e.target.value,
                          };
                          void commit({ ...content, images: next });
                        }}
                      />
                      <button
                        type="button"
                        className="ghost"
                        data-tip={TIPS.removeImage}
                        onClick={() => {
                          const next = {
                            ...content,
                            images: images.filter((_, j) => j !== i),
                          };
                          void commit(next);
                        }}
                      >
                        Remove
                      </button>
                    </>
                  ) : (
                    <span className={caption ? "" : "muted"}>
                      {caption || "No caption"}
                    </span>
                  )}
                </figcaption>
              </figure>
            );
          })}
        </div>
        {canEdit && (
          <div className="row image-panel-actions" style={{ flexWrap: "wrap" }}>
            <label className="buttonish" data-tip={TIPS.uploadImage}>
              Upload image
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                hidden
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  const asset = await api.uploadAsset(projectId, file);
                  await commit({
                    ...content,
                    images: [...images, { url: asset.url, caption: "" }],
                  });
                }}
              />
            </label>
            <button
              type="button"
              data-tip={TIPS.addImageUrl}
              onClick={() => {
                const url = prompt("Image URL");
                if (!url) return;
                void commit({
                  ...content,
                  images: [...images, { url, caption: "" }],
                });
              }}
            >
              Add URL
            </button>
          </div>
        )}
        {images.length === 0 && <p className="muted">No images yet.</p>}
      </div>
      {lightbox && (
        <ImageLightbox
          projectId={projectId}
          url={lightbox.url}
          caption={lightbox.caption}
          onClose={() => setLightbox(null)}
        />
      )}
    </>
  );
}
