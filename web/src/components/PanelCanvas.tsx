import { useEffect, useMemo, useRef, useState } from "react";
import GridLayout, { Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { api, Element, Page, Panel } from "../api/client";

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

  useEffect(() => {
    setTitle(element.title);
    (async () => {
      let list = await api.pages(element.id);
      if (!list.length) {
        await api.createPage(element.id, "Overview");
        list = await api.pages(element.id);
      }
      setPages(list);
      setPageId(list[0]?.id || null);
    })();
  }, [element.id]);

  useEffect(() => {
    if (!pageId) return;
    api.panels(pageId).then(setPanels);
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

  const layout: Layout[] = useMemo(
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
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            if (title !== element.title) onTitle(title);
          }}
          style={{ fontFamily: "var(--font-display)", fontSize: "1.4rem", fontWeight: 700 }}
        />
        <select
          value={pageId || ""}
          onChange={(e) => setPageId(e.target.value)}
          style={{ maxWidth: 180 }}
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
        <GridLayout
          className="layout"
          layout={layout}
          cols={12}
          rowHeight={36}
          width={width}
          draggableHandle=".drag-handle"
          onDragStop={async (l) => {
            for (const item of l) {
              const panel = panels.find((p) => p.id === item.i);
              if (!panel) continue;
              await persistPanel(panel, {
                layout: { x: item.x, y: item.y, w: item.w, h: item.h },
              });
            }
          }}
          onResizeStop={async (l) => {
            for (const item of l) {
              const panel = panels.find((p) => p.id === item.i);
              if (!panel) continue;
              await persistPanel(panel, {
                layout: { x: item.x, y: item.y, w: item.w, h: item.h },
              });
            }
          }}
        >
          {panels.map((panel) => (
            <div key={panel.id} style={{ borderColor: panel.border_color || undefined }}>
              <div className="panel-header">
                <span className="drag-handle">⠿</span>
                <input
                  value={panel.title}
                  onChange={(e) =>
                    setPanels((all) =>
                      all.map((p) => (p.id === panel.id ? { ...p, title: e.target.value } : p))
                    )
                  }
                  onBlur={() => persistPanel(panel, { title: panel.title })}
                  style={{ border: "none", background: "transparent", padding: 0 }}
                />
                <div className="spacer" />
                {canEdit && (
                  <button
                    className="ghost"
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
                  onSave={() => persistPanel(panel, { content: panel.content })}
                />
              </div>
            </div>
          ))}
        </GridLayout>
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
  onSave,
}: {
  projectId: string;
  panel: Panel;
  canEdit: boolean;
  onChange: (c: Record<string, unknown>) => void;
  onSave: () => void;
}) {
  const content = panel.content;

  if (panel.panel_type === "text") {
    return (
      <textarea
        value={String(content.markdown || "")}
        onChange={(e) => onChange({ ...content, markdown: e.target.value })}
        onBlur={onSave}
        placeholder="Write markdown…"
        disabled={!canEdit}
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
                const next = items.slice();
                next[i] = { ...item, key: e.target.value };
                onChange({ ...content, items: next });
              }}
              onBlur={onSave}
            />
            <input
              placeholder="Value"
              value={item.value}
              disabled={!canEdit}
              onChange={(e) => {
                const next = items.slice();
                next[i] = { ...item, value: e.target.value };
                onChange({ ...content, items: next });
              }}
              onBlur={onSave}
            />
            {canEdit && (
              <button
                onClick={() => {
                  onChange({ ...content, items: items.filter((_, j) => j !== i) });
                  setTimeout(onSave, 0);
                }}
              >
                ×
              </button>
            )}
          </div>
        ))}
        {canEdit && (
          <button
            onClick={() => {
              onChange({ ...content, items: [...items, { key: "", value: "" }] });
              setTimeout(onSave, 0);
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
                const next = items.slice();
                next[i] = e.target.value;
                onChange({ ...content, items: next });
              }}
              onBlur={onSave}
              style={{ gridColumn: "1 / 3" }}
            />
            {canEdit && (
              <button
                onClick={() => {
                  onChange({ ...content, items: items.filter((_, j) => j !== i) });
                  setTimeout(onSave, 0);
                }}
              >
                ×
              </button>
            )}
          </div>
        ))}
        {canEdit && (
          <button
            onClick={() => {
              onChange({ ...content, items: [...items, ""] });
              setTimeout(onSave, 0);
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
                const next = headers.slice();
                next[i] = e.target.value;
                onChange({ ...content, headers: next });
              }}
              onBlur={onSave}
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
                  const next = rows.map((r) => r.slice());
                  next[ri][ci] = e.target.value;
                  onChange({ ...content, rows: next });
                }}
                onBlur={onSave}
              />
            ))}
          </div>
        ))}
        {canEdit && (
          <button
            onClick={() => {
              onChange({
                ...content,
                rows: [...rows, headers.map(() => "")],
              });
              setTimeout(onSave, 0);
            }}
          >
            Add row
          </button>
        )}
      </div>
    );
  }

  if (panel.panel_type === "image") {
    const images = (content.images as ImageRef[]) || [];
    return (
      <div className="image-panel stack">
        <div className="image-grid">
          {images.map((img, i) => (
            <figure key={`${img.url}-${i}`} className="image-thumb">
              <img src={img.url} alt={img.caption || ""} />
              <figcaption>
                <input
                  value={img.caption || ""}
                  placeholder="Caption"
                  disabled={!canEdit}
                  onChange={(e) => {
                    const next = images.slice();
                    next[i] = { ...img, caption: e.target.value };
                    onChange({ ...content, images: next });
                  }}
                  onBlur={onSave}
                />
                {canEdit && (
                  <button
                    className="ghost"
                    onClick={() => {
                      onChange({
                        ...content,
                        images: images.filter((_, j) => j !== i),
                      });
                      setTimeout(onSave, 0);
                    }}
                  >
                    Remove
                  </button>
                )}
              </figcaption>
            </figure>
          ))}
        </div>
        {canEdit && (
          <div className="row" style={{ flexWrap: "wrap" }}>
            <label className="buttonish">
              Upload image
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                hidden
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  const asset = await api.uploadAsset(projectId, file);
                  onChange({
                    ...content,
                    images: [...images, { url: asset.url, caption: "" }],
                  });
                  setTimeout(onSave, 0);
                }}
              />
            </label>
            <button
              onClick={() => {
                const url = prompt("Image URL");
                if (!url) return;
                onChange({
                  ...content,
                  images: [...images, { url, caption: "" }],
                });
                setTimeout(onSave, 0);
              }}
            >
              Add URL
            </button>
          </div>
        )}
        {images.length === 0 && <p className="muted">No images yet.</p>}
      </div>
    );
  }

  if (panel.panel_type === "links") {
    return (
      <textarea
        value={(content.element_ids as string[] | undefined)?.join("\n") || ""}
        disabled={!canEdit}
        onChange={(e) =>
          onChange({
            ...content,
            element_ids: e.target.value
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean),
          })
        }
        onBlur={onSave}
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
          onChange(JSON.parse(e.target.value));
        } catch {
          /* ignore */
        }
      }}
      onBlur={onSave}
    />
  );
}
